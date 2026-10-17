# Parts come from per-category geometry rules, computed when a model loads

Originals are cut from a fused LiDAR mesh, and 99.4% of Amazon Berkeley Objects models are a single material, so neither arrives with Parts. We assign Parts with simple geometric rules per category, evaluated in the object's own box frame when the model loads. For example, a table's top is every triangle within 6 cm of its highest point, and a dresser's fronts are the forward-facing triangles in its front slab. The same rules run for Originals and Pieces.

We rejected AI part segmentation (such as Hunyuan-Part): it's built for clean models, untested on blobby LiDAR shells, and adds latency and a paid dependency. We also rejected having the Mover paint Parts by hand, because it's slow and finicky.

## Consequences

- The rules will be wrong for some unusual shapes. Each Original (in Room Setup) and each Catalog item can override its rule's parameters, such as seat height or top thickness.
- Categories without a rule have a single Part, `body`.
- Each Part gets its own material, and all of them share the model's original texture. That is how one Part can be recolored without the others.
