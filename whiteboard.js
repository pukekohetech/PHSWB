/* =========================================================
   whiteboard.js — PHS Whiteboard (clean build)

   Includes:
   - Pen, line, rect, circle, arc, arrow, text, eraser
   - Select + transform handles (move/scale/rotate)
   - Background image (DOM) with move/scale/rotate (when no selection)
   - Zoom to cursor (wheel), pan (space+drag)
   - Ctrl/Cmd snapping to endpoints/intersections; otherwise whole-mm grid
   - Angle snap when Ctrl/Cmd and no snap hit
   - Opacity slider (per-object), preserved in SVG export + saved boards
   - Undo/redo, boards save/load/delete, export PNG/SVG

   Notes:
   - "mm grid" uses your current scale (pxPerMm). Default 3.78 px/mm.
   ========================================================= */

(() => {
  "use strict";

  // ---------------- DOM ----------------
  const stage = document.getElementById("stage");
  const inkCanvas = document.getElementById("inkCanvas");
  const uiCanvas = document.getElementById("uiCanvas");
  const inkCtx = inkCanvas.getContext("2d");
  const uiCtx = uiCanvas.getContext("2d");

  const bgLayer = document.getElementById("bgLayer");
  const bgImg = document.getElementById("bgImg");

  const toast = document.getElementById("toast");

  const colorBtn = document.getElementById("colorBtn");
  const colorPop = document.getElementById("colorPop");
  const swatchLive = document.getElementById("swatchLive");
  const colorInput = document.getElementById("colorInput");
  const brushSize = document.getElementById("brushSize");
  const brushOut = document.getElementById("brushOut");

  const opacityRange = document.getElementById("opacityRange");
  const opacityOut = document.getElementById("opacityOut");

  const clearBtn = document.getElementById("clearBtn");

  const settingsBtn = document.getElementById("settingsBtn");
  const settingsPanel = document.getElementById("settingsPanel");
  const settingsCloseBtn = document.getElementById("settingsCloseBtn");

  const titleInput = document.getElementById("titleInput");
  const applyTitleBtn = document.getElementById("applyTitleBtn");

  const bgFile = document.getElementById("bgFile");
  const clearBgBtn = document.getElementById("clearBgBtn");

  const svgInkFile = document.getElementById("svgInkFile");
  const clearSvgInkBtn = document.getElementById("clearSvgInkBtn");

  const scaleOut = document.getElementById("scaleOut");
  const setScaleBtn = document.getElementById("setScaleBtn");
  const resetScaleBtn = document.getElementById("resetScaleBtn");

  const boardSelect = document.getElementById("boardSelect");
  const newBoardBtn = document.getElementById("newBoardBtn");
  const saveBoardBtn = document.getElementById("saveBoardBtn");
  const loadBoardBtn = document.getElementById("loadBoardBtn");
  const deleteBoardBtn = document.getElementById("deleteBoardBtn");
  const deleteAllBoardsBtn = document.getElementById("deleteAllBoardsBtn");

  const exportBtn = document.getElementById("exportBtn");
  const exportSvgBtn = document.getElementById("exportSvgBtn");

  const toolButtons = Array.from(document.querySelectorAll(".dockBtn[data-tool]"));

  // ---------------- Utilities ----------------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist2 = (a, b) => {
    const dx = a.x - b.x, dy = a.y - b.y;
    return dx * dx + dy * dy;
  };
  const len = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  function showToast(msg = "Saved") {
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add("is-on");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.remove("is-on"), 900);
  }

  function downloadBlob(filename, blob) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  }

  // ---------------- State ----------------
  const state = {
    tool: "pen",
    color: "#111111",
    size: 5,
    opacity: 1,

    // scale calibration
    pxPerMm: 3.78,

    // view transform (world -> screen)
    view: { x: 0, y: 0, z: 1 }, // x/y is pan in screen px, z is zoom

    // content
    objects: [],
    undo: [],
    redo: [],

    // selection
    selectedId: null,
    hoverHandle: null,

    // title
    title: "",

    // background transform in world space
    bg: {
      src: "",
      natW: 0,
      natH: 0,
      x: 0, y: 0, // world coords of image top-left
      scale: 1,
      rot: 0
    },

    // optional svg ink placeholder
    svgInk: null, // { raw: "<svg...>", x,y,scale,rot } (kept minimal)
  };

  let idCounter = 1;
  const nextId = () => `o${idCounter++}`;

  // ---------------- Canvas sizing ----------------
  function resizeCanvases() {
    const r = stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    inkCanvas.width = Math.max(2, Math.round(r.width * dpr));
    inkCanvas.height = Math.max(2, Math.round(r.height * dpr));
    uiCanvas.width = inkCanvas.width;
    uiCanvas.height = inkCanvas.height;

    inkCanvas.style.width = `${r.width}px`;
    inkCanvas.style.height = `${r.height}px`;
    uiCanvas.style.width = `${r.width}px`;
    uiCanvas.style.height = `${r.height}px`;

    inkCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    uiCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    applyBgTransform();
    drawAll();
  }

  // ---------------- View mapping ----------------
  function screenToWorld(ptS) {
    // invert: screen = world*z + (view.x, view.y)
    return {
      x: (ptS.x - state.view.x) / state.view.z,
      y: (ptS.y - state.view.y) / state.view.z
    };
  }

  function worldToScreen(ptW) {
    return {
      x: ptW.x * state.view.z + state.view.x,
      y: ptW.y * state.view.z + state.view.y
    };
  }

  function getPointer(e) {
    const r = inkCanvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function applyWorldTransform(ctx) {
    // world -> screen
    ctx.translate(state.view.x, state.view.y);
    ctx.scale(state.view.z, state.view.z);
  }

  // ---------------- UI setters ----------------
  function setTool(t) {
    state.tool = t;

    // update dock active
    toolButtons.forEach(btn => {
      btn.classList.toggle("is-active", btn.dataset.tool === t);
    });

    // special: bg tools should NOT steal highlight from draw tools if you want; but keep as-is
    drawAll();
  }

  function setColor(hex) {
    state.color = hex;
    if (swatchLive) swatchLive.style.background = hex;
    if (colorInput) colorInput.value = hex;
  }

  function setSize(v) {
    state.size = clamp(Math.round(Number(v) || 1), 1, 200);
    if (brushSize) brushSize.value = String(state.size);
    if (brushOut) brushOut.textContent = String(state.size);
  }

  function setOpacity01(a01) {
    const v = clamp(Number(a01) || 1, 0.05, 1);
    state.opacity = v;
    if (opacityRange) opacityRange.value = String(Math.round(v * 100));
    if (opacityOut) opacityOut.textContent = `${Math.round(v * 100)}%`;
  }

  function updateScaleOut() {
    if (!scaleOut) return;
    scaleOut.textContent = `1 mm = ${state.pxPerMm.toFixed(2)} px`;
  }

  // ---------------- Background DOM transform ----------------
  function applyBgTransform() {
    if (!bgLayer || !bgImg) return;

    if (!state.bg.src) {
      bgLayer.style.display = "none";
      return;
    }
    bgLayer.style.display = "block";

    // Compose transform: view + bg world transform
    // bgLayer is inside stage and we apply CSS transform to bgImg itself.
    const z = state.view.z;
    const tx = state.view.x + state.bg.x * z;
    const ty = state.view.y + state.bg.y * z;
    const sc = state.bg.scale * z;
    const rot = state.bg.rot;

    bgImg.style.transformOrigin = "0 0";
    bgImg.style.transform = `translate(${tx}px, ${ty}px) rotate(${rot}rad) scale(${sc})`;
  }

  // ---------------- Undo/Redo ----------------
  function snapshot() {
    // keep small: only store objects/bg/title/scale/svgInk
    return JSON.stringify({
      objects: state.objects,
      selectedId: state.selectedId,
      title: state.title,
      pxPerMm: state.pxPerMm,
      bg: state.bg,
      svgInk: state.svgInk,
      idCounter
    });
  }

  function restore(snap) {
    const data = JSON.parse(snap);
    state.objects = data.objects || [];
    state.selectedId = data.selectedId ?? null;
    state.title = data.title || "";
    state.pxPerMm = data.pxPerMm || 3.78;
    state.bg = data.bg || state.bg;
    state.svgInk = data.svgInk ?? null;
    idCounter = data.idCounter || idCounter;

    if (titleInput) titleInput.value = state.title;

    updateScaleOut();
    applyBgTransform();
    drawAll();
  }

  function pushUndo() {
    state.undo.push(snapshot());
    if (state.undo.length > 80) state.undo.shift();
    state.redo.length = 0;
  }

  function undo() {
    if (!state.undo.length) return;
    state.redo.push(snapshot());
    const snap = state.undo.pop();
    restore(snap);
  }

  function redo() {
    if (!state.redo.length) return;
    state.undo.push(snapshot());
    const snap = state.redo.pop();
    restore(snap);
  }

  // ---------------- Snapping ----------------
  function snapToMmGridWorld(p) {
    const m = state.pxPerMm;
    return { x: Math.round(p.x / m) * m, y: Math.round(p.y / m) * m };
  }

  const ANGLE_SNAPS_DEG = [
    0, 30, 45, 60, 90, 120, 135, 150,
    -30, -45, -60, -90, -120, -135, -150, 180
  ];

  function snapAngleRad(angleRad) {
    const a = angleRad;
    let best = a, bestD = Infinity;
    for (const d of ANGLE_SNAPS_DEG) {
      const s = (d * Math.PI) / 180;
      const dd = Math.abs(normAngle(a - s));
      if (dd < bestD) { bestD = dd; best = s; }
    }
    return best;
  }

  function normAngle(a) {
    // normalize to [-pi, pi]
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  function segIntersection(a, b, c, d) {
    // line segments AB and CD intersection (returns point or null)
    const r = { x: b.x - a.x, y: b.y - a.y };
    const s = { x: d.x - c.x, y: d.y - c.y };
    const denom = r.x * s.y - r.y * s.x;
    if (Math.abs(denom) < 1e-9) return null;

    const uNum = (c.x - a.x) * r.y - (c.y - a.y) * r.x;
    const tNum = (c.x - a.x) * s.y - (c.y - a.y) * s.x;
    const t = tNum / denom;
    const u = uNum / denom;

    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
      return { x: a.x + t * r.x, y: a.y + t * r.y };
    }
    return null;
  }

  function collectStraightSegments() {
    // Only segments we can reliably intersect:
    // line, arrow => one segment
    // rect => 4 segments
    const segs = [];
    for (const o of state.objects) {
      if (o.hidden) continue;
      if (o.kind === "line" || o.kind === "arrow") {
        segs.push({ a: { x: o.x1, y: o.y1 }, b: { x: o.x2, y: o.y2 } });
      } else if (o.kind === "rect") {
        const x1 = o.x1, y1 = o.y1, x2 = o.x2, y2 = o.y2;
        const ax = Math.min(x1, x2), bx = Math.max(x1, x2);
        const ay = Math.min(y1, y2), by = Math.max(y1, y2);
        segs.push({ a: { x: ax, y: ay }, b: { x: bx, y: ay } });
        segs.push({ a: { x: bx, y: ay }, b: { x: bx, y: by } });
        segs.push({ a: { x: bx, y: by }, b: { x: ax, y: by } });
        segs.push({ a: { x: ax, y: by }, b: { x: ax, y: ay } });
      }
    }
    return segs;
  }

  function collectSnapPoints() {
    const pts = [];

    for (const o of state.objects) {
      if (o.hidden) continue;

      if (o.kind === "line" || o.kind === "arrow") {
        pts.push({ x: o.x1, y: o.y1 });
        pts.push({ x: o.x2, y: o.y2 });
      } else if (o.kind === "rect") {
        const x1 = o.x1, y1 = o.y1, x2 = o.x2, y2 = o.y2;
        pts.push({ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 });
      } else if (o.kind === "circle") {
        pts.push({ x: o.cx, y: o.cy });
      } else if (o.kind === "arc") {
        // endpoints
        pts.push({ x: o.cx + Math.cos(o.a1) * o.r, y: o.cy + Math.sin(o.a1) * o.r });
        pts.push({ x: o.cx + Math.cos(o.a2) * o.r, y: o.cy + Math.sin(o.a2) * o.r });
      } else if (o.kind === "stroke") {
        if (o.points?.length) {
          pts.push(o.points[0]);
          pts.push(o.points[o.points.length - 1]);
        }
      }
    }

    // intersections (straight tools)
    const segs = collectStraightSegments();
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        const p = segIntersection(segs[i].a, segs[i].b, segs[j].a, segs[j].b);
        if (p) pts.push(p);
      }
    }

    return pts;
  }

  function snapToNearbyPoint(pWorld, radiusScreenPx = 14) {
    const pts = collectSnapPoints();
    const r2 = (radiusScreenPx / state.view.z) ** 2; // convert to world
    let best = null;
    let bestD = Infinity;
    for (const q of pts) {
      const d = dist2(pWorld, q);
      if (d < r2 && d < bestD) {
        bestD = d;
        best = q;
      }
    }
    return best ? { x: best.x, y: best.y } : null;
  }

  function snapLineOrArrowEnd(p0, p1, ctrlHeld) {
    if (!ctrlHeld) return snapToMmGridWorld(p1);

    const hit = snapToNearbyPoint(p1);
    if (hit) return hit;

    // angle snap fallback
    const a = Math.atan2(p1.y - p0.y, p1.x - p0.x);
    const sa = snapAngleRad(a);
    const L = len(p0, p1);
    return { x: p0.x + Math.cos(sa) * L, y: p0.y + Math.sin(sa) * L };
  }

  // ---------------- Hit-testing & selection ----------------
  function pointToSegDist(p, a, b) {
    const vx = b.x - a.x, vy = b.y - a.y;
    const wx = p.x - a.x, wy = p.y - a.y;
    const c1 = vx * wx + vy * wy;
    if (c1 <= 0) return Math.hypot(p.x - a.x, p.y - a.y);
    const c2 = vx * vx + vy * vy;
    if (c2 <= c1) return Math.hypot(p.x - b.x, p.y - b.y);
    const t = c1 / c2;
    const px = a.x + t * vx, py = a.y + t * vy;
    return Math.hypot(p.x - px, p.y - py);
  }

  function hitObject(pWorld) {
    // return topmost id or null
    const tol = 8 / state.view.z;

    for (let i = state.objects.length - 1; i >= 0; i--) {
      const o = state.objects[i];
      if (o.hidden) continue;

      if (o.kind === "line" || o.kind === "arrow") {
        const d = pointToSegDist(pWorld, { x: o.x1, y: o.y1 }, { x: o.x2, y: o.y2 });
        if (d <= tol + (o.size || 3) / state.view.z) return o.id;
      } else if (o.kind === "rect") {
        const ax = Math.min(o.x1, o.x2), bx = Math.max(o.x1, o.x2);
        const ay = Math.min(o.y1, o.y2), by = Math.max(o.y1, o.y2);
        const inside = (pWorld.x >= ax - tol && pWorld.x <= bx + tol && pWorld.y >= ay - tol && pWorld.y <= by + tol);
        if (inside) return o.id;
      } else if (o.kind === "circle") {
        const d = Math.abs(Math.hypot(pWorld.x - o.cx, pWorld.y - o.cy) - o.r);
        if (d <= tol + (o.size || 3) / state.view.z) return o.id;
      } else if (o.kind === "arc") {
        const dR = Math.abs(Math.hypot(pWorld.x - o.cx, pWorld.y - o.cy) - o.r);
        if (dR <= tol + (o.size || 3) / state.view.z) return o.id;
      } else if (o.kind === "stroke") {
        const pts = o.points || [];
        for (let k = 0; k < pts.length - 1; k++) {
          const d = pointToSegDist(pWorld, pts[k], pts[k + 1]);
          if (d <= tol + (o.size || 3) / state.view.z) return o.id;
        }
      } else if (o.kind === "text") {
        // rough hitbox (no font metrics storage)
        const w = (o.text?.length || 1) * (o.fontSize || 18) * 0.55;
        const h = (o.fontSize || 18) * 1.2;
        if (
          pWorld.x >= o.x - tol && pWorld.x <= o.x + w + tol &&
          pWorld.y >= o.y - h - tol && pWorld.y <= o.y + tol
        ) return o.id;
      }
    }
    return null;
  }

  function getSelected() {
    return state.objects.find(o => o.id === state.selectedId) || null;
  }

  function clearSelection() {
    state.selectedId = null;
    drawAll();
  }

  // ---------------- Transform handles ----------------
  function getObjBounds(o) {
    if (!o) return null;

    if (o.kind === "line" || o.kind === "arrow") {
      const ax = Math.min(o.x1, o.x2), bx = Math.max(o.x1, o.x2);
      const ay = Math.min(o.y1, o.y2), by = Math.max(o.y1, o.y2);
      return { ax, ay, bx, by };
    }
    if (o.kind === "rect") {
      const ax = Math.min(o.x1, o.x2), bx = Math.max(o.x1, o.x2);
      const ay = Math.min(o.y1, o.y2), by = Math.max(o.y1, o.y2);
      return { ax, ay, bx, by };
    }
    if (o.kind === "circle") {
      return { ax: o.cx - o.r, ay: o.cy - o.r, bx: o.cx + o.r, by: o.cy + o.r };
    }
    if (o.kind === "arc") {
      return { ax: o.cx - o.r, ay: o.cy - o.r, bx: o.cx + o.r, by: o.cy + o.r };
    }
    if (o.kind === "stroke") {
      const pts = o.points || [];
      if (!pts.length) return null;
      let ax = pts[0].x, ay = pts[0].y, bx = pts[0].x, by = pts[0].y;
      for (const p of pts) {
        ax = Math.min(ax, p.x); ay = Math.min(ay, p.y);
        bx = Math.max(bx, p.x); by = Math.max(by, p.y);
      }
      return { ax, ay, bx, by };
    }
    if (o.kind === "text") {
      const w = (o.text?.length || 1) * (o.fontSize || 18) * 0.55;
      const h = (o.fontSize || 18) * 1.2;
      return { ax: o.x, ay: o.y - h, bx: o.x + w, by: o.y };
    }
    return null;
  }

  function drawHandles(o) {
    if (!o) return;

    const b = getObjBounds(o);
    if (!b) return;

    const pad = 6 / state.view.z;
    const ax = b.ax - pad, ay = b.ay - pad, bx = b.bx + pad, by = b.by + pad;

    // draw bbox
    uiCtx.save();
    uiCtx.clearRect(0, 0, uiCanvas.width, uiCanvas.height);
    uiCtx.save();
    applyWorldTransform(uiCtx);

    uiCtx.lineWidth = 1 / state.view.z;
    uiCtx.setLineDash([6 / state.view.z, 6 / state.view.z]);
    uiCtx.strokeStyle = "rgba(0,0,0,0.55)";
    uiCtx.strokeRect(ax, ay, bx - ax, by - ay);

    // handles in world coords
    const hs = 8 / state.view.z;
    const handles = [
      { k: "nw", x: ax, y: ay },
      { k: "ne", x: bx, y: ay },
      { k: "se", x: bx, y: by },
      { k: "sw", x: ax, y: by }
    ];

    uiCtx.setLineDash([]);
    uiCtx.fillStyle = "white";
    uiCtx.strokeStyle = "rgba(0,0,0,0.7)";

    for (const h of handles) {
      uiCtx.beginPath();
      uiCtx.rect(h.x - hs / 2, h.y - hs / 2, hs, hs);
      uiCtx.fill();
      uiCtx.stroke();
    }

    // rotate handle above top center
    const cx = (ax + bx) / 2;
    const ry = ay - (18 / state.view.z);
    uiCtx.beginPath();
    uiCtx.arc(cx, ry, hs * 0.55, 0, Math.PI * 2);
    uiCtx.fill();
    uiCtx.stroke();
    uiCtx.beginPath();
    uiCtx.moveTo(cx, ay);
    uiCtx.lineTo(cx, ry);
    uiCtx.stroke();

    uiCtx.restore();
    uiCtx.restore();
  }

  function clearUI() {
    uiCtx.clearRect(0, 0, uiCanvas.width, uiCanvas.height);
  }

  // ---------------- Drawing ----------------
  function drawInkObject(o) {
    if (o.hidden) return;

    inkCtx.save();
    applyWorldTransform(inkCtx);

    inkCtx.globalAlpha = (o.kind === "erase") ? 1 : (o.opacity ?? 1);

    if (o.kind === "stroke") {
      inkCtx.strokeStyle = o.color;
      inkCtx.lineWidth = o.size;
      inkCtx.lineCap = "round";
      inkCtx.lineJoin = "round";

      inkCtx.beginPath();
      const pts = o.points || [];
      if (pts.length) inkCtx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) inkCtx.lineTo(pts[i].x, pts[i].y);
      inkCtx.stroke();
    }

    if (o.kind === "erase") {
      inkCtx.globalCompositeOperation = "destination-out";
      inkCtx.strokeStyle = "rgba(0,0,0,1)";
      inkCtx.lineWidth = o.size;
      inkCtx.lineCap = "round";
      inkCtx.lineJoin = "round";

      inkCtx.beginPath();
      const pts = o.points || [];
      if (pts.length) inkCtx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) inkCtx.lineTo(pts[i].x, pts[i].y);
      inkCtx.stroke();
    }

    if (o.kind === "line") {
      inkCtx.strokeStyle = o.color;
      inkCtx.lineWidth = o.size;
      inkCtx.lineCap = "round";
      inkCtx.beginPath();
      inkCtx.moveTo(o.x1, o.y1);
      inkCtx.lineTo(o.x2, o.y2);
      inkCtx.stroke();
    }

    if (o.kind === "arrow") {
      inkCtx.strokeStyle = o.color;
      inkCtx.fillStyle = o.color;
      inkCtx.lineWidth = o.size;
      inkCtx.lineCap = "round";

      const a = { x: o.x1, y: o.y1 };
      const b = { x: o.x2, y: o.y2 };

      inkCtx.beginPath();
      inkCtx.moveTo(a.x, a.y);
      inkCtx.lineTo(b.x, b.y);
      inkCtx.stroke();

      // head
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const headLen = Math.max(10, o.size * 3);
      const headAng = 28 * Math.PI / 180;
      const p1 = { x: b.x - Math.cos(ang - headAng) * headLen, y: b.y - Math.sin(ang - headAng) * headLen };
      const p2 = { x: b.x - Math.cos(ang + headAng) * headLen, y: b.y - Math.sin(ang + headAng) * headLen };

      inkCtx.beginPath();
      inkCtx.moveTo(b.x, b.y);
      inkCtx.lineTo(p1.x, p1.y);
      inkCtx.lineTo(p2.x, p2.y);
      inkCtx.closePath();
      inkCtx.fill();
    }

    if (o.kind === "rect") {
      inkCtx.strokeStyle = o.color;
      inkCtx.lineWidth = o.size;
      inkCtx.lineJoin = "round";
      inkCtx.strokeRect(o.x1, o.y1, o.x2 - o.x1, o.y2 - o.y1);
    }

    if (o.kind === "circle") {
      inkCtx.strokeStyle = o.color;
      inkCtx.lineWidth = o.size;
      inkCtx.beginPath();
      inkCtx.arc(o.cx, o.cy, o.r, 0, Math.PI * 2);
      inkCtx.stroke();
    }

    if (o.kind === "arc") {
      inkCtx.strokeStyle = o.color;
      inkCtx.lineWidth = o.size;
      inkCtx.lineCap = "round";

      inkCtx.beginPath();
      inkCtx.arc(o.cx, o.cy, o.r, o.a1, o.a2, !!o.ccw);
      inkCtx.stroke();
    }

    if (o.kind === "text") {
      inkCtx.fillStyle = o.color;
      inkCtx.font = `${o.fontSize || 20}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
      inkCtx.textBaseline = "alphabetic";
      inkCtx.fillText(o.text || "", o.x, o.y);
    }

    inkCtx.restore();
  }

  function drawTitle() {
    if (!state.title) return;
    inkCtx.save();
    inkCtx.setTransform(1, 0, 0, 1, 0, 0); // screen space
    inkCtx.globalAlpha = 1;
    inkCtx.fillStyle = "rgba(0,0,0,0.75)";
    inkCtx.font = `600 18px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
    inkCtx.textBaseline = "top";
    inkCtx.fillText(state.title, 16, 10);
    inkCtx.restore();
  }

  function drawAll() {
    inkCtx.clearRect(0, 0, inkCanvas.width, inkCanvas.height);
    clearUI();

    // draw objects
    for (const o of state.objects) drawInkObject(o);

    // title overlay
    drawTitle();

    // handles for selection
    const sel = getSelected();
    if (sel && state.tool === "select") drawHandles(sel);
  }

  // ---------------- Gesture ----------------
  const gesture = {
    active: false,
    mode: null,      // drawPen, drawLine, drawRect, drawCircle, drawArc, drawArrow, erase, selectMove, scale, rotate, pan, bgMove, bgScale, bgRotate
    startS: null,
    lastS: null,
    startW: null,
    lastW: null,
    activeObj: null,
    arcCenter: null, // {cx,cy}
    selStart: null,  // snapshot for transforms
    bgStart: null,
    handle: null
  };

  function startGesture(mode, e) {
    gesture.active = true;
    gesture.mode = mode;
    gesture.startS = getPointer(e);
    gesture.lastS = gesture.startS;
    gesture.startW = screenToWorld(gesture.startS);
    gesture.lastW = gesture.startW;
    gesture.activeObj = null;
    gesture.arcCenter = null;
    gesture.selStart = null;
    gesture.bgStart = null;
    gesture.handle = null;
  }

  function endGesture() {
    gesture.active = false;
    gesture.mode = null;
    gesture.activeObj = null;
    gesture.arcCenter = null;
    gesture.selStart = null;
    gesture.bgStart = null;
    gesture.handle = null;
    drawAll();
  }

  // ---------------- Pointer handlers ----------------
  function ctrlHeld(e) {
    // Ctrl on Windows/Linux, Cmd on Mac
    return e.ctrlKey || e.metaKey;
  }

  function isSpacePanning(e) {
    return e.buttons === 1 && keys.space;
  }

  const keys = { space: false };

  function pointerDown(e) {
    if (e.button !== 0) return;
    inkCanvas.setPointerCapture(e.pointerId);

    const pS = getPointer(e);
    const pW = screenToWorld(pS);

    // space-pan always wins
    if (keys.space) {
      startGesture("pan", e);
      return;
    }

    const tool = state.tool;

    if (tool === "select") {
      pushUndo();
      const hit = hitObject(pW);
      if (!hit) {
        state.selectedId = null;
        drawAll();
        return;
      }
      state.selectedId = hit;

      // if clicked near handle, start transform
      const sel = getSelected();
      const b = getObjBounds(sel);
      if (b) {
        const pad = 6 / state.view.z;
        const ax = b.ax - pad, ay = b.ay - pad, bx = b.bx + pad, by = b.by + pad;
        const hs = 10 / state.view.z;

        const corners = [
          { k: "nw", x: ax, y: ay },
          { k: "ne", x: bx, y: ay },
          { k: "se", x: bx, y: by },
          { k: "sw", x: ax, y: by }
        ];

        // rotate handle
        const rc = { x: (ax + bx) / 2, y: ay - (18 / state.view.z) };
        if (len(pW, rc) <= hs * 0.9) {
          startGesture("rotateSel", e);
          gesture.selStart = snapshot();
          gesture.handle = "rot";
          return;
        }

        for (const c of corners) {
          if (Math.abs(pW.x - c.x) <= hs / 2 && Math.abs(pW.y - c.y) <= hs / 2) {
            startGesture("scaleSel", e);
            gesture.selStart = snapshot();
            gesture.handle = c.k;
            return;
          }
        }
      }

      startGesture("moveSel", e);
      gesture.selStart = snapshot();
      return;
    }

    // bg tools: act on selection if selected, else background
    if (tool === "bgMove" || tool === "bgScale" || tool === "bgRotate") {
      const sel = getSelected();
      pushUndo();

      if (sel) {
        state.tool = "select";
        // route into transforms
        if (tool === "bgMove") {
          startGesture("moveSel", e);
          gesture.selStart = snapshot();
          return;
        }
        if (tool === "bgScale") {
          startGesture("scaleSel", e);
          gesture.selStart = snapshot();
          gesture.handle = "se";
          return;
        }
        if (tool === "bgRotate") {
          startGesture("rotateSel", e);
          gesture.selStart = snapshot();
          gesture.handle = "rot";
          return;
        }
      } else {
        // background
        if (!state.bg.src) return;
        if (tool === "bgMove") {
          startGesture("bgMove", e);
          gesture.bgStart = JSON.stringify(state.bg);
          return;
        }
        if (tool === "bgScale") {
          startGesture("bgScale", e);
          gesture.bgStart = JSON.stringify(state.bg);
          return;
        }
        if (tool === "bgRotate") {
          startGesture("bgRotate", e);
          gesture.bgStart = JSON.stringify(state.bg);
          return;
        }
      }
    }

    // drawing tools
    pushUndo();

    if (tool === "pen") {
      startGesture("drawPen", e);
      const o = { id: nextId(), kind: "stroke", color: state.color, opacity: state.opacity, size: state.size, points: [pW] };
      state.objects.push(o);
      gesture.activeObj = o;
      drawAll();
      return;
    }

    if (tool === "eraser") {
      startGesture("erase", e);
      const o = { id: nextId(), kind: "erase", size: Math.max(6, state.size * 2), points: [pW] };
      state.objects.push(o);
      gesture.activeObj = o;
      drawAll();
      return;
    }

    if (tool === "line" || tool === "arrow" || tool === "rect") {
      startGesture(`draw${tool[0].toUpperCase() + tool.slice(1)}`, e);
      const o = {
        id: nextId(),
        kind: tool,
        color: state.color,
        opacity: state.opacity,
        size: state.size,
        x1: pW.x, y1: pW.y, x2: pW.x, y2: pW.y
      };
      state.objects.push(o);
      gesture.activeObj = o;
      drawAll();
      return;
    }

    if (tool === "circle") {
      startGesture("drawCircle", e);
      const o = {
        id: nextId(),
        kind: "circle",
        color: state.color,
        opacity: state.opacity,
        size: state.size,
        cx: pW.x, cy: pW.y,
        r: 0
      };
      state.objects.push(o);
      gesture.activeObj = o;
      drawAll();
      return;
    }

    if (tool === "arc") {
      startGesture("drawArc", e);
      // center is first click point
      gesture.arcCenter = { cx: pW.x, cy: pW.y };
      const o = {
        id: nextId(),
        kind: "arc",
        color: state.color,
        opacity: state.opacity,
        size: state.size,
        cx: pW.x, cy: pW.y,
        r: 0,
        a1: 0, a2: 0,
        ccw: false
      };
      state.objects.push(o);
      gesture.activeObj = o;
      drawAll();
      return;
    }

    if (tool === "text") {
      // create immediately
      const t = prompt("Text:");
      if (t == null) return;
      const o = {
        id: nextId(),
        kind: "text",
        x: pW.x, y: pW.y,
        text: String(t),
        color: state.color,
        opacity: state.opacity,
        fontSize: Math.max(16, Math.round(state.size * 4))
      };
      state.objects.push(o);
      drawAll();
      return;
    }
  }

  function pointerMove(e) {
    const pS = getPointer(e);
    const pW = screenToWorld(pS);

    if (!gesture.active) return;

    gesture.lastS = pS;
    gesture.lastW = pW;

    const ctrl = ctrlHeld(e);

    if (gesture.mode === "pan") {
      const dx = pS.x - gesture.startS.x;
      const dy = pS.y - gesture.startS.y;
      state.view.x += dx;
      state.view.y += dy;
      gesture.startS = pS;
      applyBgTransform();
      drawAll();
      return;
    }

    if (gesture.mode === "bgMove") {
      const bg0 = JSON.parse(gesture.bgStart);
      const dw = { x: pW.x - gesture.startW.x, y: pW.y - gesture.startW.y };
      state.bg.x = bg0.x + dw.x;
      state.bg.y = bg0.y + dw.y;
      applyBgTransform();
      return;
    }

    if (gesture.mode === "bgScale") {
      const bg0 = JSON.parse(gesture.bgStart);
      const ds = (pS.y - gesture.startS.y) * -0.005;
      state.bg.scale = clamp(bg0.scale * (1 + ds), 0.02, 50);
      applyBgTransform();
      return;
    }

    if (gesture.mode === "bgRotate") {
      const bg0 = JSON.parse(gesture.bgStart);
      const ds = (pS.x - gesture.startS.x) * 0.01;
      let r = bg0.rot + ds;
      if (e.shiftKey) {
        const snap = (15 * Math.PI) / 180;
        r = Math.round(r / snap) * snap;
      }
      state.bg.rot = r;
      applyBgTransform();
      return;
    }

    const o = gesture.activeObj;

    if (gesture.mode === "drawPen" || gesture.mode === "erase") {
      if (!o) return;
      o.points.push(pW);
      drawAll();
      return;
    }

    if (gesture.mode === "drawLine" || gesture.mode === "drawArrow") {
      if (!o) return;
      const p0 = { x: o.x1, y: o.y1 };
      const p1 = snapLineOrArrowEnd(p0, pW, ctrl);
      o.x2 = p1.x;
      o.y2 = p1.y;
      drawAll();
      return;
    }

    if (gesture.mode === "drawRect") {
      if (!o) return;

      // default snap to mm, ctrl snaps endpoints/intersections if near
      let p1 = pW;
      if (ctrl) {
        const hit = snapToNearbyPoint(pW);
        if (hit) p1 = hit;
      } else {
        p1 = snapToMmGridWorld(pW);
      }

      let x2 = p1.x;
      let y2 = p1.y;

      // shift = uniform square
      if (e.shiftKey) {
        const dx = x2 - o.x1;
        const dy = y2 - o.y1;
        const s = Math.max(Math.abs(dx), Math.abs(dy));
        x2 = o.x1 + Math.sign(dx || 1) * s;
        y2 = o.y1 + Math.sign(dy || 1) * s;
      }

      o.x2 = x2;
      o.y2 = y2;

      drawAll();
      return;
    }

    if (gesture.mode === "drawCircle") {
      if (!o) return;

      // ctrl: snap radius endpoint to nearby points if any, else mm
      let p1 = pW;
      if (ctrl) {
        const hit = snapToNearbyPoint(pW);
        if (hit) p1 = hit;
      } else {
        p1 = snapToMmGridWorld(pW);
      }

      const r = Math.hypot(p1.x - o.cx, p1.y - o.cy);
      o.r = r;
      drawAll();
      return;
    }

    if (gesture.mode === "drawArc") {
      if (!o || !gesture.arcCenter) return;

      const cx = gesture.arcCenter.cx;
      const cy = gesture.arcCenter.cy;

      // endpoint snapping
      let p1 = pW;
      if (ctrl) {
        const hit = snapToNearbyPoint(pW);
        if (hit) p1 = hit;
      } else {
        p1 = snapToMmGridWorld(pW);
      }

      const r = Math.hypot(p1.x - cx, p1.y - cy);
      const ang = Math.atan2(p1.y - cy, p1.x - cx);

      o.cx = cx; o.cy = cy;
      o.r = r;

      // first movement sets a1
      if (!gesture._arcInit) {
        o.a1 = ang;
        o.a2 = ang;
        gesture._arcInit = true;
      } else {
        o.a2 = ang;
      }

      // shift = snap to 15 degrees (both ends)
      if (e.shiftKey) {
        const snap = (15 * Math.PI) / 180;
        o.a2 = Math.round(o.a2 / snap) * snap;
      }

      drawAll();
      return;
    }

    if (gesture.mode === "moveSel" || gesture.mode === "scaleSel" || gesture.mode === "rotateSel") {
      const sel = getSelected();
      if (!sel || !gesture.selStart) return;

      const before = JSON.parse(gesture.selStart);
      const orig = before.objects.find(x => x.id === sel.id);
      if (!orig) return;

      const dw = { x: pW.x - gesture.startW.x, y: pW.y - gesture.startW.y };

      if (gesture.mode === "moveSel") {
        // translate object
        applyTranslate(sel, orig, dw.x, dw.y);
      }

      if (gesture.mode === "scaleSel") {
        // scale about bbox center (simple)
        const b = getObjBounds(orig);
        if (!b) return;
        const cx = (b.ax + b.bx) / 2;
        const cy = (b.ay + b.by) / 2;

        // scale from screen delta (vertical)
        const ds = (pS.y - gesture.startS.y) * -0.005;
        let s = clamp(1 + ds, 0.05, 30);
        if (e.shiftKey) s = Math.round(s * 10) / 10;
        applyScale(sel, orig, cx, cy, s);
      }

      if (gesture.mode === "rotateSel") {
        const b = getObjBounds(orig);
        if (!b) return;
        const cx = (b.ax + b.bx) / 2;
        const cy = (b.ay + b.by) / 2;
        const a0 = Math.atan2(gesture.startW.y - cy, gesture.startW.x - cx);
        const a1 = Math.atan2(pW.y - cy, pW.x - cx);
        let da = a1 - a0;
        if (e.shiftKey) {
          const snap = (15 * Math.PI) / 180;
          da = Math.round(da / snap) * snap;
        }
        applyRotate(sel, orig, cx, cy, da);
      }

      drawAll();
      return;
    }
  }

  function pointerUp(e) {
    if (!gesture.active) return;
    inkCanvas.releasePointerCapture(e.pointerId);
    gesture._arcInit = false;
    endGesture();
  }

  // ---------------- Transform helpers ----------------
  function applyTranslate(dst, src, dx, dy) {
    Object.assign(dst, JSON.parse(JSON.stringify(src)));

    if (dst.kind === "stroke" || dst.kind === "erase") {
      dst.points = (src.points || []).map(p => ({ x: p.x + dx, y: p.y + dy }));
      return;
    }
    if (dst.kind === "line" || dst.kind === "arrow" || dst.kind === "rect") {
      dst.x1 = src.x1 + dx; dst.y1 = src.y1 + dy;
      dst.x2 = src.x2 + dx; dst.y2 = src.y2 + dy;
      return;
    }
    if (dst.kind === "circle") {
      dst.cx = src.cx + dx; dst.cy = src.cy + dy;
      return;
    }
    if (dst.kind === "arc") {
      dst.cx = src.cx + dx; dst.cy = src.cy + dy;
      return;
    }
    if (dst.kind === "text") {
      dst.x = src.x + dx; dst.y = src.y + dy;
      return;
    }
  }

  function applyScale(dst, src, cx, cy, s) {
    Object.assign(dst, JSON.parse(JSON.stringify(src)));

    const scalePt = (p) => ({ x: cx + (p.x - cx) * s, y: cy + (p.y - cy) * s });

    if (dst.kind === "stroke" || dst.kind === "erase") {
      dst.points = (src.points || []).map(scalePt);
      dst.size = src.size * s;
      return;
    }
    if (dst.kind === "line" || dst.kind === "arrow" || dst.kind === "rect") {
      const p1 = scalePt({ x: src.x1, y: src.y1 });
      const p2 = scalePt({ x: src.x2, y: src.y2 });
      dst.x1 = p1.x; dst.y1 = p1.y;
      dst.x2 = p2.x; dst.y2 = p2.y;
      dst.size = src.size * s;
      return;
    }
    if (dst.kind === "circle") {
      const c = scalePt({ x: src.cx, y: src.cy });
      dst.cx = c.x; dst.cy = c.y;
      dst.r = src.r * s;
      dst.size = src.size * s;
      return;
    }
    if (dst.kind === "arc") {
      const c = scalePt({ x: src.cx, y: src.cy });
      dst.cx = c.x; dst.cy = c.y;
      dst.r = src.r * s;
      dst.size = src.size * s;
      return;
    }
    if (dst.kind === "text") {
      const p = scalePt({ x: src.x, y: src.y });
      dst.x = p.x; dst.y = p.y;
      dst.fontSize = Math.max(10, (src.fontSize || 20) * s);
      return;
    }
  }

  function rotatePt(p, cx, cy, a) {
    const x = p.x - cx, y = p.y - cy;
    const ca = Math.cos(a), sa = Math.sin(a);
    return { x: cx + x * ca - y * sa, y: cy + x * sa + y * ca };
  }

  function applyRotate(dst, src, cx, cy, a) {
    Object.assign(dst, JSON.parse(JSON.stringify(src)));

    if (dst.kind === "stroke" || dst.kind === "erase") {
      dst.points = (src.points || []).map(p => rotatePt(p, cx, cy, a));
      return;
    }
    if (dst.kind === "line" || dst.kind === "arrow" || dst.kind === "rect") {
      const p1 = rotatePt({ x: src.x1, y: src.y1 }, cx, cy, a);
      const p2 = rotatePt({ x: src.x2, y: src.y2 }, cx, cy, a);
      dst.x1 = p1.x; dst.y1 = p1.y;
      dst.x2 = p2.x; dst.y2 = p2.y;
      return;
    }
    if (dst.kind === "circle") {
      const c = rotatePt({ x: src.cx, y: src.cy }, cx, cy, a);
      dst.cx = c.x; dst.cy = c.y;
      return;
    }
    if (dst.kind === "arc") {
      const c = rotatePt({ x: src.cx, y: src.cy }, cx, cy, a);
      dst.cx = c.x; dst.cy = c.y;
      dst.a1 = src.a1 + a;
      dst.a2 = src.a2 + a;
      return;
    }
    if (dst.kind === "text") {
      const p = rotatePt({ x: src.x, y: src.y }, cx, cy, a);
      dst.x = p.x; dst.y = p.y;
      return;
    }
  }

  // ---------------- Wheel zoom to cursor ----------------
  function wheel(e) {
    e.preventDefault();
    const pS = getPointer(e);
    const before = screenToWorld(pS);

    const dz = Math.exp(-e.deltaY * 0.0012);
    const zNew = clamp(state.view.z * dz, 0.15, 10);

    state.view.z = zNew;

    // keep cursor point stable
    const after = worldToScreen(before);
    state.view.x += (pS.x - after.x);
    state.view.y += (pS.y - after.y);

    applyBgTransform();
    drawAll();
  }

  // ---------------- Boards (localStorage) ----------------
  const LS_KEY = "phs_whiteboard_boards_v1";

  function loadBoardsIndex() {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function saveBoardsIndex(obj) {
    localStorage.setItem(LS_KEY, JSON.stringify(obj));
  }

  function refreshBoardSelect() {
    const idx = loadBoardsIndex();
    const names = Object.keys(idx).sort((a, b) => a.localeCompare(b));
    boardSelect.innerHTML = "";
    for (const n of names) {
      const opt = document.createElement("option");
      opt.value = n;
      opt.textContent = n;
      boardSelect.appendChild(opt);
    }
  }

  function currentBoardName() {
    return boardSelect?.value || "";
  }

  function serializeBoard() {
    return {
      v: 1,
      title: state.title,
      pxPerMm: state.pxPerMm,
      objects: state.objects,
      bg: state.bg,
      svgInk: state.svgInk,
      idCounter
    };
  }

  function applyBoard(data) {
    state.title = data.title || "";
    state.pxPerMm = data.pxPerMm || 3.78;
    state.objects = data.objects || [];
    state.bg = data.bg || state.bg;
    state.svgInk = data.svgInk ?? null;
    idCounter = data.idCounter || idCounter;

    if (titleInput) titleInput.value = state.title;
    updateScaleOut();

    if (state.bg.src) {
      bgImg.src = state.bg.src;
      bgLayer.style.display = "block";
    } else {
      bgLayer.style.display = "none";
    }
    applyBgTransform();
    drawAll();
  }

  // ---------------- Export ----------------
  function exportPNG() {
    // bake BG + ink into one canvas at screen resolution
    const r = stage.getBoundingClientRect();
    const out = document.createElement("canvas");
    out.width = Math.round(r.width);
    out.height = Math.round(r.height);
    const ctx = out.getContext("2d");

    // background (draw via bgImg with computed transform)
    if (state.bg.src && bgImg.complete && bgImg.naturalWidth) {
      ctx.save();
      // draw as screen transform already includes view+bg
      // replicate transform:
      const z = state.view.z;
      const tx = state.view.x + state.bg.x * z;
      const ty = state.view.y + state.bg.y * z;
      const sc = state.bg.scale * z;
      ctx.translate(tx, ty);
      ctx.rotate(state.bg.rot);
      ctx.scale(sc, sc);
      ctx.drawImage(bgImg, 0, 0);
      ctx.restore();
    }

    // ink: draw world with view transform
    ctx.save();
    ctx.translate(state.view.x, state.view.y);
    ctx.scale(state.view.z, state.view.z);
    for (const o of state.objects) {
      // reuse drawing by temporarily redirecting
    }
    ctx.restore();

    // easiest: copy rendered inkCanvas (already correct) onto export
    ctx.drawImage(inkCanvas, 0, 0, r.width, r.height);

    out.toBlob(blob => {
      if (!blob) return;
      downloadBlob("whiteboard.png", blob);
    });
  }

  function exportSVG() {
    // compute bounds around all objects + bg (rough)
    let ax = Infinity, ay = Infinity, bx = -Infinity, by = -Infinity;

    function addBounds(b) {
      if (!b) return;
      ax = Math.min(ax, b.ax); ay = Math.min(ay, b.ay);
      bx = Math.max(bx, b.bx); by = Math.max(by, b.by);
    }

    for (const o of state.objects) addBounds(getObjBounds(o));
    if (!isFinite(ax)) { ax = 0; ay = 0; bx = 800; by = 600; }

    const w = Math.max(10, bx - ax);
    const h = Math.max(10, by - ay);

    const esc = (s) => String(s).replace(/[&<>"]/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"
    }[c]));

    let svg = "";
    svg += `<?xml version="1.0" encoding="UTF-8"?>\n`;
    svg += `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${ax} ${ay} ${w} ${h}">\n`;

    // background image (if any)
    if (state.bg.src) {
      // embed as href; assumes browser can resolve data URL / same-origin URL
      const tx = state.bg.x;
      const ty = state.bg.y;
      const rot = state.bg.rot;
      const sc = state.bg.scale;
      svg += `  <image href="${esc(state.bg.src)}" x="0" y="0" width="${state.bg.natW}" height="${state.bg.natH}" `;
      svg += `transform="translate(${tx} ${ty}) rotate(${(rot * 180) / Math.PI}) scale(${sc})" />\n`;
    }

    // objects
    for (const o of state.objects) {
      if (o.hidden) continue;
      const op = (o.kind === "erase") ? 1 : (o.opacity ?? 1);

      if (o.kind === "stroke") {
        const pts = o.points || [];
        if (pts.length < 2) continue;
        let d = `M ${pts[0].x} ${pts[0].y}`;
        for (let i = 1; i < pts.length; i++) d += ` L ${pts[i].x} ${pts[i].y}`;
        svg += `  <path d="${d}" fill="none" stroke="${esc(o.color)}" stroke-opacity="${op}" stroke-width="${o.size}" stroke-linecap="round" stroke-linejoin="round"/>\n`;
      }

      if (o.kind === "line") {
        svg += `  <line x1="${o.x1}" y1="${o.y1}" x2="${o.x2}" y2="${o.y2}" stroke="${esc(o.color)}" stroke-opacity="${op}" stroke-width="${o.size}" stroke-linecap="round"/>\n`;
      }

      if (o.kind === "arrow") {
        // line + simple polygon head
        const a = { x: o.x1, y: o.y1 };
        const b = { x: o.x2, y: o.y2 };
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        const headLen = Math.max(10, o.size * 3);
        const headAng = 28 * Math.PI / 180;
        const p1 = { x: b.x - Math.cos(ang - headAng) * headLen, y: b.y - Math.sin(ang - headAng) * headLen };
        const p2 = { x: b.x - Math.cos(ang + headAng) * headLen, y: b.y - Math.sin(ang + headAng) * headLen };

        svg += `  <line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${esc(o.color)}" stroke-opacity="${op}" stroke-width="${o.size}" stroke-linecap="round"/>\n`;
        svg += `  <polygon points="${b.x},${b.y} ${p1.x},${p1.y} ${p2.x},${p2.y}" fill="${esc(o.color)}" fill-opacity="${op}"/>\n`;
      }

      if (o.kind === "rect") {
        const x = Math.min(o.x1, o.x2);
        const y = Math.min(o.y1, o.y2);
        const rw = Math.abs(o.x2 - o.x1);
        const rh = Math.abs(o.y2 - o.y1);
        svg += `  <rect x="${x}" y="${y}" width="${rw}" height="${rh}" fill="none" stroke="${esc(o.color)}" stroke-opacity="${op}" stroke-width="${o.size}" />\n`;
      }

      if (o.kind === "circle") {
        svg += `  <circle cx="${o.cx}" cy="${o.cy}" r="${o.r}" fill="none" stroke="${esc(o.color)}" stroke-opacity="${op}" stroke-width="${o.size}" />\n`;
      }

      if (o.kind === "arc") {
        // approximate arc with SVG path using A command
        // compute endpoints
        const x1 = o.cx + Math.cos(o.a1) * o.r;
        const y1 = o.cy + Math.sin(o.a1) * o.r;
        const x2 = o.cx + Math.cos(o.a2) * o.r;
        const y2 = o.cy + Math.sin(o.a2) * o.r;

        // large-arc flag (rough)
        let da = normAngle(o.a2 - o.a1);
        const large = Math.abs(da) > Math.PI ? 1 : 0;
        const sweep = o.ccw ? 0 : 1;

        svg += `  <path d="M ${x1} ${y1} A ${o.r} ${o.r} 0 ${large} ${sweep} ${x2} ${y2}" fill="none" stroke="${esc(o.color)}" stroke-opacity="${op}" stroke-width="${o.size}" stroke-linecap="round"/>\n`;
      }

      if (o.kind === "text") {
        svg += `  <text x="${o.x}" y="${o.y}" fill="${esc(o.color)}" fill-opacity="${op}" font-size="${o.fontSize || 20}" font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial">${esc(o.text || "")}</text>\n`;
      }

      // eraser not represented in SVG (destination-out). You can extend this later with masks.
    }

    svg += `</svg>\n`;

    downloadBlob("whiteboard.svg", new Blob([svg], { type: "image/svg+xml" }));
  }

  // ---------------- Scale from line ----------------
  function setScaleFromLine() {
    // use selected line if available, else last line
    const sel = getSelected();
    let o = sel && (sel.kind === "line" || sel.kind === "arrow") ? sel : null;
    if (!o) {
      for (let i = state.objects.length - 1; i >= 0; i--) {
        const t = state.objects[i];
        if (t.kind === "line" || t.kind === "arrow") { o = t; break; }
      }
    }
    if (!o) {
      alert("Draw or select a line first.");
      return;
    }

    const pxLen = Math.hypot(o.x2 - o.x1, o.y2 - o.y1);
    const mm = prompt("Enter the real length of this line in mm:");
    if (mm == null) return;
    const mmNum = Number(mm);
    if (!isFinite(mmNum) || mmNum <= 0) {
      alert("Invalid mm value.");
      return;
    }
    pushUndo();
    state.pxPerMm = pxLen / mmNum;
    updateScaleOut();
    drawAll();
    showToast("Scale set");
  }

  // ---------------- Settings panel ----------------
  function openSettings() {
    settingsPanel?.classList.remove("is-hidden");
    settingsBtn?.setAttribute("aria-expanded", "true");
  }
  function closeSettings() {
    settingsPanel?.classList.add("is-hidden");
    settingsBtn?.setAttribute("aria-expanded", "false");
  }

  // ---------------- Color popover ----------------
  function toggleColorPop() {
    if (!colorPop) return;
    colorPop.classList.toggle("is-hidden");
  }

  // ---------------- Clear ----------------
  function clearInk() {
    pushUndo();
    state.objects = [];
    state.selectedId = null;
    drawAll();
    setTool("pen");
  }

  // ---------------- Background load ----------------
  function loadBgFile(file) {
    const fr = new FileReader();
    fr.onload = () => {
      pushUndo();
      state.bg.src = String(fr.result);
      bgImg.onload = () => {
        state.bg.natW = bgImg.naturalWidth || 0;
        state.bg.natH = bgImg.naturalHeight || 0;
        // place at origin
        state.bg.x = 0;
        state.bg.y = 0;
        state.bg.scale = 1;
        state.bg.rot = 0;
        applyBgTransform();
        drawAll();
      };
      bgImg.src = state.bg.src;
    };
    fr.readAsDataURL(file);
  }

  function clearBg() {
    pushUndo();
    state.bg.src = "";
    state.bg.natW = 0;
    state.bg.natH = 0;
    bgImg.src = "";
    applyBgTransform();
    drawAll();
  }

  // ---------------- SVG ink hooks (safe no-op) ----------------
  function importSvgInk(file) {
    const fr = new FileReader();
    fr.onload = () => {
      pushUndo();
      state.svgInk = { raw: String(fr.result) };
      showToast("SVG loaded");
      // (This build doesn’t parse/edit SVG paths; it just stores it so you can extend later)
    };
    fr.readAsText(file);
  }

  function clearSvgInk() {
    pushUndo();
    state.svgInk = null;
    showToast("SVG cleared");
  }

  // ---------------- Keyboard ----------------
  function keyDown(e) {
    if (e.key === " ") {
      keys.space = true;
      return;
    }

    // Undo/redo
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
      e.preventDefault();
      undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) {
      e.preventDefault();
      redo();
      return;
    }

    // Delete selection
    if (e.key === "Delete" || e.key === "Backspace") {
      const sel = getSelected();
      if (sel) {
        e.preventDefault();
        pushUndo();
        state.objects = state.objects.filter(o => o.id !== sel.id);
        state.selectedId = null;
        drawAll();
      }
    }
  }

  function keyUp(e) {
    if (e.key === " ") keys.space = false;
  }

  // ---------------- Wiring ----------------
  window.addEventListener("resize", resizeCanvases);

  inkCanvas.addEventListener("pointerdown", pointerDown);
  inkCanvas.addEventListener("pointermove", pointerMove);
  inkCanvas.addEventListener("pointerup", pointerUp);
  inkCanvas.addEventListener("pointercancel", pointerUp);
  inkCanvas.addEventListener("wheel", wheel, { passive: false });

  document.addEventListener("keydown", keyDown);
  document.addEventListener("keyup", keyUp);

  toolButtons.forEach(btn => btn.addEventListener("click", () => setTool(btn.dataset.tool)));

  colorBtn?.addEventListener("click", toggleColorPop);
  colorInput?.addEventListener("input", () => setColor(colorInput.value));
  brushSize?.addEventListener("input", () => setSize(brushSize.value));

  opacityRange?.addEventListener("input", () => {
    const pct = Number(opacityRange.value);
    setOpacity01((isFinite(pct) ? pct : 100) / 100);
  });

  clearBtn?.addEventListener("click", clearInk);

  settingsBtn?.addEventListener("click", () => {
    if (settingsPanel.classList.contains("is-hidden")) openSettings();
    else closeSettings();
  });
  settingsCloseBtn?.addEventListener("click", closeSettings);

  applyTitleBtn?.addEventListener("click", () => {
    pushUndo();
    state.title = titleInput?.value || "";
    drawAll();
  });

  bgFile?.addEventListener("change", () => {
    const f = bgFile.files?.[0];
    if (f) loadBgFile(f);
    bgFile.value = "";
  });
  clearBgBtn?.addEventListener("click", clearBg);

  svgInkFile?.addEventListener("change", () => {
    const f = svgInkFile.files?.[0];
    if (f) importSvgInk(f);
    svgInkFile.value = "";
  });
  clearSvgInkBtn?.addEventListener("click", clearSvgInk);

  setScaleBtn?.addEventListener("click", setScaleFromLine);
  resetScaleBtn?.addEventListener("click", () => {
    pushUndo();
    state.pxPerMm = 3.78;
    updateScaleOut();
    showToast("Scale reset");
  });

  exportBtn?.addEventListener("click", exportPNG);
  exportSvgBtn?.addEventListener("click", exportSVG);

  newBoardBtn?.addEventListener("click", () => {
    const name = prompt("New board name:");
    if (!name) return;
    const idx = loadBoardsIndex();
    if (idx[name]) {
      alert("That board already exists.");
      return;
    }
    idx[name] = serializeBoard();
    saveBoardsIndex(idx);
    refreshBoardSelect();
    boardSelect.value = name;
    showToast("Board created");
  });

  saveBoardBtn?.addEventListener("click", () => {
    const name = currentBoardName();
    if (!name) {
      alert("Choose a board name (New) first.");
      return;
    }
    const idx = loadBoardsIndex();
    idx[name] = serializeBoard();
    saveBoardsIndex(idx);
    showToast("Saved");
  });

  loadBoardBtn?.addEventListener("click", () => {
    const name = currentBoardName();
    if (!name) return;
    const idx = loadBoardsIndex();
    if (!idx[name]) return;
    pushUndo();
    applyBoard(idx[name]);
    showToast("Loaded");
  });

  deleteBoardBtn?.addEventListener("click", () => {
    const name = currentBoardName();
    if (!name) return;
    if (!confirm(`Delete board "${name}"?`)) return;
    const idx = loadBoardsIndex();
    delete idx[name];
    saveBoardsIndex(idx);
    refreshBoardSelect();
    showToast("Deleted");
  });

  deleteAllBoardsBtn?.addEventListener("click", () => {
    if (!confirm("Delete ALL boards? This cannot be undone.")) return;
    localStorage.removeItem(LS_KEY);
    refreshBoardSelect();
    showToast("All deleted");
  });

  // ---------------- Init ----------------
  function init() {
    setColor(state.color);
    setSize(state.size);
    setOpacity01(1);
    updateScaleOut();

    // default view center-ish
    state.view.x = 0;
    state.view.y = 0;
    state.view.z = 1;

    refreshBoardSelect();
    resizeCanvases();
    drawAll();
  }

  init();
})();
