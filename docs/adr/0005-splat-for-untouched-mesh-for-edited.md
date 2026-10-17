# Untouched things render from the splat; anything an Edit touches renders from the mesh

In the photoreal phase, a Scan has two looks of the same room in the same coordinates:

- **The splat:** photoreal, but has no surfaces we can texture, cut, or shadow.
- **The Polycam mesh:** looks less real, but can be cut into Originals and Surfaces, painted, and can receive shadows.

The rule: anything no Edit has touched renders from the splat. Once an Edit touches a wall, the floor, or an Original, that region's splats are hidden and its mesh is shown with the change applied. The renderer turns every Edit into four primitives: hide a region, recolor a region, add a mesh, move a region.

We chose this over editing splats directly (no surfaces for materials, no shadows) and over a mesh-only look (looks scanned, not photoreal). The result is photoreal wherever nothing changed and fully editable wherever something did.

## Consequences

- Edited objects show a visible step down in realism compared with their surroundings.
- The splat must be aligned to the mesh. The transform between them is tuned by hand and stored with the Scan.
- If the splat fails, the fallback is mesh-only rendering, and the editor and Edits don't change at all.
