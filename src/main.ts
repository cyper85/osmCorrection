import type { CountryCode } from 'osmvalidation';
import { auth, CLIENT_ID, handleRedirect, login, logout, userName } from './auth.js';
import { ChangeStore, type TagChange } from './changes.js';
import { CHECKS, elementCountry, evaluate, findIssues, type Check, type Issue } from './checks.js';
import { MapView, MIN_DOWNLOAD_ZOOM, type MarkerState } from './map.js';
import { countryAt, search } from './nominatim.js';
import { elementKey, elementLabel, osmUrl, type OsmElement } from './osm.js';
import { applyChanges, fetchCurrent, upload } from './osmApi.js';
import { buildQuery, download } from './overpass.js';
import { fetchItems, referenceIssues, referencesToFetch, WIKIDATA_ONLINE } from './references.js';
import { browserProbe, probeAll, WEBSITE_ONLINE, websiteIssues, websitesToProbe } from './websites.js';
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
  if (next !== 'review') {
    mapView.clearHighlight();
  }
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
  return count === 1 ? '1 Änderung' : `${count} Änderungen`;
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

function renderChecks(): void {
  const selected = new Set(savedCheckIds());
  $('checks').replaceChildren(...CHECKS.map((check) => checkbox(check.id, check.label, selected.has(check.id))));
  const hint = (text: string) => Object.assign(document.createElement('p'), { className: 'hint', textContent: text });
  $('online-checks').append(
    checkbox(WIKIDATA_ONLINE.id, WIKIDATA_ONLINE.label, selected.has(WIKIDATA_ONLINE.id)),
    hint('Gibt es das Wikidata-Objekt noch, ist es eine Weiterleitung, und passt der wikipedia-Tag dazu?'),
    checkbox(WEBSITE_ONLINE.id, WEBSITE_ONLINE.label, selected.has(WEBSITE_ONLINE.id)),
    hint(
      'Antwortet der Server überhaupt, und gibt es http-Seiten auch per https? Fehlende Seiten (404) und ' +
        'Weiterleitungen erkennt der Browser nicht. Jede Website im Ausschnitt wird dafür von deinem Browser aufgerufen.',
    ),
  );
  for (const id of ['checks', 'online-checks']) {
    $(id).addEventListener('change', () => {
      try {
        localStorage.setItem(CHECK_STORAGE_KEY, JSON.stringify(selectedIds()));
      } catch {
        // ignore
      }
      updateDownloadButton();
    });
  }
}

function selectedIds(): string[] {
  return [...document.querySelectorAll<HTMLInputElement>('#checks input:checked, #online-checks input:checked')].map(
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
  if (!mapView.canDownload()) {
    button.disabled = true;
    hint.textContent = `Bitte weiter hineinzoomen (mindestens Zoomstufe ${MIN_DOWNLOAD_ZOOM}).`;
  } else if (selectedIds().length === 0) {
    button.disabled = true;
    hint.textContent = 'Bitte mindestens eine Prüfung auswählen.';
  } else {
    button.disabled = false;
    hint.textContent = '';
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
  const button = $<HTMLButtonElement>('download');
  const hint = $('download-hint');
  showError(undefined);
  button.disabled = true;
  hint.textContent = 'Lade Daten von Overpass …';
  try {
    const keyPatterns = checks.map((c) => c.keyPattern);
    if (wikidataOnline) {
      keyPatterns.push(WIKIDATA_ONLINE.keyPattern);
    }
    if (websiteOnline) {
      keyPatterns.push(WEBSITE_ONLINE.keyPattern);
    }
    const center = mapView.center();
    const [downloaded, country] = await Promise.all([
      download(buildQuery(keyPatterns, mapView.bbox())),
      countryAt(center.lat, center.lon).catch(() => undefined),
    ]);
    fallbackCountry = country;
    let found = findIssues(downloaded, checks, fallbackCountry);

    if (wikidataOnline) {
      hint.textContent = 'Prüfe Wikidata …';
      const { ids, languages } = referencesToFetch(downloaded);
      const items = await fetchItems(ids, languages);
      found = found.concat(referenceIssues(downloaded, items, found));
    }
    if (websiteOnline) {
      const urls = websitesToProbe(downloaded);
      hint.textContent = `Prüfe ${urls.length} Websites …`;
      const results = await probeAll(urls, browserProbe, (done, total) => {
        hint.textContent = `Prüfe Websites … ${done} von ${total}`;
      });
      found = found.concat(websiteIssues(downloaded, results, found));
    }

    // issues of one element one after the other, in download order
    const order = new Map(downloaded.map((el, index) => [el, index]));
    issues = found
      .map((issue, index) => ({ issue, index }))
      .sort((a, b) => (order.get(a.issue.element) ?? 0) - (order.get(b.issue.element) ?? 0) || a.index - b.index)
      .map(({ issue }) => issue);

    current = 0;
    visited = new Set();
    hint.textContent = '';
    mapView.showIssues(issues, goTo);
    showStep('review');
    $('no-issues').hidden = issues.length > 0;
    showIssue();
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
  if (issue !== undefined && changes.get(issue.element, issue.key) !== undefined) {
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
  $('progress').textContent = issues.length === 0 ? '' : `Fund ${Math.min(current + 1, issues.length)} von ${issues.length}`;
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
  $('issue-value').textContent = issue.value;
  $('issue-message').textContent = issue.message;
  const open = $<HTMLAnchorElement>('issue-open');
  open.hidden = !/^https?:\/\//i.test(issue.value);
  if (!open.hidden) {
    open.href = issue.value;
  }

  const input = $<HTMLInputElement>('issue-input');
  input.value = changes.get(issue.element, issue.key)?.newValue ?? issue.suggestion ?? issue.value;
  checkInput();
  input.focus();
  input.select();
  mapView.show(issue.element);
}

function checkInput(): void {
  const issue = issues[current];
  if (issue === undefined) {
    return;
  }
  const value = $<HTMLInputElement>('issue-input').value;
  const hint = $('issue-check');
  if (value.trim() === '') {
    hint.textContent = 'Der Wert darf nicht leer sein.';
    hint.className = 'hint bad';
    return;
  }
  const result = evaluate(issue.check, value, contextFor(issue));
  if (!result.valid) {
    hint.textContent = `Weiterhin ungültig: ${result.message}`;
    hint.className = 'hint bad';
  } else if (result.suggestion !== undefined && result.suggestion !== value) {
    hint.textContent = `Gültig, bevorzugt wäre: ${result.suggestion}`;
    hint.className = 'hint';
  } else {
    hint.textContent = value === issue.value ? 'Gültig (unverändert).' : 'Gültig.';
    hint.className = 'hint ok';
  }
}

function accept(): void {
  const issue = issues[current];
  if (issue === undefined) {
    return;
  }
  const value = $<HTMLInputElement>('issue-input').value;
  if (value.trim() === '') {
    return;
  }
  changes.set({
    type: issue.element.type,
    id: issue.element.id,
    key: issue.key,
    oldValue: issue.value,
    newValue: value,
    label: elementLabel(issue.element),
  });
  goTo(current + 1);
}

function updateChangeCount(): void {
  const button = $<HTMLButtonElement>('to-upload');
  button.disabled = changes.size === 0;
  button.textContent = `Weiter zum Hochladen (${changes.size})`;
}

function onReviewKey(event: KeyboardEvent): void {
  if (step !== 'review' || issues[current] === undefined || event.altKey || event.ctrlKey || event.metaKey) {
    return;
  }
  if (event.key === 'PageDown') {
    event.preventDefault();
    goTo(current + 1);
  } else if (event.key === 'PageUp') {
    event.preventDefault();
    goTo(current - 1);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    const input = $<HTMLInputElement>('issue-input');
    input.value = issues[current]?.value ?? '';
    checkInput();
    input.focus();
  }
}

// ---------------------------------------------------------------- step 3: upload

function defaultComment(list: TagChange[]): string {
  const keys = new Set(list.map((c) => c.key));
  const labels = CHECKS.filter((check) => [...keys].some((key) => new RegExp(check.keyPattern).test(key))).map(
    (check) => check.label,
  );
  return `Formatierung korrigiert: ${labels.join(', ')}`;
}

function code(text: string, className: string): HTMLElement {
  const element = document.createElement('code');
  element.className = className;
  element.textContent = text;
  return element;
}

function changeItem(change: TagChange, extra?: Node): HTMLLIElement {
  const item = document.createElement('li');
  const link = document.createElement('a');
  link.href = osmUrl(change);
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = change.label ?? elementKey(change);
  item.append(link, document.createElement('br'), code(change.key, ''), ': ', code(change.oldValue, 'old'), ' → ', code(change.newValue, 'new'));
  if (extra !== undefined) {
    item.append(document.createElement('br'), extra);
  }
  return item;
}

function renderDiff(): void {
  const list = changes.list();
  $('diff').replaceChildren(
    ...list.map((change) => {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'link';
      remove.textContent = 'entfernen';
      remove.addEventListener('click', () => {
        changes.delete(change, change.key);
        renderDiff();
      });
      return changeItem(change, remove);
    }),
  );
  $<HTMLButtonElement>('upload').disabled = list.length === 0 || !auth.authenticated();
  $('upload-login-box').hidden = auth.authenticated() || list.length === 0;
  $<HTMLButtonElement>('upload-login').disabled = CLIENT_ID === '';
}

function toUpload(): void {
  $<HTMLTextAreaElement>('comment').value = defaultComment(changes.list());
  $('upload-status').textContent = '';
  $('conflicts').replaceChildren();
  showStep('upload');
  renderDiff();
}

async function startUpload(): Promise<void> {
  const comment = $<HTMLTextAreaElement>('comment').value.trim();
  const status = $('upload-status');
  const button = $<HTMLButtonElement>('upload');
  if (comment === '') {
    status.textContent = 'Bitte einen Changeset-Kommentar eingeben.';
    return;
  }
  showError(undefined);
  button.disabled = true;
  try {
    const list = changes.list();
    status.textContent = 'Prüfe aktuelle Versionen …';
    const latest = await fetchCurrent(list);
    const { modified, conflicts } = applyChanges(list, latest);

    $('conflicts').replaceChildren(
      ...conflicts.map(({ change, reason }) => changeItem(change, document.createTextNode(reason))),
    );
    for (const { change } of conflicts) {
      changes.delete(change, change.key);
    }
    if (modified.length === 0) {
      status.textContent = 'Nichts hochzuladen, alle Änderungen stehen im Konflikt.';
      renderDiff();
      return;
    }

    status.textContent = `Lade ${modified.length} Elemente hoch …`;
    const changesetId = await upload(auth, modified, { created_by: GENERATOR, comment }, GENERATOR);
    changes.clear();
    renderDiff();
    status.replaceChildren(
      'Hochgeladen: ',
      Object.assign(document.createElement('a'), {
        href: `https://www.openstreetmap.org/changeset/${changesetId}`,
        target: '_blank',
        rel: 'noopener',
        textContent: `Changeset ${changesetId}`,
      }),
      conflicts.length > 0 ? ` (${conflicts.length} Konflikte übersprungen)` : '',
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
        showError('Ort nicht gefunden.');
      } else {
        showError(undefined);
        mapView.fitBox(place.south, place.west, place.north, place.east);
      }
    })
    .catch(showError);
});

$('pending-upload').addEventListener('click', toUpload);
$('pending-discard').addEventListener('click', () => {
  if (window.confirm(`${changeCount(changes.size)} verwerfen?`)) {
    changes.clear();
    updatePending();
  }
});

$('download').addEventListener('click', () => void startDownload());
mapView.map.on('zoomend', updateDownloadButton);

$('issue-form').addEventListener('submit', (event) => {
  event.preventDefault();
  accept();
});
$('issue-input').addEventListener('input', checkInput);
$('skip').addEventListener('click', () => goTo(current + 1));
$('back').addEventListener('click', () => goTo(current - 1));
document.addEventListener('keydown', onReviewKey);
$('to-upload').addEventListener('click', toUpload);
$('restart').addEventListener('click', () => {
  issues = [];
  mapView.clearIssues();
  showStep('select');
});

$('upload').addEventListener('click', () => void startUpload());
$('upload-back').addEventListener('click', () => {
  if (issues.length === 0) {
    showStep('select');
    return;
  }
  showStep('review');
  showIssue();
});

async function init(): Promise<void> {
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
