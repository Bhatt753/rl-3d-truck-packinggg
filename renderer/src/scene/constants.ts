// Shared world-space anchors for the scene. All units are meters.
// Single source of truth so geometry, animation, and camera stay aligned.

// Outdoor ground (where the truck wheels rest) sits at y=0.
// The warehouse loading dock is raised to match the trailer floor —
// this is how real warehouses are built so forklifts can roll straight in.
export const GROUND_Y = 0.0;
export const DOCK_FLOOR_Y = 1.10;       // raised dock floor (interior)
export const TRAILER_FLOOR_Y = 1.10;    // trailer cargo floor, matches dock

// World x of the trailer rear edge when parked. Trailer extends from here
// in the +x direction (toward the warehouse interior).
export const TRAILER_REAR_X = 0.4;

// Trailer external dimensions (Euro-semi spec).
export const TRAILER_LENGTH = 13.6;     // external box length
export const TRAILER_WIDTH = 2.55;
export const TRAILER_HEIGHT_INTERIOR = 2.50;
export const TRAILER_ROOF_THICKNESS = 0.08;

// Tractor unit (the cab + chassis that pulls the trailer).
export const TRACTOR_LENGTH = 6.20;
export const TRACTOR_CAB_HEIGHT = 3.40;

// Wheels (standard semi-truck tires).
export const WHEEL_RADIUS = 0.50;
export const WHEEL_WIDTH = 0.30;

// Pallet (EUR standard).
export const PALLET_LENGTH = 1.20;
export const PALLET_WIDTH = 0.80;
export const PALLET_HEIGHT = 0.15;

// World y at the top of a pallet sitting on the dock floor.
export const PALLET_TOP_Y = DOCK_FLOOR_Y + PALLET_HEIGHT;
