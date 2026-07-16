PHS Whiteboard - Older Drawing Reveal-ID Fix

FILES CHANGED
1. whiteboard.js
2. whiteboard.io.js

WHAT CHANGED
- Every drawable object now receives a separate unique _revealId.
- Hide/show sequencing uses _revealId rather than the geometry _id.
- Existing geometry IDs are preserved for snapping, links and perspective guides.
- Older SVGs and saved boards are migrated automatically when loaded.
- New objects created after loading an older board continue from a safe geometry ID counter.
- Pasted objects receive fresh geometry and reveal IDs.
- Newly imported SVG objects receive reveal IDs immediately.

TESTED WITH
9DVC Product Rendering P3.svg
- 841 drawable objects
- 520 unique old geometry IDs
- 321 duplicate old geometry IDs
- Hide all reported 841 objects
- Reveal advanced continuously through 1/841, 520/841, 521/841 and 841/841
- Previous then returned to 840/841
- No browser console or JavaScript errors

INSTALLATION
Replace both whiteboard.js and whiteboard.io.js in the existing app.
Keep the other files unchanged.

After opening an older editable SVG, the app may show a message such as:
Editable whiteboard loaded - prepared 841 reveal steps

Then use Hide all and the forward/back visibility controls normally.
