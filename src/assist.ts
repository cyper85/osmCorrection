import {
  assess,
  AssistError,
  decodeHtml,
  folderPath,
  jobFile,
  parseAnswerFile,
  readingFromAnswer,
  type AnswerFile,
  type ElementId,
  type Job,
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
  type Compare,
  type Validate,
} from 'osmassist';
import type { CountryCode } from 'osmvalidation';
import { CHECKS, coversKey, evaluate, type Check, type Issue } from './checks.js';
import type { OsmElement } from './osm.js';
import { isRecentlyChecked } from './verification.js';
import { language, t } from './i18n.js';

/*
 * AI assistance (docs/ki-unterstuetzung.md): on request, Claude reads the
 * website of one element and suggests changed or missing tags. Every
 * suggestion is shown with its quote and has to be accepted one by one.
 */

/** The website keys an element is analyzed by, in this order. */
const SITE_KEYS = ['contact:website', 'website', 'url'];

export const ASSIST_ONLINE = {
  id: 'ai-assist',
  label: t('check.assist'),
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
  return low === undefined || high === undefined ? '' : t('ai.costRange', { low: dollars(low), high: dollars(high) });
}

export function dollars(amount: number): string {
  return new Intl.NumberFormat(language(), {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: amount < 0.1 ? 3 : 2,
  }).format(amount);
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
        message: t('assist.finding'),
      },
    ];
  });
}

type OpeningHours = new (value: string, nominatim: null, options: { mode: number; tag_key: string }) => {
  prettifyValue(): string;
  getOpenIntervals(from: Date, to: Date): [Date, Date, boolean, string | undefined][];
};
let openingHours: Promise<OpeningHours> | undefined;

/** The opening_hours parser, loaded only when needed (it is large). */
export function loadOpeningHours(): Promise<OpeningHours> {
  openingHours ??= import('opening_hours').then((module) => module.default as unknown as OpeningHours);
  return openingHours;
}

function checkOpeningHours(parser: OpeningHours, value: string) {
  try {
    return { valid: true, value: new parser(value, null, { mode: 0, tag_key: 'opening_hours' }).prettifyValue() };
  } catch (error) {
    const message = String(error).split('\n')[0] ?? '';
    return { valid: false, value, message: t('assist.openingHoursInvalid', { message }) };
  }
}

/** A check for opening hours, so the review can check edited values. */
async function openingHoursCheck(): Promise<Check> {
  const parser = await loadOpeningHours();
  return {
    id: 'opening_hours',
    label: t('assist.openingHours'),
    keyPattern: '^opening_hours$',
    multiValue: false,
    validate: (value) => {
      const result = checkOpeningHours(parser, value);
      return result.valid
        ? { valid: true, code: 'OK', message: t('assist.openingHoursValid'), ...(result.value === value ? {} : { suggestion: result.value }) }
        : { valid: false, code: 'OPENING_HOURS_INVALID', message: result.message ?? '' };
    },
  };
}

/** A week without public holidays, to compare opening hours by their meaning. */
const REFERENCE_WEEK = [new Date(2026, 2, 9), new Date(2026, 2, 16)] as const;

const PHONE_KEYS = /^(contact:)?(phone|fax|mobile)$/;

/** The digits of each number, as a set: "+49 3677 6414-0" and "+49 3677 64140" are the same number. */
function phoneDigits(value: string): string {
  return value
    .split(';')
    .map((part) => part.replace(/\D/g, ''))
    .filter((digits) => digits !== '')
    .sort()
    .join(';');
}

/**
 * Values that mean the same are no change, so the AI does not suggest a mere
 * reformatting: opening hours that are open at the same times in a normal
 * week ("Mo-Fr 07:00-17:00" and "Mo-Fr 07:00-17:00; Su,PH off", a suggestion
 * would drop the explicit closing days), and phone numbers with the same
 * digits (a suggestion would drop the hyphen before an extension).
 */
export function sameMeaning(parser: OpeningHours): Compare {
  const week = (value: string) =>
    JSON.stringify(
      new parser(value, null, { mode: 0, tag_key: 'opening_hours' })
        .getOpenIntervals(...REFERENCE_WEEK)
        .map(([from, to, unknown]) => [from.getTime(), to.getTime(), unknown]),
    );
  return (key, a, b) => {
    if (PHONE_KEYS.test(key)) {
      return phoneDigits(a) === phoneDigits(b);
    }
    if (key !== 'opening_hours') {
      return false;
    }
    try {
      return week(a) === week(b);
    } catch {
      return false;
    }
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

const signalText = (kind: SignalKind) => t(`assist.signal.${kind}`);

export const rejectedText = (reason: RejectReason) => t(`assist.reject.${reason}`);

const FETCH_ERRORS = ['url_not_allowed', 'url_not_accessible', 'unsupported_content_type', 'too_many_requests', 'max_uses_exceeded'] as const;

export function fetchError(code: string): string {
  const known = FETCH_ERRORS.find((c) => c === code);
  return known === undefined ? code : t(`assist.fetch.${known}`);
}

export function errorText(error: unknown): string {
  if (error instanceof AssistError) {
    const text = t(`assist.error.${error.code}`);
    return error.code === 'api' ? `${text} (${error.message})` : text;
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
    message: proposal.oldValue === undefined ? t('assist.missingBefore') : t('assist.changed'),
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
    message: signalText(signal.kind),
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
    throw new Error(t('assist.noWebsite'));
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
  const result = assess(await reading, request, validator(parser, country), sameMeaning(parser));
  const issues = await findingsOf(element, result, `${result.model.vendor} ${result.model.name}`);
  return { result, issues, reused };
}

/** The findings of an AI result: signals first, then the suggestions. */
async function findingsOf(element: OsmElement, result: AssistResult, model: string): Promise<Issue[]> {
  const hours = await openingHoursCheck();
  const checkFor = (key: string) => (key === 'opening_hours' ? hours : (CHECKS.find((c) => coversKey(c, key)) ?? SITE_CHECK));
  return [
    ...result.signals.flatMap((signal) => signalIssue(element, signal, model) ?? []),
    ...result.proposals.map((proposal) => proposalIssue(element, proposal, checkFor(proposal.key), model)),
  ];
}

// ---------------------------------------------------------------- Claude Code (docs/ki-claude-code.md)

/** Websites per job file: the Claude plan is shared with the normal use. */
export const JOBS_PER_FILE = 15;

/**
 * Jobs for Claude Code: the elements with a website whose opening hours were
 * not checked recently, one job per website and address.
 */
export function exportJobs(elements: OsmElement[], now = new Date()): Job[] {
  const groups = new Map<string, ElementId[]>();
  for (const element of elements) {
    const key = readingKey(element);
    if (key === undefined || isRecentlyChecked(element, 'opening_hours', now)) {
      continue;
    }
    groups.set(key, [...(groups.get(key) ?? []), { type: element.type, id: element.id }]);
  }
  return [...groups.values()].map((group, index) => ({ id: `a${index + 1}`, elements: group }));
}

/** The job files (auftrag.md), split so one run fits into the plan. */
export function jobFiles(jobs: Job[], today: string, size = JOBS_PER_FILE): string[] {
  const parts: Job[][] = [];
  for (let i = 0; i < jobs.length; i += size) {
    parts.push(jobs.slice(i, i + size));
  }
  return parts.map((part, index) =>
    jobFile({
      jobs: part,
      today,
      language: language(),
      ...(parts.length > 1 ? { part: t('agent.part', { part: index + 1, parts: parts.length }) } : {}),
    }),
  );
}

/** Makers of AI models offered when confirming an import; any other name can be entered. */
export const AI_VENDORS = ['Anthropic', 'OpenAI', 'Google', 'Amazon', 'Meta', 'Mistral AI', 'xAI', 'DeepSeek', 'Alibaba'];

/** What the answers state about the AI, e.g. "Anthropic (claude-opus-5-5, Claude Code)", one entry per variant. */
export function statedAi(folder: ImportedFolder): {
  vendors: string[];
  /** stated models, without "unknown" */
  models: string[];
  descriptions: string[];
  missing: number;
} {
  const vendors = new Set<string>();
  const models = new Set<string>();
  const descriptions = new Set<string>();
  let missing = 0;
  for (const answer of folder.answers) {
    if (answer.ai === undefined) {
      missing += 1;
    } else {
      vendors.add(answer.ai.vendor);
      if (answer.ai.model.trim() !== '' && answer.ai.model !== 'unknown') {
        models.add(answer.ai.model.trim());
      }
      descriptions.add(`${answer.ai.vendor} (${answer.ai.model}, ${answer.ai.tool})`);
    }
  }
  return { vendors: [...vendors], models: [...models], descriptions: [...descriptions], missing };
}

/** A model ID in readable form, as for the API: claude-opus-5-5 → Claude Opus 5.5; others as they are. */
export function modelName(model: string): string {
  const trimmed = model.trim();
  return /^claude-/i.test(trimmed) ? claudeModel(trimmed.toLowerCase()).name : trimmed;
}

/**
 * The value for ai_assisted and the changeset comment: the confirmed maker of
 * the model, with the model if it is known, e.g. "Anthropic Claude Opus 5.5".
 */
export function aiLabel(vendor: string, model: string): string {
  const name = modelName(model);
  return name === '' || name.toLowerCase() === 'unknown' ? vendor : `${vendor} ${name}`;
}

export interface ImportedFolder {
  answers: AnswerFile[];
  /** HTML of the saved pages, by path inside the working folder */
  pages: Map<string, string>;
  /** files that could not be read, with the reason */
  errors: string[];
}

/** Reads the working folder of the AI agent (answers/*.json and pages/*.html, in German antworten/ and seiten/). */
export async function readFolder(files: File[]): Promise<ImportedFolder> {
  // inside the chosen folder: "ordner/antworten/a1.json" → "antworten/a1.json"
  const path = (file: File) => folderPath(file.webkitRelativePath || file.name).replace(/^[^/]+\//, '');
  const answers: AnswerFile[] = [];
  const pages = new Map<string, string>();
  const errors: string[] = [];
  for (const file of files) {
    const name = path(file);
    if (/^(antworten|answers)\/[^/]+\.json$/i.test(name)) {
      try {
        answers.push(parseAnswerFile(await file.text()));
      } catch (error) {
        errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else if (/^(seiten|pages)\/[^/]+\.html?$/i.test(name)) {
      pages.set(name, decodeHtml(new Uint8Array(await file.arrayBuffer())));
    }
  }
  return { answers, pages, errors };
}

/** The findings for the imported answers, for the elements as they are now in OSM. */
export async function importFindings(
  folder: ImportedFolder,
  elements: OsmElement[],
  countryOf: (element: OsmElement) => CountryCode | undefined,
  today: string,
  /** maker of the AI model, as confirmed by the user */
  vendor: string,
  /** for ai_assisted, e.g. "Anthropic Claude Opus 5.5" (see aiLabel) */
  label: string = vendor,
): Promise<Issue[]> {
  const parser = await loadOpeningHours();
  const byId = new Map(elements.map((element) => [`${element.type}/${element.id}`, element]));
  const issues: Issue[] = [];
  for (const answer of folder.answers) {
    const reading = readingFromAnswer(answer, folder.pages, vendor);
    for (const ref of answer.elements) {
      const element = byId.get(`${ref.type}/${ref.id}`);
      if (element === undefined) {
        continue;
      }
      const country = countryOf(element);
      const request: AssistRequest = {
        element: { type: element.type, id: element.id, tags: element.tags },
        url: answer.url,
        today,
        ...(country === undefined ? {} : { country }),
      };
      const result = assess(reading, request, validator(parser, country), sameMeaning(parser));
      issues.push(...(await findingsOf(element, result, label)));
    }
  }
  return issues;
}
