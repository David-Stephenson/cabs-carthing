/** Default polling interval for vehicle + route data (ms). */
export const REFRESH_MS = 10000;

/** Approximate campus center [lat, lng] for initial framing. */
export const OSU_CENTER = [40.0054, -83.0305];

export const FOLLOW_ZOOM = 17;
export const FOLLOW_PITCH = 55;
export const FOLLOW_BEARING = 0;
/** Mapbox easeTo offset [x, y] in pixels — keeps the bus above the HUD bar. */
export const FOLLOW_OFFSET = [0, 100];

export const BUS_MODEL_SCALE = 0.25;
/** Degrees added so the GLTF model forward axis matches map bearing. */
export const BUS_MODEL_HEADING_OFFSET = 180;

/** GeoJSON / Mapbox layer identifiers (single source of truth). */
export const LAYER = {
  ROUTE_SOURCE: 'cc-route',
  ROUTE_IB: 'cc-route-ib',
  ROUTE_OB: 'cc-route-ob',
  BUS_3D: 'bus-3d-layer'
};

/** Snapping heuristics — tuned for OSU shuttle GPS jitter vs drawn polylines. */
export const SNAP = {
  LOOK_AHEAD_METERS: 40,
  MAX_ROUTE_DISTANCE_M: 60,
  PATH_SWITCH_THRESHOLD_M: 30,
  SEGMENT_SEARCH_BACK: 3,
  SEGMENT_SEARCH_FORWARD: 15
};
