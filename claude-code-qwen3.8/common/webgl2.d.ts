// Ambient WebGL2 capabilities not fully covered by lib.dom, extended as the FX
// layer needs specific constants/behaviours. Kept out of the domain so the
// simulation stays DOM-free. See ADR 0001 — all effects are screen-space on a
// composited 2D image; there is no 3D scene.
export {}
