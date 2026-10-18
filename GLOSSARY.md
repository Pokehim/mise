# Mise

A Mover scans a real room with an iPhone and then reimagines it: they try out furniture, colors, and materials in a photorealistic copy of the room before they buy or move anything.

## Language

**Mover**:
The person the product serves: someone about to move into, or who has just moved into, a new space, such as a college freshman in a dorm or a new homeowner.
_Avoid_: User (too generic), customer, designer

**Scan**:
The captured copy of one real room: it looks like the room, and it knows the room's walls, floor, Openings, and furniture with their real-world dimensions. A Scan is made once, from its Captures plus Room Setup, and is never changed by Designs.
_Avoid_: Model, capture, room (when you mean the digital copy)

**Capture**:
One walk-through of the real room with a scanning app, such as Polycam or KIRI Engine. A Scan is built from one Main Capture plus any number of Fill Captures and Detail Captures.
_Avoid_: Scan (a Scan is what the Captures and Room Setup produce), take, pass

**Main Capture**:
The Capture taken with the furniture in its usual places. Room Setup, the Originals, and the photoreal look all come from it.
_Avoid_: Primary scan, base scan

**Fill Capture**:
An extra Capture of the whole room, used only for what the Main Capture missed: holes anywhere in the room, and, if furniture was moved for it, the floor and walls that furniture hid and the furniture's own backs and sides.
_Avoid_: Clean plate, reveal scan, empty scan

**Detail Capture**:
A close-up Capture of a few Originals, such as one table and its chairs, used to replace their geometry with a sharper copy.
_Avoid_: Object scan, close-up, hero scan

**Layout**:
A clean plan of the room from KIRI Engine's Room mode: walls, Openings, and furniture as labeled boxes at real size, with no scanned surfaces. Room Setup starts from it.
_Avoid_: Floor plan, RoomPlan model, blueprint

**Room Setup**:
The one-time step that turns the Captures into a usable Scan: it marks the floor, walls, Openings, and Originals on the Main Capture, starting from the Layout when there is one, and lines up every other Capture with the Main Capture.
_Avoid_: Annotation, labeling, calibration

**Opening**:
A door or window in a wall of a Scan.
_Avoid_: Aperture, gap, hole

**Design**:
One reimagining of a Scan: the full set of Edits applied on top of it. A Scan has many Designs, and each can be customized and shared on its own.
_Avoid_: Version, layout, project, remix

### What's in a room

**Surface**:
A wall or the floor of a Scan.
_Avoid_: Plane, mesh, background

**Original**:
A furniture item that was physically in the room when it was scanned, such as the Mover's own table.
_Avoid_: Fixture, scanned object, existing item

**Piece**:
A furniture or decor item added to a Design, either taken from the Catalog or generated on request.
_Avoid_: Asset, model, product, object (when you mean an added item)

**Catalog**:
The curated, pre-built collection of real furniture and decor items, each with true real-world dimensions, that Pieces are chosen from.
_Avoid_: Library, store, inventory, database

### Changing a room

**Edit**:
One change to a Design, such as placing, swapping, recoloring, resizing, moving, or removing something. The Mover and Claude make changes using the same set of Edits.
_Avoid_: Action, operation, command, mutation

**Brief**:
What the Mover asks for when they ask Claude to generate Designs: a free-text description of what they want, optionally narrowed by style and budget.
_Avoid_: Prompt, query, request

**Refine**:
A follow-up instruction from the Mover asking Claude to adjust one existing Design.
_Avoid_: Regenerate, edit (an Edit is a single change, not an instruction)

**Kept**:
Describes an Original the Mover has marked as staying, such as a dorm-provided bed. A Kept Original may be recolored but never moved, replaced, or removed.
_Avoid_: Locked, pinned, fixed

**Finish**:
The look applied to a Surface, an Original, or a Part: either a paint color or a material from the Material Library. A Finish keeps the room's real lighting and shadows.
_Avoid_: Texture, skin, material (when you mean what was applied)

**Material Library**:
The curated set of materials, such as woods, stones, fabrics, metals, and paints, that a Finish can use.
_Avoid_: Texture pack, swatches

**Part**:
A distinct region of an Original or a Piece, such as a table's top or its legs, that can be recolored on its own. Parts of an Original can also take a Finish.
_Avoid_: Component, sub-mesh, segment

**Fit rule**:
A spatial rule every Design is checked against, such as keeping a door's swing clear or not overlapping another item.
_Avoid_: Constraint, validation, collision

**Anchor**:
A placement described by its relationship to the room, such as "against the north wall" or "beside the bed", instead of by coordinates.
_Avoid_: Slot, snap point, position

**Lift**:
Separating an Original from the rest of the Scan so it can be moved or changed on its own.
_Avoid_: Extract, cut out, segment

**Completion**:
The parts of a moved Original that only a Fill Capture saw, such as its back against the wall, added so the Original looks whole once it moves.
_Avoid_: Reconstruction, infill

**Patch**:
What covers the spot an Original used to occupy, including the wall behind it, after it has been lifted away or removed: the real floor and wall from a Fill Capture wherever one saw them, and a generated fill where none did.
_Avoid_: Hole fill, inpaint (that is how part of a Patch is made, not what it is)
