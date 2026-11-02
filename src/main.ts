import type { CountryCode } from 'osmvalidation';
import { auth, CLIENT_ID, handleRedirect, login, logout, userName } from './auth.js';
import { ChangeStore, type TagChange } from './changes.js';
import { CHECKS, elementCountry, evaluate, findIssues, type Check, type Issue } from './checks.js';
import {
  applyClosure,
  currentActions,
  defaultActions,
  isClosed,
  previewClosure,
  removeTag,
  TAG_ACTIONS,
  updateDeletion,
  type TagAction,
} from './closure.js';
import type { AssistResult } from 'osmassist';
import {
  alreadyRead,
  analyze,
  apiKey,
  AI_VENDORS,
  aiLabel,
  ASSIST_ONLINE,
  assistIssues,
  statedAi,
  type ImportedFolder,
  exportJobs,
  importFindings,
  jobFiles,
  readFolder,
  siteOf,
  costRange,
  dollars,
  errorText,
  fetchError,
  keyRemembered,
  MODELS,
  rejectedText,
  saveApiKey,
  saveModel,
  selectedModel,
} from './assist.js';
import { aiModels, changesetComment, commentLength, MAX_COMMENT } from './comment.js';
import { DUPLICATES, duplicateIssues } from './duplicates.js';
import { SYNONYM_KEYS, synonymIssues } from './synonyms.js';
import { MapView, MIN_DOWNLOAD_ZOOM, SELECTION_SIZE_M, type MarkerState } from './map.js';
import { countryAt, search } from './nominatim.js';
import { elementCenter, elementKey, elementLabel, osmUrl, type OsmElement } from './osm.js';
import { API_URL, applyChanges, fetchCurrent, splitDeletions, upload } from './osmApi.js';
import { createNote, noteFor, noteText, noteUrl, rememberNote } from './notes.js';
import { buildQuery, download, type BBox, type DownloadOptions } from './overpass.js';
import { downloadMap, fetchElements } from './osmMap.js';
import { exportedElements, rememberExported } from './exportCache.js';
import { fetchItems, referenceIssues, referencesToFetch, WIKIDATA_ONLINE } from './references.js';
import {
  CHECK_INTERVAL_MONTHS,
  checkDateKey,
  CONFIRM_ONLINE,
  confirmIssues,
  isVerifiable,
  openableUrl,
  today,
} from './verification.js';
import { browserProbe, probeAll, WEBSITE_ONLINE, websiteIssues, websitesToProbe } from './websites.js';
import { formatList, language, LANGUAGES, setLanguage, t, translatePage, type Lang } from './i18n.js';
import { JOB_FOLDERS } from 'osmassist';
import './style.css';

const GENERATOR = `osmCorrection ${__APP_VERSION__}`;
const CHECK_STORAGE_KEY = 'osmCorrection.checks';
const CHANGE_STORAGE_KEY = 'osmCorrection.changes';

type Step = 'login' | 'select' | 'review' | 'upload';

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`#${id} missing`);
  }
  return element as T;
}

// OSM accepts http redirect URIs only for 127.0.0.1, not for localhost
if (window.location.hostname === 'localhost') {
  const target = new URL(window.location.href);
  target.hostname = '127.0.0.1';
  window.location.replace(target);
}

const mapView = new MapView($('map'));
const changes = new ChangeStore(CHANGE_STORAGE_KEY);
let step: Step = 'login';
let issues: Issue[] = [];
let current = 0;
/** indices of the issues the user has already seen */
let visited = new Set<number>();
let fallbackCountry: CountryCode | undefined;

// ---------------------------------------------------------------- general

function showStep(next: Step): void {
  step = next;
  for (const name of ['login', 'select', 'review', 'upload'] as const) {
    $(`step-${name}`).hidden = name !== next;
  }
  // a large map to select the area, more room for the sidebar while editing
  const editing = next === 'review' || next === 'upload';
  if (document.body.classList.contains('editing') !== editing) {
    document.body.classList.toggle('editing', editing);
    mapView.map.invalidateSize();
  }
  if (next !== 'review') {
    mapView.clearHighlight();
  }
  mapView.showSelection(next === 'select');
  if (next === 'select') {
    updatePending();
  }
}

function showError(error: unknown): void {
  const box = $('error');
  if (error === undefined) {
    box.hidden = true;
    return;
  }
  box.textContent = error instanceof Error ? error.message : String(error);
  box.hidden = false;
}

async function refreshUser(): Promise<void> {
  if (!auth.authenticated()) {
    $('user').hidden = true;
    return;
  }
  $('user').hidden = false;
  $('user-name').textContent = (await userName().catch(() => undefined)) ?? '…';
}

function changeCount(count: number): string {
  return t('select.pendingCount', { count });
}

/**
 * Download options for the frame: shows which server is asked, and loads from
 * the OSM API if no Overpass server answers in the first round.
 */
function frameDownload(keyPatterns: string[], bbox: BBox, hint: HTMLElement): DownloadOptions {
  return {
    onAttempt: (url, round) => {
      hint.textContent = t('select.loadingFrom', { host: new URL(url).host }) + (round > 1 ? t('select.retry') : '');
    },
    fallback: {
      host: new URL(API_URL).host,
      run: (signal) => downloadMap(bbox, keyPatterns, signal),
      onStart: () => {
        hint.textContent = t('select.loadingFallback');
      },
    },
  };
}

// ---------------------------------------------------------------- step 1: select

function savedCheckIds(): string[] {
  try {
    const ids = JSON.parse(localStorage.getItem(CHECK_STORAGE_KEY) ?? '["phone"]') as unknown;
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : ['phone'];
  } catch {
    return ['phone'];
  }
}

function checkbox(id: string, label: string, checked: boolean): HTMLLabelElement {
  const element = document.createElement('label');
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.value = id;
  box.checked = checked;
  element.append(box, label);
  return element;
}

/** „Soziale Netze“: one checkbox for the whole group, the networks below it can be chosen one by one. */
function socialGroup(selected: Set<string>): HTMLElement {
  const networks = CHECKS.filter((check) => check.group === 'social');
  const group = document.createElement('div');
  group.className = 'group';
  const toggle = checkbox('', t('select.social'), false);
  toggle.querySelector('input')?.classList.add('group-toggle');
  const count = Object.assign(document.createElement('span'), { id: 'social-count', className: 'hint' });
  const expand = Object.assign(document.createElement('button'), { type: 'button', id: 'social-expand', className: 'link' });
  const head = document.createElement('div');
  head.className = 'group-head';
  head.append(toggle, count, expand);
  const items = Object.assign(document.createElement('div'), { id: 'social-items', className: 'group-items' });
  items.append(...networks.map((check) => checkbox(check.id, check.label, selected.has(check.id))));
  const chosen = networks.filter((check) => selected.has(check.id)).length;
  // collapsed unless only some networks are chosen
  items.hidden = chosen === 0 || chosen === networks.length;
  expand.addEventListener('click', () => {
    items.hidden = !items.hidden;
    updateSocialGroup();
  });
  group.append(head, items);
  return group;
}

function updateSocialGroup(): void {
  const boxes = [...document.querySelectorAll<HTMLInputElement>('#social-items input')];
  const chosen = boxes.filter((box) => box.checked).length;
  const toggle = document.querySelector<HTMLInputElement>('#checks .group-toggle');
  if (toggle !== null) {
    toggle.checked = chosen === boxes.length;
    toggle.indeterminate = chosen > 0 && chosen < boxes.length;
  }
  $('social-count').textContent = t('select.socialCount', { chosen, total: boxes.length });
  $('social-expand').textContent = $('social-items').hidden ? t('select.socialExpand') : t('select.socialCollapse');
}

function renderChecks(): void {
  const selected = new Set(savedCheckIds());
  $('checks').replaceChildren(
    ...CHECKS.filter((check) => check.group === undefined).map((check) => checkbox(check.id, check.label, selected.has(check.id))),
    socialGroup(selected),
    checkbox(DUPLICATES.id, DUPLICATES.label, selected.has(DUPLICATES.id)),
  );
  updateSocialGroup();
  const hint = (text: string) => Object.assign(document.createElement('p'), { className: 'hint', textContent: text });
  $('online-checks').append(
    checkbox(WIKIDATA_ONLINE.id, WIKIDATA_ONLINE.label, selected.has(WIKIDATA_ONLINE.id)),
    hint(t('select.wikidataHint')),
    checkbox(WEBSITE_ONLINE.id, WEBSITE_ONLINE.label, selected.has(WEBSITE_ONLINE.id)),
    hint(t('select.websiteHint')),
    checkbox(CONFIRM_ONLINE.id, CONFIRM_ONLINE.label, selected.has(CONFIRM_ONLINE.id)),
    hint(t('select.confirmHint', { months: CHECK_INTERVAL_MONTHS })),
    checkbox(ASSIST_ONLINE.id, ASSIST_ONLINE.label, selected.has(ASSIST_ONLINE.id)),
    hint(t('select.assistHint')),
  );
  setupAssistSettings();
  for (const id of ['checks', 'online-checks']) {
    $(id).addEventListener('change', (event) => {
      const target = event.target;
      if (target instanceof HTMLInputElement && target.classList.contains('group-toggle')) {
        for (const box of document.querySelectorAll<HTMLInputElement>('#social-items input')) {
          box.checked = target.checked;
        }
      }
      updateSocialGroup();
      updateAssistSettings();
      try {
        localStorage.setItem(CHECK_STORAGE_KEY, JSON.stringify(selectedIds()));
      } catch {
        // ignore
      }
      updateDownloadButton();
    });
  }
}

/** Key and model for the AI assistance, shown while „Mit KI abgleichen“ is chosen. */
function setupAssistSettings(): void {
  const key = $<HTMLInputElement>('ai-key');
  const remember = $<HTMLInputElement>('ai-remember');
  const model = $<HTMLSelectElement>('ai-model');
  model.replaceChildren(...MODELS.map(({ id, label }) => new Option(label, id, false, id === selectedModel())));
  key.value = apiKey();
  remember.checked = keyRemembered();
  const save = () => saveApiKey(key.value.trim(), remember.checked);
  key.addEventListener('change', save);
  remember.addEventListener('change', save);
  model.addEventListener('change', () => {
    saveModel(model.value);
    updateAssistSettings();
  });
  updateAssistSettings();
}

function updateAssistSettings(): void {
  $('assist-settings').hidden = !onlineSelected(ASSIST_ONLINE.id);
  const cost = costRange(selectedModel());
  $('ai-cost').textContent = cost === '' ? '' : t('ai.cost', { cost });
}

function selectedIds(): string[] {
  return [
    ...document.querySelectorAll<HTMLInputElement>('#checks input:checked:not(.group-toggle), #online-checks input:checked'),
  ].map(
    (box) => box.value,
  );
}

function selectedChecks(): Check[] {
  const ids = new Set(selectedIds());
  return CHECKS.filter((check) => ids.has(check.id));
}

function onlineSelected(id: string): boolean {
  return selectedIds().includes(id);
}

function updateDownloadButton(): void {
  const button = $<HTMLButtonElement>('download');
  const hint = $('download-hint');
  const size = `${SELECTION_SIZE_M} m × ${SELECTION_SIZE_M} m`;
  // the job for Claude Code only needs the frame, not the chosen checks
  $<HTMLButtonElement>('export-claude').disabled = !mapView.canDownload();
  if (!mapView.canDownload()) {
    button.disabled = true;
    hint.textContent = t('select.zoomIn', { zoom: MIN_DOWNLOAD_ZOOM, size });
  } else if (selectedIds().length === 0) {
    button.disabled = true;
    hint.textContent = t('select.chooseCheck');
  } else {
    button.disabled = false;
    hint.textContent = t('select.frame', { size });
  }
}

function updatePending(): void {
  $('pending').hidden = changes.size === 0;
  $('pending-count').textContent = changeCount(changes.size);
}

async function startDownload(): Promise<void> {
  const checks = selectedChecks();
  const wikidataOnline = onlineSelected(WIKIDATA_ONLINE.id);
  const websiteOnline = onlineSelected(WEBSITE_ONLINE.id);
  const confirmOnline = onlineSelected(CONFIRM_ONLINE.id);
  const aiAssist = onlineSelected(ASSIST_ONLINE.id);
  const duplicates = onlineSelected(DUPLICATES.id);
  const button = $<HTMLButtonElement>('download');
  const hint = $('download-hint');
  showError(undefined);
  button.disabled = true;
  hint.textContent = t('select.loading');
  try {
    const keyPatterns = checks.map((c) => c.keyPattern);
    if (wikidataOnline) {
      keyPatterns.push(WIKIDATA_ONLINE.keyPattern);
    }
    if (websiteOnline) {
      keyPatterns.push(WEBSITE_ONLINE.keyPattern);
    }
    if (confirmOnline) {
      keyPatterns.push(CONFIRM_ONLINE.keyPattern);
    }
    if (duplicates) {
      keyPatterns.push(DUPLICATES.keyPattern);
    }
    if (aiAssist) {
      keyPatterns.push(ASSIST_ONLINE.keyPattern);
    }
    const synonyms = checks.some((check) => check.id === 'url');
    if (synonyms) {
      keyPatterns.push(SYNONYM_KEYS);
    }
    const center = mapView.center();
    const bbox = mapView.bbox();
    const [downloaded, country] = await Promise.all([
      download(buildQuery(keyPatterns, bbox), frameDownload(keyPatterns, bbox, hint)),
      countryAt(center.lat, center.lon).catch(() => undefined),
    ]);
    fallbackCountry = country;
    let found = findIssues(downloaded, checks, fallbackCountry);
    // tags that are removed or moved come first; there is nothing else to correct in them
    const replaced = [
      ...(synonyms ? synonymIssues(downloaded) : []),
      ...(duplicates
        ? duplicateIssues(downloaded, (element) => {
            const country = elementCountry(element, fallbackCountry);
            return country === undefined ? {} : { country };
          })
        : []),
    ];
    const isReplaced = (issue: Issue) => replaced.some((r) => r.element === issue.element && r.key === issue.key);
    found = [...replaced, ...found.filter((issue) => !isReplaced(issue))];

    if (wikidataOnline) {
      hint.textContent = t('select.checkingWikidata');
      const { ids, languages } = referencesToFetch(downloaded);
      const items = await fetchItems(ids, languages);
      found = found.concat(referenceIssues(downloaded, items, found));
    }
    if (websiteOnline) {
      const urls = websitesToProbe(downloaded);
      hint.textContent = t('select.checkingWebsites', { count: urls.length });
      const results = await probeAll(urls, browserProbe, (done, total) => {
        hint.textContent = t('select.checkingWebsitesProgress', { done, total });
      });
      found = found.concat(websiteIssues(downloaded, results, found));
    }
    if (confirmOnline) {
      found = found.concat(confirmIssues(downloaded, found));
    }
    if (aiAssist) {
      // first among the findings of an element, so its suggestions come before the rest
      found = [...assistIssues(downloaded), ...found];
    }

    hint.textContent = '';
    beginReview(downloaded, found, aiAssist);
  } catch (error) {
    showError(error);
    hint.textContent = '';
  } finally {
    updateDownloadButton();
  }
}

/** Starts the review of the findings; the findings of one element one after the other. */
function beginReview(elements: OsmElement[], found: Issue[], aiAssist: boolean, notice = ''): void {
  const order = new Map(elements.map((el, index) => [el, index]));
  issues = found
    .map((issue, index) => ({ issue, index }))
    .sort((a, b) => (order.get(a.issue.element) ?? 0) - (order.get(b.issue.element) ?? 0) || a.index - b.index)
    .map(({ issue }) => issue);
  current = 0;
  visited = new Set();
  assistRuns.clear();
  assistActive = aiAssist;
  mapView.showIssues(issues, goTo);
  showStep('review');
  $('no-issues').hidden = issues.length > 0;
  $('review-notice').hidden = notice === '';
  $('review-notice').textContent = notice;
  showIssue();
}

// ---------------------------------------------------------------- Claude Code (docs/ki-claude-code.md)

function saveFile(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Downloads the frame and saves the job files for Claude Code right away:
 * the elements with a website whose opening hours were not checked recently.
 */
async function exportForClaudeCode(): Promise<void> {
  const button = $<HTMLButtonElement>('export-claude');
  const hint = $('export-hint');
  showError(undefined);
  button.disabled = true;
  hint.hidden = false;
  hint.textContent = t('select.loading');
  try {
    const keyPatterns = [ASSIST_ONLINE.keyPattern];
    const bbox = mapView.bbox();
    const elements = await download(buildQuery(keyPatterns, bbox), frameDownload(keyPatterns, bbox, hint));
    const jobs = exportJobs(elements);
    if (jobs.length === 0) {
      hint.textContent = t('agent.nothing', { months: CHECK_INTERVAL_MONTHS });
      return;
    }
    // for the import, so it needs no download (for 24 hours)
    const inJobs = new Set(jobs.flatMap((job) => job.elements.map(elementKey)));
    rememberExported(elements.filter((element) => inJobs.has(elementKey(element))));
    const files = jobFiles(jobs, today());
    const base = JOB_FOLDERS[language()].file.replace(/\.md$/, '');
    const names = files.map((_, i) => (files.length === 1 ? `${base}.md` : `${base}-${i + 1}.md`));
    files.forEach((text, i) => saveFile(names[i]!, text));
    hint.textContent = `${t('agent.saved', { count: jobs.length, files: formatList(names) })} ${t('agent.savedHint', { file: names[0]! })}`;
  } catch (error) {
    showError(error);
    hint.hidden = true;
  } finally {
    updateDownloadButton();
  }
}

/** The folder read, until the user has confirmed the maker of the AI model. */
let pendingImport: ImportedFolder | undefined;
const OTHER_VENDOR = '';

/** Reads the folder and asks which AI made the answers (the answers state it, but cannot prove it). */
async function readImportFolder(files: File[]): Promise<void> {
  const hint = $('download-hint');
  showError(undefined);
  $('import-confirm').hidden = true;
  try {
    hint.textContent = t('agent.reading');
    const folder = await readFolder(files);
    if (folder.answers.length === 0) {
      throw new Error(
        folder.errors.length > 0 ? t('agent.noReadable', { errors: folder.errors.join('; ') }) : t('agent.noAnswers'),
      );
    }
    hint.textContent = '';
    pendingImport = folder;
    const { vendors, models, descriptions, missing } = statedAi(folder);
    const count = t('agent.answers', { count: folder.answers.length });
    $('import-stated').textContent =
      `${t('agent.read', { answers: count })} ` +
      (descriptions.length === 0
        ? t('agent.notStated')
        : t('agent.stated', { ai: descriptions.join('; ') }) +
          (missing > 0 ? t('agent.statedMissing', { count: missing }) : '') +
          (vendors.length > 1 ? t('agent.statedDiffer') : '.')) +
      ` ${t('agent.confirm')}`;
    const select = $<HTMLSelectElement>('import-vendor');
    const stated = vendors.length === 1 ? vendors[0]! : undefined;
    const known = AI_VENDORS.find((v) => v.toLowerCase() === stated?.toLowerCase());
    select.replaceChildren(
      new Option(t('agent.choose'), '__none__', false, stated === undefined),
      ...AI_VENDORS.map((v) => new Option(v, v, false, v === known)),
      new Option(t('agent.other'), OTHER_VENDOR, false, stated !== undefined && known === undefined),
    );
    const other = $<HTMLInputElement>('import-vendor-other');
    other.value = stated !== undefined && known === undefined ? stated : '';
    other.hidden = select.value !== OTHER_VENDOR;
    // the model only if all answers name the same one
    $<HTMLInputElement>('import-model').value = models.length === 1 ? models[0]! : '';
    $('import-confirm').hidden = false;
    select.focus();
  } catch (error) {
    showError(error);
    hint.textContent = '';
  } finally {
    $<HTMLInputElement>('import-folder').value = '';
  }
}

function confirmedVendor(): string {
  const select = $<HTMLSelectElement>('import-vendor');
  return select.value === OTHER_VENDOR ? $<HTMLInputElement>('import-vendor-other').value.trim() : select.value;
}

async function importFromClaudeCode(folder: ImportedFolder, vendor: string, model: string): Promise<void> {
  const label = aiLabel(vendor, model);
  const hint = $('download-hint');
  showError(undefined);
  try {
    const refs = folder.answers.flatMap((answer) => answer.elements);
    // kept from the export; others (older than 24 hours, another browser) from the OSM API
    const { found: kept, missing: toFetch } = exportedElements(refs);
    hint.textContent = t('agent.loadingElements');
    const elements = [...kept, ...(toFetch.length > 0 ? await fetchElements(toFetch) : [])];
    const centers = elements.flatMap((element) => elementCenter(element) ?? []);
    const first = centers[0];
    fallbackCountry = first === undefined ? undefined : await countryAt(first.lat, first.lon).catch(() => undefined);
    hint.textContent = t('agent.checking');
    const found = await importFindings(
      folder,
      elements,
      (element) => elementCountry(element, fallbackCountry),
      today(),
      vendor,
      label,
    );
    // the other chosen checks run for these elements as well
    const checks = selectedChecks();
    const other = checks.length > 0 ? findIssues(elements, checks, fallbackCountry) : [];

    const missing = refs.filter((ref) => !elements.some((e) => e.type === ref.type && e.id === ref.id));
    const notice = [
      t('agent.imported', {
        answers: t('agent.answers', { count: folder.answers.length }),
        ai: label,
        findings: t('agent.findings', { count: found.length }),
      }),
      missing.length > 0 ? t('agent.gone', { elements: missing.map((r) => `${r.type}/${r.id}`).join(', ') }) : '',
      folder.errors.length > 0 ? t('agent.unreadable', { errors: folder.errors.join('; ') }) : '',
    ]
      .filter((line) => line !== '')
      .join(' ');
    hint.textContent = '';
    if (centers.length > 0) {
      const lats = centers.map((c) => c.lat);
      const lons = centers.map((c) => c.lon);
      mapView.fitBox(Math.min(...lats), Math.min(...lons), Math.max(...lats), Math.max(...lons));
    }
    beginReview(elements, [...found, ...other], false, notice);
  } catch (error) {
    showError(error);
    hint.textContent = '';
  } finally {
    updateDownloadButton();
  }
}

// ---------------------------------------------------------------- step 2: review

function contextFor(issue: Issue) {
  const country = elementCountry(issue.element, fallbackCountry);
  return country === undefined ? {} : { country };
}

function issueState(index: number): MarkerState {
  const issue = issues[index];
  if (index === current) {
    return 'current';
  }
  if (
    issue !== undefined &&
    (changes.get(issue.element, issue.key) !== undefined || changes.get(issue.element, checkDateKey(issue.key)) !== undefined)
  ) {
    return 'changed';
  }
  return visited.has(index) ? 'skipped' : 'open';
}

/** Colors the markers; an element with several issues shows the most relevant state. */
function refreshMarkers(): void {
  const priority: MarkerState[] = ['current', 'open', 'changed', 'skipped'];
  const byElement = new Map<OsmElement, { first: number; state: MarkerState }>();
  issues.forEach((issue, index) => {
    const state = issueState(index);
    const entry = byElement.get(issue.element);
    if (entry === undefined) {
      byElement.set(issue.element, { first: index, state });
    } else if (priority.indexOf(state) < priority.indexOf(entry.state)) {
      entry.state = state;
    }
  });
  for (const { first, state } of byElement.values()) {
    mapView.setIssueState(first, state);
  }
}

function goTo(index: number): void {
  if (step !== 'review') {
    return;
  }
  current = Math.max(0, Math.min(index, issues.length));
  showIssue();
}

function showIssue(): void {
  const issue = issues[current];
  const done = issue === undefined;
  if (!done) {
    visited.add(current);
  }
  $('issue').hidden = done;
  $('review-done').hidden = !done || issues.length === 0;
  $('back').toggleAttribute('disabled', current === 0);
  $('progress').textContent =
    issues.length === 0 ? '' : t('review.progress', { current: Math.min(current + 1, issues.length), total: issues.length });
  updateChangeCount();
  refreshMarkers();
  if (done) {
    mapView.clearHighlight();
    return;
  }

  const link = $<HTMLAnchorElement>('issue-link');
  link.href = osmUrl(issue.element);
  link.textContent = elementLabel(issue.element);
  $('issue-key').textContent = issue.key;
  $('issue-value').textContent = issue.value === '' ? t('review.missing') : issue.value;
  $('issue-message').textContent = issue.message;
  showQuote(issue);
  showAssist(issue);
  hidePanels();
  showNoteLink(issue.element);

  const input = $<HTMLInputElement>('issue-input');
  const pending = changes.get(issue.element, issue.key);
  input.value =
    pending === undefined
      ? issue.kind === 'duplicate'
        ? ''
        : (issue.suggestion ?? issue.value)
      : (pending.newValue ?? pending.movedTo?.value ?? '');
  $<HTMLButtonElement>('remove-tag').disabled =
    pending !== undefined && pending.newValue === undefined && pending.movedTo === undefined;
  // a confirmation from an earlier visit counts as opened
  openedValue = changes.get(issue.element, checkDateKey(issue.key))?.verifies?.value;
  // the finding of the AI has no value to edit, only the analysis
  const noValue = issue.kind === 'assist';
  $('issue-form').classList.toggle('no-value', noValue);
  checkInput();
  if (noValue) {
    $('accept').focus();
  } else {
    input.focus();
    input.select();
  }
  mapView.show(issue.element);
}

/** „Übernehmen“ only if something changes, otherwise „Weiter“ (or „Löschen“ for a duplicate). */
function acceptLabel(issue: Issue, value: string): string {
  const trimmed = value.trim();
  if ((issue.kind === 'duplicate' || isRemoval(issue)) && trimmed === '') {
    return t('review.delete');
  }
  // moving to website:menu changes the key, not the value
  if (issue.kind === 'move') {
    return t('review.accept');
  }
  return trimmed === issue.value ? t('review.next') : t('review.accept');
}

function checkInput(): void {
  const issue = issues[current];
  if (issue === undefined) {
    return;
  }
  const value = $<HTMLInputElement>('issue-input').value;
  updateVerify(issue, value);
  $('accept').textContent = acceptLabel(issue, value);
  const hint = $('issue-check');
  if (value.trim() === '') {
    const pending = changes.get(issue.element, issue.key);
    const removed = pending !== undefined && pending.newValue === undefined;
    if (issue.kind === 'duplicate') {
      const params = { key: issue.key, kept: issue.duplicateOf ?? '' };
      hint.textContent = removed ? t('review.duplicateRemoved', params) : t('review.duplicateHint', params);
      hint.className = 'hint ok';
      return;
    }
    hint.textContent = removed || isRemoval(issue) ? t('review.tagRemoved') : t('review.empty');
    hint.className = removed || isRemoval(issue) ? 'hint' : 'hint bad';
    return;
  }
  const result = evaluate(issue.check, value, contextFor(issue));
  if (!result.valid) {
    hint.textContent = t('review.stillInvalid', { message: result.message });
    hint.className = 'hint bad';
  } else if (result.suggestion !== undefined && result.suggestion !== value) {
    hint.textContent = t('review.preferred', { suggestion: result.suggestion });
    hint.className = 'hint';
  } else {
    hint.textContent = value === issue.value ? t('review.validUnchanged') : t('review.valid');
    hint.className = 'hint ok';
  }
}

/** The value the user has opened in a new tab for the current issue. */
let openedValue: string | undefined;

/**
 * Shows the link to open the new value and enables "Geöffnet und geprüft"
 * only for verifiable keys, and only once exactly this value was opened.
 */
function updateVerify(issue: Issue, value: string): void {
  // nothing to open while a duplicate is to be removed
  const verifiable =
    isVerifiable(issue.key) &&
    !(issue.kind === 'duplicate' && value.trim() === '') &&
    // AI suggestions get a check_date anyway, the other AI findings are about the element
    issue.kind !== 'proposal' &&
    issue.kind !== 'signal' &&
    issue.kind !== 'assist';
  const target = verifiable ? openableUrl(issue.key, value.trim()) : undefined;
  // a signal of the AI: open the website to decide, without confirming it
  const shown = target ?? (issue.kind === 'signal' ? openableUrl(issue.key, issue.value) : undefined);
  const open = $<HTMLAnchorElement>('issue-open');
  $('issue-open-row').hidden = shown === undefined;
  if (shown !== undefined) {
    open.href = shown;
  }
  const verify = $<HTMLButtonElement>('verify');
  const hint = $('verify-hint');
  verify.hidden = !verifiable;
  hint.hidden = !verifiable;
  const ready = target !== undefined && openedValue === value.trim();
  verify.disabled = !ready;
  hint.textContent = ready
    ? t('review.verifySets', { key: checkDateKey(issue.key), date: today() })
    : target === undefined
      ? t('review.notOpenable')
      : t('review.openFirst');
}

/** An AI suggestion to remove the tag, e.g. phone whose only number moves to contact:mobile. */
function isRemoval(issue: Issue): boolean {
  return issue.kind === 'proposal' && issue.suggestion === '';
}

function accept(verified: boolean): void {
  const issue = issues[current];
  if (issue === undefined) {
    return;
  }
  const value = $<HTMLInputElement>('issue-input').value.trim();
  if (value === '' && isRemoval(issue) && issue.assist !== undefined) {
    const together = issue.assist.together;
    changes.set({
      type: issue.element.type,
      id: issue.element.id,
      label: elementLabel(issue.element),
      key: issue.key,
      oldValue: issue.value,
      ai: issue.assist.model,
      ...(together === undefined ? {} : { requires: together }),
    });
    goTo(current + 1);
    return;
  }
  if (value === '' && issue.kind === 'duplicate' && !verified) {
    removeTag(changes, issue.element, issue.key, issue.duplicateOf);
    goTo(current + 1);
    return;
  }
  if (value === '' || (verified && openedValue !== value)) {
    return;
  }
  const ref = { type: issue.element.type, id: issue.element.id, label: elementLabel(issue.element) };
  if (issue.kind === 'proposal' && issue.assist !== undefined) {
    // the tag, and where it is from: source:<key>=website, check_date:<key>=today (only if the tag is set)
    const ai = issue.assist.model;
    const together = issue.assist.together;
    changes.set({
      ...ref,
      key: issue.key,
      oldValue: issue.element.tags[issue.key],
      newValue: value,
      ai,
      ...(together === undefined ? {} : { requires: together }),
    });
    for (const [key, newValue] of [
      [`source:${issue.key}`, 'website'],
      [checkDateKey(issue.key), today()],
    ] as const) {
      changes.set({ ...ref, key, oldValue: issue.element.tags[key], newValue, verifies: { key: issue.key, value }, ai });
    }
    goTo(current + 1);
    return;
  }
  if (issue.kind === 'move' && issue.moveTo !== undefined) {
    // e.g. menu:url → website:menu: add the new key, remove the old one only if the new one is set
    changes.set({ ...ref, key: issue.moveTo, newValue: value, movedFrom: issue.key });
    changes.set({ ...ref, key: issue.key, oldValue: issue.value, movedTo: { key: issue.moveTo, value } });
    goTo(current + 1);
    return;
  }
  changes.set({ ...ref, key: issue.key, oldValue: issue.value, newValue: value });

  const dateKey = checkDateKey(issue.key);
  if (verified) {
    changes.set({
      ...ref,
      key: dateKey,
      oldValue: issue.element.tags[dateKey],
      newValue: today(),
      verifies: { key: issue.key, value },
    });
  } else {
    // e.g. accepted without confirming on a second visit
    changes.delete(issue.element, dateKey);
  }
  updateDeletion(changes, issue.element);
  goTo(current + 1);
}

// ---------------------------------------------------------------- AI assistance

/** Results of the AI per element, so its finding shows them again. */
const assistRuns = new Map<string, { result: AssistResult; reused: boolean }>();
/** whether „Mit KI abgleichen“ was chosen for the current area */
let assistActive = false;
let assistAbort: AbortController | undefined;

function showQuote(issue: Issue): void {
  $('issue-quote').hidden = issue.assist === undefined;
  if (issue.assist !== undefined) {
    $('issue-quote-text').textContent = language() === 'de' ? `„${issue.assist.quote}“` : `“${issue.assist.quote}”`;
    const link = $<HTMLAnchorElement>('issue-quote-link');
    link.href = issue.assist.sourceUrl;
    link.textContent = t('assist.quoteSource', { url: issue.assist.sourceUrl, model: issue.assist.model });
  }
}

/**
 * With „Mit KI abgleichen“, every finding of an element with a website offers
 * the analysis, not only its own finding (except the findings of the AI).
 */
function canAssist(issue: Issue): boolean {
  return (
    issue.kind === 'assist' ||
    (assistActive && issue.kind !== 'proposal' && issue.kind !== 'signal' && siteOf(issue.element) !== undefined)
  );
}

function showAssist(issue: Issue): void {
  $('assist').hidden = !canAssist(issue);
  if (!canAssist(issue) || assistAbort !== undefined) {
    return;
  }
  const run = $<HTMLButtonElement>('assist-run');
  const done = assistRuns.get(elementKey(issue.element));
  run.textContent = done === undefined ? t('assist.run') : t('assist.rerun');
  $('assist-cancel').hidden = true;
  if (done !== undefined) {
    run.disabled = apiKey() === '';
    showAssistResult(done.result, done.reused);
    return;
  }
  $('assist-details').replaceChildren();
  // a website read before costs nothing, also without a key
  const cached = alreadyRead(issue.element);
  run.disabled = apiKey() === '' && !cached;
  $('assist-status').textContent = cached
    ? t('assist.cached')
    : apiKey() === ''
      ? t('assist.needKey')
      : t('assist.costs', { cost: costRange(selectedModel()), model: MODELS.find((m) => m.id === selectedModel())?.label ?? '' });
}

function showAssistResult(result: AssistResult, reused: boolean): void {
  const { proposals, signals, rejected, pages, usage, model } = result;
  $('assist-status').textContent =
    `${t('assist.proposals', { count: proposals.length })}, ${t('assist.signals', { count: signals.length })}` +
    (proposals.length + signals.length > 0 ? t('assist.follow') : '. ') +
    (reused
      ? t('assist.reused', { model: model.name })
      : t('assist.usage', { model: model.name, tokens: usage.inputTokens + usage.outputTokens }) +
        (usage.costUsd === undefined ? '.' : t('assist.usageCost', { cost: dollars(usage.costUsd) })));
  const item = (text: string) => Object.assign(document.createElement('li'), { textContent: text });
  const unchanged = rejected.filter((r) => r.reason === 'unchanged').length;
  $('assist-details').replaceChildren(
    ...pages.map((page) => item(`${page.url}: ${page.error === undefined ? t('assist.pageRead') : fetchError(page.error)}`)),
    ...rejected
      .filter((r) => r.reason !== 'unchanged')
      .map((r) => item(t('assist.rejected', { key: r.proposal.key, value: r.proposal.value, reason: rejectedText(r.reason) }))),
    ...(unchanged > 0 ? [item(t('assist.unchanged', { count: unchanged }))] : []),
  );
}

/**
 * Puts the findings of the AI right after `anchor` (the finding the analysis
 * was started from), replacing those of an earlier run of the element.
 */
function insertAssistIssues(anchor: Issue, found: Issue[]): void {
  const earlier = (issue: Issue) => issue.element === anchor.element && (issue.kind === 'proposal' || issue.kind === 'signal');
  const entries = issues.map((issue, i) => ({ issue, seen: visited.has(i) })).filter(({ issue }) => !earlier(issue));
  const at = entries.findIndex(({ issue }) => issue === anchor);
  entries.splice(at + 1, 0, ...found.map((issue) => ({ issue, seen: false })));
  const shown = issues[current];
  issues = entries.map(({ issue }) => issue);
  visited = new Set(entries.flatMap(({ seen }, i) => (seen ? [i] : [])));
  // the finding on screen keeps its place, even if earlier findings were removed
  const now = shown === undefined ? -1 : issues.indexOf(shown);
  current = now === -1 ? Math.min(current, issues.length) : now;
  mapView.showIssues(issues, goTo);
}

async function runAssist(): Promise<void> {
  const issue = issues[current];
  if (issue === undefined || !canAssist(issue) || assistAbort !== undefined) {
    return;
  }
  const controller = new AbortController();
  assistAbort = controller;
  $<HTMLButtonElement>('assist-run').disabled = true;
  $('assist-cancel').hidden = false;
  $('assist-details').replaceChildren();
  $('assist-status').textContent = t('assist.running');
  try {
    // „Erneut auswerten“ reads the website again
    const fresh = assistRuns.has(elementKey(issue.element));
    const { result, issues: found, reused } = await analyze(issue.element, elementCountry(issue.element, fallbackCountry), {
      signal: controller.signal,
      today: today(),
      fresh,
    });
    assistRuns.set(elementKey(issue.element), { result, reused });
    insertAssistIssues(issue, found);
  } catch (error) {
    $('assist-status').textContent = errorText(error);
  } finally {
    assistAbort = undefined;
    $('assist-cancel').hidden = true;
    $<HTMLButtonElement>('assist-run').disabled = apiKey() === '' && !alreadyRead(issue.element);
  }
  if (issues[current] === issue && assistRuns.has(elementKey(issue.element))) {
    showIssue();
  }
}

// ---------------------------------------------------------------- no longer existing

let closureActions: Record<string, TagAction> = {};

/** Closes the closure and note forms and shows the issue form again. */
function hidePanels(): void {
  $('closure').hidden = true;
  $('note').hidden = true;
  $('issue-form').hidden = false;
}

function panelOpen(): boolean {
  return !$('closure').hidden || !$('note').hidden;
}

function openClosure(): void {
  const issue = issues[current];
  if (issue === undefined) {
    return;
  }
  const pending = changes.forElement(issue.element);
  const earlier = currentActions(issue.element, pending);
  closureActions = isClosed(pending)
    ? earlier
    : {
        ...defaultActions(issue.element),
        ...Object.fromEntries(Object.entries(earlier).filter(([, action]) => action !== 'keep')),
      };

  $('closure-tags').replaceChildren(
    ...Object.entries(issue.element.tags).map(([key, value]) => {
      const row = document.createElement('tr');
      const select = document.createElement('select');
      select.setAttribute('aria-label', `${key}=${value}`);
      for (const { action, label } of TAG_ACTIONS) {
        select.append(Object.assign(document.createElement('option'), { value: action, textContent: label }));
      }
      select.value = closureActions[key] ?? 'keep';
      select.addEventListener('change', () => {
        closureActions[key] = select.value as TagAction;
        updateClosure();
      });
      const cell = (...content: (Node | string)[]) => {
        const td = document.createElement('td');
        td.append(...content);
        return td;
      };
      row.dataset.key = key;
      row.append(cell(code(key, ''), '=', code(value, '')), cell(select));
      return row;
    }),
  );
  $('issue-form').hidden = true;
  $('closure').hidden = false;
  updateClosure();
  $('closure-tags').querySelector('select')?.focus();
}

function updateClosure(): void {
  const issue = issues[current];
  if (issue === undefined) {
    return;
  }
  for (const row of $('closure-tags').querySelectorAll<HTMLTableRowElement>('tr')) {
    row.classList.toggle('removed', (closureActions[row.dataset.key ?? ''] ?? 'keep') !== 'keep');
  }
  const remaining = Object.entries(previewClosure(issue.element, closureActions, changes.forElement(issue.element)));
  const apply = $<HTMLButtonElement>('closure-apply');
  const result = $('closure-result');
  apply.disabled = remaining.length === 0 && issue.element.type !== 'node';
  if (remaining.length > 0) {
    result.textContent = t('closure.after', { tags: remaining.map(([k, v]) => `${k}=${v}`).join(', ') });
  } else if (issue.element.type === 'node') {
    result.textContent = t('closure.nodeDeleted');
  } else {
    result.textContent = t('closure.keepOne');
  }
}

/** The next issue of another element. */
function nextElement(): number {
  const element = issues[current]?.element;
  let next = current + 1;
  while (issues[next] !== undefined && issues[next]?.element === element) {
    next++;
  }
  return next;
}

function confirmClosure(): void {
  const issue = issues[current];
  if (issue === undefined || $<HTMLButtonElement>('closure-apply').disabled) {
    return;
  }
  applyClosure(changes, issue.element, closureActions);
  goTo(nextElement());
}

// ---------------------------------------------------------------- check on site

function showNoteLink(element: OsmElement): void {
  const id = noteFor(element);
  const line = $('issue-note');
  line.hidden = id === undefined;
  if (id !== undefined) {
    line.replaceChildren(
      t('note.created'),
      Object.assign(document.createElement('a'), {
        href: noteUrl(id),
        target: '_blank',
        rel: 'noopener',
        textContent: t('note.link', { id: String(id) }),
      }),
    );
  }
}

function openNote(): void {
  const issue = issues[current];
  if (issue === undefined) {
    return;
  }
  const loggedIn = auth.authenticated();
  $<HTMLTextAreaElement>('note-text').value = noteText(issue.element);
  $<HTMLButtonElement>('note-create').disabled = !loggedIn;
  $('note-status').textContent = loggedIn ? '' : t('note.loginNeeded');
  $('issue-form').hidden = true;
  $('note').hidden = false;
  $('note-text').focus();
}

async function submitNote(): Promise<void> {
  const issue = issues[current];
  const text = $<HTMLTextAreaElement>('note-text').value.trim();
  const button = $<HTMLButtonElement>('note-create');
  const status = $('note-status');
  if (issue === undefined || button.disabled) {
    return;
  }
  if (text === '') {
    status.textContent = t('note.empty');
    return;
  }
  button.disabled = true;
  status.textContent = t('note.creating');
  try {
    const id = await createNote(auth, issue.element, text);
    rememberNote(issue.element, id);
    if (issues[current] === issue) {
      hidePanels();
      showNoteLink(issue.element);
      $('issue-input').focus();
    }
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
    button.disabled = false;
  }
}

function updateChangeCount(): void {
  const button = $<HTMLButtonElement>('to-upload');
  button.disabled = changes.size === 0;
  button.textContent = t('review.toUpload', { count: changes.size });
}

function onReviewKey(event: KeyboardEvent): void {
  if (step !== 'review' || issues.length === 0 || event.altKey || event.metaKey) {
    return;
  }
  // after the last finding only Bild ↑ goes back
  if (issues[current] === undefined) {
    if (event.key === 'PageUp') {
      event.preventDefault();
      goTo(current - 1);
    }
    return;
  }
  // in the note text, Bild ↑/↓ and Strg+Enter belong to the text field
  if (event.target instanceof HTMLTextAreaElement && event.key !== 'Escape') {
    return;
  }
  if (event.ctrlKey) {
    if (event.key === 'Enter' && !$<HTMLButtonElement>('verify').disabled) {
      event.preventDefault();
      accept(true);
    }
    return;
  }
  if (event.key === 'PageDown') {
    event.preventDefault();
    goTo(current + 1);
  } else if (event.key === 'PageUp') {
    event.preventDefault();
    goTo(current - 1);
  } else if (event.key === 'Escape' && panelOpen()) {
    event.preventDefault();
    hidePanels();
    $('issue-input').focus();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    const input = $<HTMLInputElement>('issue-input');
    input.value = issues[current]?.value ?? '';
    checkInput();
    input.focus();
  }
}

// ---------------------------------------------------------------- step 3: upload

function code(text: string, className: string): HTMLElement {
  const element = document.createElement('code');
  element.className = className;
  element.textContent = text;
  return element;
}

function changeItem(change: TagChange, ...extra: Node[]): HTMLLIElement {
  const item = document.createElement('li');
  const link = document.createElement('a');
  link.href = osmUrl(change);
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = change.label ?? elementKey(change);
  item.append(link, document.createElement('br'), code(change.key, ''), ': ');
  if (change.newValue === undefined) {
    item.append(code(change.oldValue ?? '', 'old'), t('diff.delete'));
    if (change.duplicateOf !== undefined) {
      item.append(t('diff.inKey', { key: change.duplicateOf }));
    }
    if (change.movedTo !== undefined) {
      item.append(t('diff.movedTo', { key: change.movedTo.key }));
    }
  } else if (change.oldValue === undefined) {
    item.append(t('diff.new'), code(change.newValue, 'new'));
    if (change.movedFrom !== undefined) {
      item.append(t('diff.from', { key: change.movedFrom }));
    }
  } else {
    item.append(code(change.oldValue, 'old'), ' → ', code(change.newValue, 'new'));
  }
  if (change.requires !== undefined) {
    item.append(t('diff.requires', { key: change.requires.key }));
  }
  if (change.ai !== undefined && change.verifies === undefined) {
    item.append(t('diff.suggestedBy', { ai: change.ai }));
  }
  for (const node of extra) {
    item.append(document.createElement('br'), node);
  }
  return item;
}

/** Removes a change before the upload; a closure is only removed as a whole. */
function discardChange(change: TagChange): void {
  const partner =
    change.movedTo !== undefined
      ? changes.get(change, change.movedTo.key)
      : change.movedFrom !== undefined
        ? changes.get(change, change.movedFrom)
        : undefined;
  const group =
    change.closed === true
      ? changes.forElement(change).filter((c) => c.closed === true)
      : [change, ...(partner === undefined ? [] : [partner])];
  // changes that would fail on upload without these go as well: source:/check_date: of a value, and a
  // phone value without the mobile number (with its own source:/check_date:)
  for (let i = 0; i < group.length; i++) {
    const key = group[i]!.key;
    for (const c of changes.forElement(change)) {
      if ((c.requires?.key === key || c.verifies?.key === key) && !group.includes(c)) {
        group.push(c);
      }
    }
  }
  for (const c of group) {
    changes.delete(c, c.key);
  }
  // with a removal undone, a tag remains: the node is no longer deleted
  if (group.some((c) => c.newValue === undefined)) {
    for (const c of changes.forElement(change)) {
      if (c.deleteIfUnused === true) {
        const { deleteIfUnused: _, ...rest } = c;
        changes.set(rest);
      }
    }
  }
}

function renderDiff(): void {
  const list = changes.list();
  const deletionShown = new Set<string>();
  $('diff').replaceChildren(
    ...list.map((change) => {
      const extra: Node[] = [];
      if (change.deleteIfUnused === true && !deletionShown.has(elementKey(change))) {
        deletionShown.add(elementKey(change));
        extra.push(document.createTextNode(t('closure.nodeDeleted')));
      }
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'link';
      remove.textContent = change.closed === true ? t('diff.removeClosure') : t('diff.remove');
      remove.addEventListener('click', () => {
        discardChange(change);
        renderDiff();
      });
      extra.push(remove);
      return changeItem(change, ...extra);
    }),
  );
  // nothing (left) to upload, e.g. after the upload: only the result and the way on
  $('upload-form').hidden = list.length === 0;
  $('upload-done').hidden = list.length > 0;
  const reviewLeft = issues.length > 0 && current < issues.length;
  $('upload-continue').hidden = !reviewLeft;
  $('upload-restart').classList.toggle('primary', !reviewLeft);
  $<HTMLButtonElement>('upload').disabled = list.length === 0 || !auth.authenticated();
  $('upload-login-box').hidden = auth.authenticated() || list.length === 0;
  $<HTMLButtonElement>('upload-login').disabled = CLIENT_ID === '';
}

function toUpload(): void {
  $<HTMLTextAreaElement>('comment').value = changesetComment(changes.list());
  updateCommentCount();
  $('upload-status').textContent = '';
  $('conflicts').replaceChildren();
  showStep('upload');
  renderDiff();
}

function updateCommentCount(): void {
  const length = commentLength($<HTMLTextAreaElement>('comment').value.trim());
  const count = $('comment-count');
  count.textContent = t('upload.commentCount', { length, max: MAX_COMMENT });
  count.className = length > MAX_COMMENT ? 'hint bad' : 'hint';
}

async function startUpload(): Promise<void> {
  const comment = $<HTMLTextAreaElement>('comment').value.trim();
  const status = $('upload-status');
  const button = $<HTMLButtonElement>('upload');
  if (comment === '') {
    status.textContent = t('upload.commentMissing');
    return;
  }
  if (commentLength(comment) > MAX_COMMENT) {
    status.textContent = t('upload.commentTooLong', { max: MAX_COMMENT });
    return;
  }
  showError(undefined);
  button.disabled = true;
  try {
    const list = changes.list();
    status.textContent = t('upload.checkingVersions');
    const latest = await fetchCurrent(list);
    const { modified, conflicts } = applyChanges(list, latest);

    $('conflicts').replaceChildren(
      ...conflicts.map(({ change, reason }) => changeItem(change, document.createTextNode(reason))),
    );
    for (const { change } of conflicts) {
      changes.delete(change, change.key);
    }
    if (modified.length === 0) {
      status.textContent = t('upload.allConflicts');
      renderDiff();
      return;
    }

    if (modified.some((el) => el.type === 'node' && Object.keys(el.tags ?? {}).length === 0)) {
      status.textContent = t('upload.checkingNodes');
    }
    const { modify, remove } = await splitDeletions(modified);
    status.textContent = t('upload.uploading', { count: modified.length });
    // source and ai_assisted only if AI suggestions are actually uploaded
    const applied = list.filter((change) => !conflicts.some((conflict) => conflict.change === change));
    const models = aiModels(applied);
    const changesetTags = {
      created_by: GENERATOR,
      comment,
      ...(models.length > 0 ? { source: 'website', ai_assisted: models.join(';') } : {}),
    };
    const changesetId = await upload(auth, modify, changesetTags, GENERATOR, remove);
    changes.clear();
    renderDiff();
    status.replaceChildren(
      t('upload.done'),
      Object.assign(document.createElement('a'), {
        href: `https://www.openstreetmap.org/changeset/${changesetId}`,
        target: '_blank',
        rel: 'noopener',
        textContent: t('upload.changeset', { id: String(changesetId) }),
      }),
      remove.length > 0 ? t('upload.nodesDeleted', { count: remove.length }) : '',
      conflicts.length > 0 ? t('upload.conflictsSkipped', { count: conflicts.length }) : '',
    );
  } catch (error) {
    showError(error);
    status.textContent = '';
    renderDiff();
  }
}

// ---------------------------------------------------------------- wiring

$('login').addEventListener('click', login);
$('upload-login').addEventListener('click', login);
$('guest').addEventListener('click', () => showStep('select'));
$('logout').addEventListener('click', () => {
  logout();
  void refreshUser();
  showStep('login');
});

$('search-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const query = $<HTMLInputElement>('search').value.trim();
  if (query === '') {
    return;
  }
  search(query)
    .then((place) => {
      if (place === undefined) {
        showError(t('select.notFound'));
      } else {
        showError(undefined);
        mapView.fitBox(place.south, place.west, place.north, place.east);
      }
    })
    .catch(showError);
});

$('pending-upload').addEventListener('click', toUpload);
$('pending-discard').addEventListener('click', () => {
  if (window.confirm(t('select.discardConfirm', { count: changes.size }))) {
    changes.clear();
    updatePending();
  }
});

$('download').addEventListener('click', () => void startDownload());
$('import-claude').addEventListener('click', () => $('import-folder').click());
$('import-folder').addEventListener('change', () => {
  const input = $<HTMLInputElement>('import-folder');
  if (input.files !== null && input.files.length > 0) {
    void readImportFolder([...input.files]);
  }
});
$('import-vendor').addEventListener('change', () => {
  const other = $<HTMLInputElement>('import-vendor-other');
  other.hidden = $<HTMLSelectElement>('import-vendor').value !== OTHER_VENDOR;
  if (!other.hidden) {
    other.focus();
  }
});
$('import-confirm').addEventListener('submit', (event) => {
  event.preventDefault();
  const vendor = confirmedVendor();
  if (vendor === '' || vendor === '__none__' || pendingImport === undefined) {
    $('download-hint').textContent = t('agent.vendorMissing');
    return;
  }
  const folder = pendingImport;
  pendingImport = undefined;
  $('import-confirm').hidden = true;
  void importFromClaudeCode(folder, vendor, $<HTMLInputElement>('import-model').value);
});
$('import-confirm-cancel').addEventListener('click', () => {
  pendingImport = undefined;
  $('import-confirm').hidden = true;
});
$('export-claude').addEventListener('click', () => void exportForClaudeCode());
mapView.map.on('zoomend', updateDownloadButton);

$('issue-form').addEventListener('submit', (event) => {
  event.preventDefault();
  accept(false);
});
$('verify').addEventListener('click', () => accept(true));
for (const type of ['click', 'auxclick'] as const) {
  // left click or middle click: the user has opened the value
  $('issue-open').addEventListener(type, () => {
    openedValue = $<HTMLInputElement>('issue-input').value.trim();
    checkInput();
  });
}
$('issue-input').addEventListener('input', checkInput);
$('remove-tag').addEventListener('click', () => {
  const issue = issues[current];
  if (issue !== undefined) {
    removeTag(changes, issue.element, issue.key, issue.duplicateOf);
    goTo(current + 1);
  }
});
$('close-open').addEventListener('click', openClosure);
$('assist-run').addEventListener('click', () => void runAssist());
$('assist-cancel').addEventListener('click', () => assistAbort?.abort());
$('closure').addEventListener('submit', (event) => {
  event.preventDefault();
  confirmClosure();
});
$('note-open').addEventListener('click', openNote);
$('note').addEventListener('submit', (event) => {
  event.preventDefault();
  void submitNote();
});
for (const id of ['closure-cancel', 'note-cancel']) {
  $(id).addEventListener('click', () => {
    hidePanels();
    $('issue-input').focus();
  });
}
$('skip').addEventListener('click', () => goTo(current + 1));
$('back').addEventListener('click', () => goTo(current - 1));
document.addEventListener('keydown', onReviewKey);
$('to-upload').addEventListener('click', toUpload);
function restart(): void {
  issues = [];
  mapView.clearIssues();
  showStep('select');
}

function backToReview(): void {
  if (issues.length === 0) {
    showStep('select');
    return;
  }
  showStep('review');
  showIssue();
}

$('restart').addEventListener('click', restart);
$('upload').addEventListener('click', () => void startUpload());
$('comment').addEventListener('input', updateCommentCount);
$('upload-back').addEventListener('click', backToReview);
$('upload-continue').addEventListener('click', backToReview);
$('upload-restart').addEventListener('click', restart);

/** The language switch: reloads the page, the pending changes are kept in the browser. */
function setupLanguage(): void {
  const select = $<HTMLSelectElement>('language');
  select.replaceChildren(
    ...Object.entries(LANGUAGES).map(([code, name]) => new Option(name, code, false, code === language())),
  );
  select.addEventListener('change', () => {
    if (step === 'review' || step === 'upload') {
      if (!window.confirm(t('app.languageReload'))) {
        select.value = language();
        return;
      }
    }
    setLanguage(select.value as Lang);
    window.location.reload();
  });
}

/** Links to the help page of the current language, in a new tab so the work in progress stays open. */
function setupHelpLinks(): void {
  for (const link of document.querySelectorAll<HTMLAnchorElement>('a[data-help]')) {
    link.href = `./${t('app.helpPage')}${link.dataset.help ? `#${link.dataset.help}` : ''}`;
    link.target = '_blank';
    link.rel = 'noopener';
  }
}

async function init(): Promise<void> {
  translatePage();
  setupLanguage();
  setupHelpLinks();
  renderChecks();
  updateDownloadButton();
  $('config-warning').hidden = CLIENT_ID !== '';
  $<HTMLButtonElement>('login').disabled = CLIENT_ID === '';
  let loggedIn = false;
  try {
    loggedIn = await handleRedirect();
  } catch (error) {
    showError(error);
  }
  // after a login with pending changes (e.g. from the upload step), continue with the upload
  if (loggedIn && changes.size > 0) {
    toUpload();
  } else {
    showStep(auth.authenticated() ? 'select' : 'login');
  }
  await refreshUser();
}

void init();
