// World-space constants shared by the simulation, the renderers and the DNA
// codec. The playground is simulated in fixed world units and letterboxed onto
// whatever canvas size the layout gives it, so a DNA link decodes to the same
// place on every screen.

export const ARENA = { w: 960, h: 640 };

/** Grid resolution used to quantize the fly position into the DNA (4 bits/axis). */
export const GRID = 16;
/** Heading sectors stored in the DNA (4 bits). */
export const HEADING_SECTORS = 16;
/** Largest score representable in the 12-bit DNA field. */
export const MAX_SCORE = 4095;
/** Number of genes and levels per gene (4 bits each => 24 bits). */
export const GENE_COUNT = 6;
export const GENE_LEVELS = 16;

/** Brain neurons: the FlyWire whole-brain count (Dorkenwald et al. 2024). */
export const BRAIN_NEURONS = 139255;
/** Ventral nerve cord neurons: MANC, the male adult nerve cord (~22.3k). */
export const VNC_NEURONS = 22300;
/** Neurons rendered in 3D: brain + VNC. */
export const NEURON_COUNT = BRAIN_NEURONS + VNC_NEURONS;
