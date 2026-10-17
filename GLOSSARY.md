# Room Reimagining

A Mover scans a real room with an iPhone and then reimagines it: they try out furniture, colors, and materials in a photorealistic copy of the room before they buy or move anything.

## Language

**Mover**:
The person the product serves: someone about to move into, or who has just moved into, a new space, such as a college freshman in a dorm or a new homeowner.
_Avoid_: User (too generic), customer, designer

**Scan**:
The captured copy of one real room: it looks like the room, and it knows the room's walls, floor, openings, and furniture with their real-world dimensions. A Scan is made once and never changes.
_Avoid_: Model, capture, room (when you mean the digital copy)

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
