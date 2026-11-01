import { describe, expect, it } from 'vitest';
import { intersect, SELECTION_SIZE_M, selectionBounds } from '../src/selection.js';

/** Distance in metres along a meridian or parallel (equirectangular, fine for 500 m). */
function sides(box: { south: number; west: number; north: number; east: number }) {
  const lat = ((box.south + box.north) / 2) * (Math.PI / 180);
  return {
    height: (box.north - box.south) * 111_320,
    width: (box.east - box.west) * 111_320 * Math.cos(lat),
  };
}

describe('selectionBounds', () => {
  it('is a square of 500 m around the point, also far north', () => {
    for (const lat of [0, 50.684, 70]) {
      const { width, height } = sides(selectionBounds(lat, 10.917));
      expect(width).toBeCloseTo(SELECTION_SIZE_M, 0);
      expect(height).toBeCloseTo(SELECTION_SIZE_M, 0);
    }
  });
});

describe('intersect', () => {
  it('limits the frame to the visible part of the map', () => {
    const frame = { south: 0, west: 0, north: 2, east: 2 };
    expect(intersect(frame, { south: 1, west: -1, north: 3, east: 1.5 })).toEqual({ south: 1, west: 0, north: 2, east: 1.5 });
    expect(intersect(frame, { south: -5, west: -5, north: 5, east: 5 })).toEqual(frame);
  });
});
