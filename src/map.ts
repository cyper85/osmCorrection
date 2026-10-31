import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { elementCenter, elementLabel, type OsmElement } from './osm.js';
import type { BBox } from './overpass.js';

const VIEW_STORAGE_KEY = 'osmCorrection.view';
const DEFAULT_VIEW = { lat: 50.6841, lon: 10.9171, zoom: 15 };

/** Smallest zoom at which downloading is allowed, to keep Overpass queries small. */
export const MIN_DOWNLOAD_ZOOM = 13;

function savedView(): { lat: number; lon: number; zoom: number } {
  try {
    const view = JSON.parse(localStorage.getItem(VIEW_STORAGE_KEY) ?? 'null') as unknown;
    if (
      typeof view === 'object' && view !== null &&
      'lat' in view && typeof view.lat === 'number' &&
      'lon' in view && typeof view.lon === 'number' &&
      'zoom' in view && typeof view.zoom === 'number'
    ) {
      return { lat: view.lat, lon: view.lon, zoom: view.zoom };
    }
  } catch {
    // no storage or broken value
  }
  return DEFAULT_VIEW;
}

export type MarkerState = 'open' | 'changed' | 'skipped' | 'current';

const MARKER_COLORS: Record<MarkerState, string> = {
  open: '#e8890c',
  changed: '#217a3c',
  skipped: '#8a919e',
  current: '#d7263d',
};

export class MapView {
  readonly map: L.Map;
  private readonly highlight = L.featureGroup();
  private readonly markers = L.featureGroup();
  /** marker per issue index; issues of one element share a marker */
  private markerByIssue: (L.CircleMarker | undefined)[] = [];

  constructor(container: HTMLElement) {
    const view = savedView();
    // canvas is much faster than SVG for hundreds of markers
    this.map = L.map(container, { center: [view.lat, view.lon], zoom: view.zoom, preferCanvas: true });
    this.markers.addTo(this.map);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende',
    }).addTo(this.map);
    this.highlight.addTo(this.map);

    // keep the view across the OAuth redirect and reloads
    this.map.on('moveend', () => {
      const center = this.map.getCenter();
      try {
        localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify({ lat: center.lat, lon: center.lng, zoom: this.map.getZoom() }));
      } catch {
        // ignore
      }
    });
  }

  bbox(): BBox {
    const b = this.map.getBounds();
    return { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() };
  }

  center(): { lat: number; lon: number } {
    const c = this.map.getCenter();
    return { lat: c.lat, lon: c.lng };
  }

  canDownload(): boolean {
    return this.map.getZoom() >= MIN_DOWNLOAD_ZOOM;
  }

  fitBox(south: number, west: number, north: number, east: number): void {
    this.map.fitBounds([[south, west], [north, east]], { maxZoom: 17 });
  }

  /** Highlights the element and moves the map to it. */
  show(element: OsmElement): void {
    this.highlight.clearLayers();
    const style = { color: '#d7263d', weight: 4 };
    let layer: L.Layer & { getBounds?: () => L.LatLngBounds } | undefined;

    if (element.type === 'node' && element.lat !== undefined && element.lon !== undefined) {
      L.circleMarker([element.lat, element.lon], { ...style, radius: 10 }).addTo(this.highlight);
      this.map.setView([element.lat, element.lon], Math.max(this.map.getZoom(), 17));
      return;
    }
    if (element.type === 'way' && element.geometry !== undefined) {
      const points = element.geometry.filter((p) => p !== null).map((p): L.LatLngTuple => [p.lat, p.lon]);
      const first = points[0];
      const last = points[points.length - 1];
      const closed = points.length > 3 && first !== undefined && last !== undefined && first[0] === last[0] && first[1] === last[1];
      layer = closed ? L.polygon(points, style) : L.polyline(points, style);
    } else if (element.bounds !== undefined) {
      const { minlat, minlon, maxlat, maxlon } = element.bounds;
      layer = L.rectangle([[minlat, minlon], [maxlat, maxlon]], { ...style, fill: false, dashArray: '6 6' });
    }
    if (layer?.getBounds !== undefined) {
      layer.addTo(this.highlight);
      this.map.fitBounds(layer.getBounds(), { maxZoom: 18, padding: [40, 40] });
    }
  }

  clearHighlight(): void {
    this.highlight.clearLayers();
  }

  /**
   * Shows a marker for every element with issues. Clicking a marker calls
   * `onSelect` with the index of the element's first issue.
   */
  showIssues(issues: { element: OsmElement }[], onSelect: (index: number) => void): void {
    this.clearIssues();
    const byElement = new Map<OsmElement, L.CircleMarker>();
    this.markerByIssue = issues.map(({ element }, index) => {
      const existing = byElement.get(element);
      if (existing !== undefined) {
        return existing;
      }
      const center = elementCenter(element);
      if (center === undefined) {
        return undefined;
      }
      const marker = L.circleMarker([center.lat, center.lon], {
        radius: 7,
        weight: 2,
        color: '#ffffff',
        fillColor: MARKER_COLORS.open,
        fillOpacity: 0.9,
      })
        .bindTooltip(elementLabel(element))
        .on('click', () => onSelect(index))
        .addTo(this.markers);
      byElement.set(element, marker);
      return marker;
    });
  }

  setIssueState(index: number, state: MarkerState): void {
    const marker = this.markerByIssue[index];
    marker?.setStyle({ fillColor: MARKER_COLORS[state], radius: state === 'current' ? 9 : 7 });
    if (state === 'current') {
      marker?.bringToFront();
    }
  }

  clearIssues(): void {
    this.markers.clearLayers();
    this.markerByIssue = [];
  }
}
