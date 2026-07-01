// Mirrors src/trace/schema.py — keep these in sync.

export type Vec3 = [number, number, number];

export interface TruckInfo {
  length_m: number;
  width_m: number;
  height_m: number;
  resolution_m: number;
  cells: [number, number, number];
}

export interface BoxSpec {
  id: number;
  l_m: number;
  w_m: number;
  h_m: number;
  fragile: boolean;
}

export interface PickEvent {
  t: number;
  type: "pick";
  box_id: number;
  source: Vec3;
}

export interface PlaceEvent {
  t: number;
  type: "place";
  box_id: number;
  target: Vec3;
  size: Vec3;
  orient: number;
}

export type TraceEvent = PickEvent | PlaceEvent;

export type CameraShot =
  | "establish"
  | "truck_approach"
  | "dock_align"
  | "forklift_close"
  | "over_shoulder"
  | "top_down"
  | "orbit"
  | "final_pullback";

export interface CameraCue {
  t: number;
  shot: CameraShot;
  duration: number;
}

export interface Metrics {
  utilization: number;
  boxes_placed: number;
  boxes_total: number;
  duration_s: number;
}

export interface Trace {
  version: number;
  truck: TruckInfo;
  boxes: BoxSpec[];
  events: TraceEvent[];
  camera: CameraCue[];
  metrics: Metrics;
  policy: string;
}
