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
import { MapView, MIN_DOWNLOAD_ZOOM, type MarkerState } from './map.js';
import { countryAt, search } from './nominatim.js';
import { elementKey, elementLabel, osmUrl, type OsmElement } from './osm.js';
import { applyChanges, fetchCurrent, splitDeletions, upload } from './osmApi.js';
import { createNote, noteFor, noteText, noteUrl, rememberNote } from './notes.js';
import { buildQuery, download } from './overpass.js';
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
    checkbox(CONFIRM_ONLINE.id, CONFIRM_ONLINE.label, selected.has(CONFIRM_ONLINE.id)),
    hint(
      `Zeigt auch gültige Websites, Facebook- und X-Profile, die seit ${CHECK_INTERVAL_MONTHS} Monaten nicht geprüft ` +
        'wurden. Du öffnest sie selbst und bestätigst sie, dann wird check_date:<Tag> gesetzt.',
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
  const confirmOnline = onlineSelected(CONFIRM_ONLINE.id);
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
    if (confirmOnline) {
      keyPatterns.push(CONFIRM_ONLINE.keyPattern);
    }
    const center = mapView.center();
    const [downloaded, country] = await Promise.all([
      download(buildQuery(keyPatterns, mapView.bbox()), {
        onAttempt: (url, round) => {
          hint.textContent = `Lade Daten von ${new URL(url).host} …${round > 1 ? ' (neuer Versuch)' : ''}`;
        },
      }),
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
    if (confirmOnline) {
      found = found.concat(confirmIssues(downloaded, found));
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
  hidePanels();
  showNoteLink(issue.element);

  const input = $<HTMLInputElement>('issue-input');
  const pending = changes.get(issue.element, issue.key);
  input.value = pending === undefined ? (issue.suggestion ?? issue.value) : (pending.newValue ?? '');
  $<HTMLButtonElement>('remove-tag').disabled = pending !== undefined && pending.newValue === undefined;
  // a confirmation from an earlier visit counts as opened
  openedValue = changes.get(issue.element, checkDateKey(issue.key))?.verifies?.value;
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
  updateVerify(issue, value);
  const hint = $('issue-check');
  if (value.trim() === '') {
    const pending = changes.get(issue.element, issue.key);
    const removed = pending !== undefined && pending.newValue === undefined;
    hint.textContent = removed
      ? 'Der Tag wird gelöscht. Einen Wert eingeben und übernehmen, um ihn doch zu behalten.'
      : 'Der Wert darf nicht leer sein. Zum Entfernen „Tag löschen“ verwenden.';
    hint.className = removed ? 'hint' : 'hint bad';
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

/** The value the user has opened in a new tab for the current issue. */
let openedValue: string | undefined;

/**
 * Shows the link to open the new value and enables "Geöffnet und geprüft"
 * only for verifiable keys, and only once exactly this value was opened.
 */
function updateVerify(issue: Issue, value: string): void {
  const verifiable = isVerifiable(issue.key);
  const target = verifiable ? openableUrl(issue.key, value.trim()) : undefined;
  const open = $<HTMLAnchorElement>('issue-open');
  $('issue-open-row').hidden = target === undefined;
  if (target !== undefined) {
    open.href = target;
  }
  const verify = $<HTMLButtonElement>('verify');
  const hint = $('verify-hint');
  verify.hidden = !verifiable;
  hint.hidden = !verifiable;
  const ready = target !== undefined && openedValue === value.trim();
  verify.disabled = !ready;
  hint.textContent = ready
    ? `Setzt ${checkDateKey(issue.key)}=${today()}.`
    : target === undefined
      ? 'Dieser Wert lässt sich nicht öffnen.'
      : 'Erst im neuen Tab öffnen und ansehen, dann bestätigen.';
}

function accept(verified: boolean): void {
  const issue = issues[current];
  if (issue === undefined) {
    return;
  }
  const value = $<HTMLInputElement>('issue-input').value.trim();
  if (value === '' || (verified && openedValue !== value)) {
    return;
  }
  const ref = { type: issue.element.type, id: issue.element.id, label: elementLabel(issue.element) };
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
    result.textContent = `Danach: ${remaining.map(([k, v]) => `${k}=${v}`).join(', ')}`;
  } else if (issue.element.type === 'node') {
    result.textContent = 'Keine Tags mehr übrig: Der Punkt wird gelöscht, wenn er zu keinem Weg und keiner Relation gehört.';
  } else {
    result.textContent = 'Mindestens ein Tag muss bleiben. Wege und Relationen lassen sich hier nicht löschen.';
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
      'Hinweis zum Prüfen vor Ort erstellt: ',
      Object.assign(document.createElement('a'), { href: noteUrl(id), target: '_blank', rel: 'noopener', textContent: `Hinweis ${id}` }),
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
  $('note-status').textContent = loggedIn ? '' : 'Zum Erstellen eines Hinweises musst du angemeldet sein.';
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
    status.textContent = 'Bitte einen Text eingeben.';
    return;
  }
  button.disabled = true;
  status.textContent = 'Erstelle Hinweis …';
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
  button.textContent = `Weiter zum Hochladen (${changes.size})`;
}

function onReviewKey(event: KeyboardEvent): void {
  if (step !== 'review' || issues[current] === undefined || event.altKey || event.metaKey) {
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

function defaultComment(list: TagChange[]): string {
  const labels = (keys: string[]) =>
    CHECKS.filter((check) => keys.some((key) => new RegExp(check.keyPattern).test(key))).map((check) => check.label);
  const own = list.filter((c) => c.verifies === undefined && c.closed === undefined);
  const corrected = labels(own.filter((c) => c.newValue !== undefined).map((c) => c.key));
  const removed = labels(own.filter((c) => c.newValue === undefined).map((c) => c.key));
  const verified = labels(list.flatMap((c) => (c.verifies === undefined ? [] : [c.verifies.key])));
  const closed = new Set(list.filter((c) => c.closed === true).map((c) => elementKey(c))).size;
  const parts: string[] = [];
  if (closed > 0) {
    parts.push(`existiert nicht mehr: ${closed === 1 ? '1 Objekt' : `${closed} Objekte`}`);
  }
  if (corrected.length > 0) {
    parts.push(`Formatierung korrigiert: ${corrected.join(', ')}`);
  }
  if (removed.length > 0) {
    parts.push(`entfernt: ${removed.join(', ')}`);
  }
  if (verified.length > 0) {
    parts.push(`online geprüft (check_date): ${verified.join(', ')}`);
  }
  return parts.join('; ');
}

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
    item.append(code(change.oldValue ?? '', 'old'), ' löschen');
  } else if (change.oldValue === undefined) {
    item.append('neu ', code(change.newValue, 'new'));
  } else {
    item.append(code(change.oldValue, 'old'), ' → ', code(change.newValue, 'new'));
  }
  for (const node of extra) {
    item.append(document.createElement('br'), node);
  }
  return item;
}

/** Removes a change before the upload; a closure is only removed as a whole. */
function discardChange(change: TagChange): void {
  const group = change.closed === true ? changes.forElement(change).filter((c) => c.closed === true) : [change];
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
        extra.push(document.createTextNode('Keine Tags mehr übrig: Der Punkt wird gelöscht, wenn er zu keinem Weg und keiner Relation gehört.'));
      }
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'link';
      remove.textContent = change.closed === true ? '„existiert nicht mehr“ entfernen' : 'entfernen';
      remove.addEventListener('click', () => {
        discardChange(change);
        renderDiff();
      });
      extra.push(remove);
      return changeItem(change, ...extra);
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

    if (modified.some((el) => el.type === 'node' && Object.keys(el.tags ?? {}).length === 0)) {
      status.textContent = 'Prüfe, ob leere Punkte noch zu Wegen oder Relationen gehören …';
    }
    const { modify, remove } = await splitDeletions(modified);
    status.textContent = `Lade ${modified.length} Elemente hoch …`;
    const changesetId = await upload(auth, modify, { created_by: GENERATOR, comment }, GENERATOR, remove);
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
      remove.length > 0 ? ` (${remove.length === 1 ? '1 Punkt' : `${remove.length} Punkte`} gelöscht)` : '',
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
    removeTag(changes, issue.element, issue.key);
    goTo(current + 1);
  }
});
$('close-open').addEventListener('click', openClosure);
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
