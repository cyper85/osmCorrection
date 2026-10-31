import type { CountryCode } from 'osmvalidation';

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org';

/** Country at a position, used for phone numbers without `addr:country`. */
export async function countryAt(lat: number, lon: number): Promise<CountryCode | undefined> {
  const params = new URLSearchParams({ format: 'jsonv2', lat: String(lat), lon: String(lon), zoom: '3' });
  const response = await fetch(`${NOMINATIM_URL}/reverse?${params}`);
  if (!response.ok) {
    return undefined;
  }
  const data = (await response.json()) as { address?: { country_code?: string } };
  const code = data.address?.country_code?.toUpperCase();
  return code !== undefined && /^[A-Z]{2}$/.test(code) ? (code as CountryCode) : undefined;
}

export interface Place {
  name: string;
  south: number;
  west: number;
  north: number;
  east: number;
}

export async function search(query: string): Promise<Place | undefined> {
  const params = new URLSearchParams({ format: 'jsonv2', q: query, limit: '1' });
  const response = await fetch(`${NOMINATIM_URL}/search?${params}`);
  if (!response.ok) {
    throw new Error(`Nominatim: HTTP ${response.status}`);
  }
  const [place] = (await response.json()) as { display_name: string; boundingbox: [string, string, string, string] }[];
  if (place === undefined) {
    return undefined;
  }
  const [south, north, west, east] = place.boundingbox.map(Number) as [number, number, number, number];
  return { name: place.display_name, south, west, north, east };
}
