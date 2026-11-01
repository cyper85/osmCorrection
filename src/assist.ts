import {
  assess,
  AssistError,
  CLAUDE_MODELS,
  claudeModel,
  estimateCost,
  type AssistRequest,
  type AssistResult,
  type Proposal,
  type RejectReason,
  type Signal,
  type SignalKind,
  type SiteReading,
  type Validate,
} from 'osmassist';
import type { CountryCode } from 'osmvalidation';
import { CHECKS, coversKey, evaluate, type Check, type Issue } from './checks.js';
import type { OsmElement } from './osm.js';
import { isRecentlyChecked } from './verification.js';

/*
 * AI assistance (docs/ki-unterstuetzung.md): on request, Claude reads the
 * website of one element and suggests changed or missing tags. Every
 * suggestion is shown with its quote and has to be accepted one by one.
 */

/** The website keys an element is analyzed by, in this order. */
const SITE_KEYS = ['contact:website', 'website', 'url'];

export const ASSIST_ONLINE = {
  id: 'ai-assist',
  label: 'Mit KI abgleichen',
  keyPattern: '^(contact:)?website$|^url$',
} as const;

const KEY_STORAGE = 'osmCorrection.aiKey';
const MODEL_STORAGE = 'osmCorrection.aiModel';

// ---------------------------------------------------------------- settings

/** The API key: for the session, or remembered in this browser. */
export function apiKey(): string {
  try {
    return sessionStorage.getItem(KEY_STORAGE) ?? localStorage.getItem(KEY_STORAGE) ?? '';
  } catch {
    return '';
  }
}

export function keyRemembered(): boolean {
  try {
    return localStorage.getItem(KEY_STORAGE) !== null;
  } catch {
    return false;
  }
}

export function saveApiKey(key: string, remember: boolean): void {
  try {
    sessionStorage.removeItem(KEY_STORAGE);
    localStorage.removeItem(KEY_STORAGE);
    if (key !== '') {
      (remember ? localStorage : sessionStorage).setItem(KEY_STORAGE, key);
    }
  } catch {
    // no storage: the key is lost on reload
  }
}

export const MODELS = CLAUDE_MODELS.map((id) => ({ id, label: claudeModel(id).name }));

export function selectedModel(): string {
  try {
    const stored = localStorage.getItem(MODEL_STORAGE);
    return MODELS.some((m) => m.id === stored) && stored !== null ? stored : MODELS[0]!.id;
  } catch {
    return MODELS[0]!.id;
  }
}

export function saveModel(id: string): void {
  try {
    localStorage.setItem(MODEL_STORAGE, id);
  } catch {
    // ignore
  }
}

/** Rough cost of one analysis: 10,000 to 30,000 input tokens (see the draft). */
export function costRange(model: string): string {
  const low = estimateCost(model, 10_000, 1_000);
  const high = estimateCost(model, 30_000, 2_000);
  return low === undefined || high === undefined ? '' : `ca. ${dollars(low)} bis ${dollars(high)}`;
}

export function dollars(amount: number): string {
  return `${amount.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: amount < 0.1 ? 3 : 2 })} $`;
}

// ---------------------------------------------------------------- findings

/** The website the element is analyzed by. */
export function siteOf(element: OsmElement): { key: string; url: string } | undefined {
  const key = SITE_KEYS.find((k) => element.tags[k] !== undefined);
  return key === undefined ? undefined : { key, url: element.tags[key]!.split(';')[0]!.trim() };
}

const SITE_CHECK = CHECKS.find((c) => c.id === 'url')!;

/** One finding per element with a website whose opening hours were not checked recently. */
export function assistIssues(elements: OsmElement[], now = new Date()): Issue[] {
  return elements.flatMap((element): Issue[] => {
    const site = siteOf(element);
    if (site === undefined || isRecentlyChecked(element, 'opening_hours', now)) {
      return [];
    }
    return [
      {
        element,
        key: site.key,
        value: element.tags[site.key]!,
        check: SITE_CHECK,
        kind: 'assist',
        valid: true,
        message: 'Website mit KI auswerten: Öffnungszeiten, Telefon, E-Mail, verlinkte Profile und Hinweise auf eine Schließung.',
      },
    ];
  });
}

type OpeningHours = new (value: string, nominatim: null, options: { mode: number; tag_key: string }) => {
  prettifyValue(): string;
};
let openingHours: Promise<OpeningHours> | undefined;

/** The opening_hours parser, loaded only when needed (it is large). */
function loadOpeningHours(): Promise<OpeningHours> {
  openingHours ??= import('opening_hours').then((module) => module.default as unknown as OpeningHours);
  return openingHours;
}

function checkOpeningHours(parser: OpeningHours, value: string) {
  try {
    return { valid: true, value: new parser(value, null, { mode: 0, tag_key: 'opening_hours' }).prettifyValue() };
  } catch (error) {
    const message = String(error).split('\n')[0] ?? '';
    return { valid: false, value, message: `Ungültige Öffnungszeiten: ${message}` };
  }
}

/** A check for opening hours, so the review can check edited values. */
async function openingHoursCheck(): Promise<Check> {
  const parser = await loadOpeningHours();
  return {
    id: 'opening_hours',
    label: 'Öffnungszeiten',
    keyPattern: '^opening_hours$',
    multiValue: false,
    validate: (value) => {
      const result = checkOpeningHours(parser, value);
      return result.valid
        ? { valid: true, code: 'OK', message: 'Gültige Öffnungszeiten', ...(result.value === value ? {} : { suggestion: result.value }) }
        : { valid: false, code: 'OPENING_HOURS_INVALID', message: result.message ?? '' };
    },
  };
}

/** Format check of suggestions with the checks of osmCorrection. */
function validator(parser: OpeningHours, country: CountryCode | undefined): Validate {
  return (key, value) => {
    if (key === 'opening_hours') {
      return checkOpeningHours(parser, value);
    }
    const check = CHECKS.find((c) => coversKey(c, key));
    if (check === undefined) {
      return { valid: true, value };
    }
    const result = evaluate(check, value, country === undefined ? {} : { country });
    return { valid: result.valid, value: result.suggestion ?? value, message: result.message };
  };
}

const SIGNALS: Record<SignalKind, string> = {
  closed: 'Laut Website dauerhaft geschlossen. „Gibt es nicht mehr …“ verwenden?',
  moved: 'Laut Website umgezogen. „Vor Ort prüfen …“ verwenden?',
  parked: 'Die Domain ist geparkt oder steht zum Verkauf. Website löschen oder „Vor Ort prüfen …“?',
  new_owner: 'Die Website gehört inzwischen jemand anderem. Website löschen oder „Vor Ort prüfen …“?',
};

export const REJECTED: Record<RejectReason, string> = {
  unchanged: 'unverändert',
  invalid: 'ungültig',
  quote_not_found: 'nicht auf der Seite gefunden',
  foreign_source: 'Quelle von einer anderen Website',
  unknown_key: 'unbekannter Tag',
};

const FETCH_ERRORS: Record<string, string> = {
  url_not_allowed: 'gesperrt (z. B. robots.txt)',
  url_not_accessible: 'nicht erreichbar',
  unsupported_content_type: 'Inhalt nicht lesbar',
  too_many_requests: 'zu viele Anfragen',
  max_uses_exceeded: 'Seitenlimit erreicht',
};

export function fetchError(code: string): string {
  return FETCH_ERRORS[code] ?? code;
}

const ERRORS: Record<AssistError['code'], string> = {
  auth: 'Der API-Schlüssel wurde abgelehnt. Bitte in der Auswahl einen gültigen Schlüssel eintragen.',
  rate_limit: 'Zu viele Anfragen an die KI, bitte etwas später erneut versuchen.',
  refused: 'Die KI hat die Auswertung abgelehnt.',
  incomplete: 'Die Antwort der KI ist unvollständig.',
  invalid_response: 'Die Antwort der KI war nicht lesbar.',
  api: 'Fehler bei der KI-Schnittstelle.',
  aborted: 'Abgebrochen.',
};

export function errorText(error: unknown): string {
  if (error instanceof AssistError) {
    return error.code === 'api' ? `${ERRORS.api} (${error.message})` : ERRORS[error.code];
  }
  return error instanceof Error ? error.message : String(error);
}

function proposalIssue(element: OsmElement, proposal: Proposal, check: Check, model: string): Issue {
  return {
    element,
    key: proposal.key,
    value: proposal.oldValue ?? '',
    check,
    kind: 'proposal',
    valid: true,
    suggestion: proposal.value,
    message: proposal.oldValue === undefined ? 'Fehlt bisher. Laut Website:' : 'Laut Website geändert:',
    assist: { quote: proposal.quote, sourceUrl: proposal.sourceUrl, model },
  };
}

function signalIssue(element: OsmElement, signal: Signal, model: string): Issue | undefined {
  const site = siteOf(element);
  if (site === undefined) {
    return undefined;
  }
  return {
    element,
    key: site.key,
    value: element.tags[site.key]!,
    check: SITE_CHECK,
    kind: 'signal',
    valid: true,
    message: SIGNALS[signal.kind],
    assist: { quote: signal.quote, sourceUrl: signal.sourceUrl, model },
  };
}

/*
 * What the AI read on a website is kept for the session and reused for other
 * elements with the same website and the same address (e.g. the building and
 * the shop, or a second visit): comparing it with their tags costs nothing.
 * The address is part of the key because a site may list several locations.
 */
const readings = new Map<string, Promise<SiteReading>>();
const ADDRESS_KEYS = ['addr:street', 'addr:housenumber', 'addr:postcode', 'addr:city', 'addr:place'];

function siteUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function readingKey(element: OsmElement): string | undefined {
  const site = siteOf(element);
  if (site === undefined) {
    return undefined;
  }
  const address = ADDRESS_KEYS.map((key) => element.tags[key] ?? '').join('|');
  return `${siteUrl(site.url).toLowerCase().replace(/\/+$/, '')}|${address}`;
}

/** Whether the website of the element was already read in this session. */
export function alreadyRead(element: OsmElement): boolean {
  const key = readingKey(element);
  return key !== undefined && readings.has(key);
}

/**
 * Lets the AI analyze the website of the element, or reuses what it read for
 * the same website and address (unless `fresh`). Returns the result and the
 * new findings (signals first, then the suggestions).
 */
export async function analyze(
  element: OsmElement,
  country: CountryCode | undefined,
  options: { signal?: AbortSignal; today: string; fresh?: boolean },
): Promise<{ result: AssistResult; issues: Issue[]; reused: boolean }> {
  const site = siteOf(element);
  const key = readingKey(element);
  if (site === undefined || key === undefined) {
    throw new Error('Das Objekt hat keine Website.');
  }
  const request: AssistRequest = {
    element: { type: element.type, id: element.id, tags: element.tags },
    url: siteUrl(site.url),
    today: options.today,
    ...(country === undefined ? {} : { country }),
  };
  const parser = await loadOpeningHours();
  let reading = options.fresh === true ? undefined : readings.get(key);
  const reused = reading !== undefined;
  if (reading === undefined) {
    // the SDK is large, it is only loaded when the AI is used
    const { createClaudeProvider } = await import('osmassist/claude');
    const provider = createClaudeProvider({ apiKey: apiKey(), model: selectedModel() });
    const pending = provider.read(request, options.signal === undefined ? {} : { signal: options.signal });
    readings.set(key, pending);
    // a failed or cancelled read is not kept
    pending.catch(() => {
      if (readings.get(key) === pending) {
        readings.delete(key);
      }
    });
    reading = pending;
  }
  const result = assess(await reading, request, validator(parser, country));
  const model = `${result.model.vendor} ${result.model.name}`;
  const hours = await openingHoursCheck();
  const checkFor = (key: string) => (key === 'opening_hours' ? hours : (CHECKS.find((c) => coversKey(c, key)) ?? SITE_CHECK));
  const issues = [
    ...result.signals.flatMap((signal) => signalIssue(element, signal, model) ?? []),
    ...result.proposals.map((proposal) => proposalIssue(element, proposal, checkFor(proposal.key), model)),
  ];
  return { result, issues, reused };
}
