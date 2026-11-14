# RoyalBlue54L Feather PCB sample

Source: the RoyalBlue54L Feather demo bundled with KiCad 10.0.6, originally by
LordsBoards. Source files in this workspace are preserved in
`artifacts/royalblue54l-source`. See `SOURCE_README.md` and `LICENSE.txt` for
the project's original attribution and CERN-OHL-P-2.0 license.

This GLB was exported from the actual PCB, not reconstructed from a screenshot.
Model paths in a separate copy were resolved to locally installed, same-named
KiCad STEP files or the project's own models. Unavailable duplicate VRML entries
were disabled only where another project model was available. The original PCB
was not edited. No component placement, pad/net, or track edits were made.

The renderer copy merges CAD faces by material within an existing node to reduce
draw calls. It retains all 149696 triangles and all 50 component references.
Component values and pad/net metadata come from the PCB via KiCad's parser.
The project has 71 footprint objects; holes, test points, graphics and several
bare connectors have no separate body model. They must not be represented as
detected chips. No hardware, electrical or enclosure-fit validation is claimed.

KiCad used a DejaVu Sans Book fallback for unavailable Ubuntu Sans. Its export
also reported seven degenerate contour warnings. Export succeeded, but this
sample is for visualization and telemetry binding, not manufacturing validation.
