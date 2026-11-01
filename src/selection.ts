import type { BBox } from './overpass.js';

/** Side of the square that is downloaded at most, in metres. */
export const SELECTION_SIZE_M = 500;
/** Below this zoom the selection frame is too small to see; downloading is disabled. */
export const MIN_DOWNLOAD_ZOOM = 14;

const METRES_PER_DEGREE_LAT = 111_320;

/** The square of `SELECTION_SIZE_M` around a point. */
export function selectionBounds(lat: number, lon: number): BBox {
  const half = SELECTION_SIZE_M / 2;
  const dLat = half / METRES_PER_DEGREE_LAT;
  const dLon = half / (METRES_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180));
  return { south: lat - dLat, west: lon - dLon, north: lat + dLat, east: lon + dLon };
}

/** The part of the box that is also inside `limit`. */
export function intersect(box: BBox, limit: BBox): BBox {
  return {
    south: Math.max(box.south, limit.south),
    west: Math.max(box.west, limit.west),
    north: Math.min(box.north, limit.north),
    east: Math.min(box.east, limit.east),
  };
}
