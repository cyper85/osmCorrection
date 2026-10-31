import type { CountryCode } from 'osmvalidation';
import { auth, CLIENT_ID, handleRedirect, login, logout, userName } from './auth.js';
import { ChangeStore, type TagChange } from './changes.js';
import { CHECKS, elementCountry, evaluate, findIssues, type Check, type Issue } from './checks.js';
import { MapView, MIN_DOWNLOAD_ZOOM } from './map.js';
import { countryAt, search } from './nominatim.js';
import { elementKey, elementLabel, osmUrl, type OsmElement } from './osm.js';
import { applyChanges, fetchCurrent, upload } from './osmApi.js';
import { buildQuery, download } from './overpass.js';
import './style.css';

const GENERATOR = `osmCorrection ${__APP_VERSION__}`;
const CHECK_STORAGE_KEY = 'osmCorrection.checks';

type Step = 'login' | 'select' | 'review' | 'upload';

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`#${id} missing`);
  }
  return element as T;
}

const mapView = new MapView($('map'));
const changes = new ChangeStore();
let issues: Issue[] = [];
let current = 0;
let elements = new Map<string, OsmElement>();
let fallbackCountry: CountryCode | undefined;

// ---------------------------------------------------------------- general

function showStep(step: Step): void {
  for (const name of ['login', 'select', 'review', 'upload'] as const) {
    $(`step-${name}`).hidden = name !== step;
  }
  if (step !== 'review') {
    mapView.clearHighlight();
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

// ---------------------------------------------------------------- step 1: select

function savedCheckIds(): string[] {
  try {
    const ids = JSON.parse(localStorage.getItem(CHECK_STORAGE_KEY) ?? '["phone"]') as unknown;
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : ['phone'];
  } catch {
    return ['phone'];
  }
}

function renderChecks(): void {
  const selected = new Set(savedCheckIds());
  const fieldset = $('checks');
  fieldset.replaceChildren(
    ...CHECKS.map((check) => {
      const label = document.createElement('label');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.value = check.id;
      box.checked = selected.has(check.id);
      label.append(box, check.label);
      return label;
    }),
  );
  fieldset.addEventListener('change', () => {
    try {
      localStorage.setItem(CHECK_STORAGE_KEY, JSON.stringify(selectedChecks().map((c) => c.id)));
    } catch {
      // ignore
    }
    updateDownloadButton();
  });
}

function selectedChecks(): Check[] {
  const ids = new Set(
    [...$('checks').querySelectorAll<HTMLInputElement>('input:checked')].map((box) => box.value),
  );
  return CHECKS.filter((check) => ids.has(check.id));
}

function updateDownloadButton(): void {
  const button = $<HTMLButtonElement>('download');
  const hint = $('download-hint');
  if (!mapView.canDownload()) {
    button.disabled = true;
    hint.textContent = `Bitte weiter hineinzoomen (mindestens Zoomstufe ${MIN_DOWNLOAD_ZOOM}).`;
  } else if (selectedChecks().length === 0) {
    button.disabled = true;
    hint.textContent = 'Bitte mindestens eine Prüfung auswählen.';
  } else {
    button.disabled = false;
    hint.textContent = '';
  }
}

async function startDownload(): Promise<void> {
  const checks = selectedChecks();
  const button = $<HTMLButtonElement>('download');
  const hint = $('download-hint');
  showError(undefined);
  button.disabled = true;
  hint.textContent = 'Lade Daten von Overpass …';
  try {
    const center = mapView.center();
    const [downloaded, country] = await Promise.all([
      download(buildQuery(checks.map((c) => c.keyPattern), mapView.bbox())),
      countryAt(center.lat, center.lon).catch(() => undefined),
    ]);
    fallbackCountry = country;
    elements = new Map(downloaded.map((el) => [elementKey(el), el]));
    issues = findIssues(downloaded, checks, fallbackCountry);
    changes.clear();
    current = 0;
    hint.textContent = '';
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

function showIssue(): void {
  const issue = issues[current];
  const done = issue === undefined;
  $('issue').hidden = done;
  $('review-done').hidden = !done || issues.length === 0;
  $('back').toggleAttribute('disabled', current === 0);
  $('progress').textContent = issues.length === 0 ? '' : `Fund ${Math.min(current + 1, issues.length)} von ${issues.length}`;
  updateChangeCount();
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
    hint.textContent = 'Gültig.';
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
  });
  next();
}

function next(): void {
  current = Math.min(current + 1, issues.length);
  showIssue();
}

function updateChangeCount(): void {
  const button = $<HTMLButtonElement>('to-upload');
  button.disabled = changes.size === 0;
  button.textContent = `Weiter zum Hochladen (${changes.size})`;
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
  const element = elements.get(elementKey(change));
  const link = document.createElement('a');
  link.href = osmUrl(change);
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = element === undefined ? elementKey(change) : elementLabel(element);
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
  const uploadButton = $<HTMLButtonElement>('upload');
  uploadButton.disabled = list.length === 0 || !auth.authenticated();
  if (!auth.authenticated()) {
    $('upload-status').textContent = 'Zum Hochladen musst du angemeldet sein.';
  }
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

$('download').addEventListener('click', () => void startDownload());
mapView.map.on('zoomend', updateDownloadButton);

$('issue-form').addEventListener('submit', (event) => {
  event.preventDefault();
  accept();
});
$('issue-input').addEventListener('input', checkInput);
$('skip').addEventListener('click', next);
$('back').addEventListener('click', () => {
  current = Math.max(current - 1, 0);
  showIssue();
});
$('to-upload').addEventListener('click', toUpload);
$('restart').addEventListener('click', () => {
  if (changes.size > 0 && !window.confirm('Nicht hochgeladene Änderungen verwerfen?')) {
    return;
  }
  changes.clear();
  issues = [];
  showStep('select');
});

$('upload').addEventListener('click', () => void startUpload());
$('upload-back').addEventListener('click', () => {
  showStep('review');
  showIssue();
});

async function init(): Promise<void> {
  renderChecks();
  updateDownloadButton();
  $('config-warning').hidden = CLIENT_ID !== '';
  $<HTMLButtonElement>('login').disabled = CLIENT_ID === '';
  try {
    await handleRedirect();
  } catch (error) {
    showError(error);
  }
  showStep(auth.authenticated() ? 'select' : 'login');
  await refreshUser();
}

void init();
