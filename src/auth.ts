import { osmAuth } from 'osm-auth';
import { API_URL } from './osmApi.js';

export const CLIENT_ID: string = import.meta.env.VITE_OSM_CLIENT_ID ?? '';

/**
 * Single-page mode: OSM redirects back to this page with `?code=…`. The
 * redirect URI must be registered with the OAuth 2 application on
 * openstreetmap.org.
 */
export const auth = new osmAuth({
  client_id: CLIENT_ID,
  redirect_uri: window.location.origin + window.location.pathname,
  scope: 'read_prefs write_api',
  singlepage: true,
});

function authenticate(): Promise<void> {
  return new Promise((resolve, reject) => {
    auth.authenticate((err: unknown) => (err ? reject(err) : resolve()));
  });
}

/** Starts the login; the browser leaves the page. */
export function login(): void {
  void authenticate();
}

export function logout(): void {
  auth.logout();
}

/**
 * Finishes a login if OSM has just redirected back to the page. Returns true
 * if the user has just logged in.
 */
export async function handleRedirect(): Promise<boolean> {
  const params = new URLSearchParams(window.location.search);
  if (!params.has('code') && !params.has('error')) {
    return false;
  }
  try {
    if (params.has('error')) {
      throw new Error(params.get('error_description') ?? params.get('error') ?? 'Login fehlgeschlagen');
    }
    await authenticate();
    return true;
  } finally {
    window.history.replaceState(null, '', window.location.pathname);
  }
}

export async function userName(): Promise<string | undefined> {
  const response = await auth.fetch(`${API_URL}/user/details.json`, { method: 'GET' });
  if (!response.ok) {
    return undefined;
  }
  const data = (await response.json()) as { user?: { display_name?: string } };
  return data.user?.display_name;
}
