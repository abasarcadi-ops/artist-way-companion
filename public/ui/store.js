// The one place that holds the app's state, the date and the storage.
// Screens read `app`, change state with commit(next), and never touch
// localStorage themselves.

import { STORAGE_KEY, V1_STORAGE_KEY, dateKey, isDateKey, load, loadSaved, serialize, unreadGuard } from '../core.js';
import { COPY } from '../content.js';
import { debounce } from './dom.js';
import { toast } from './toast.js';

export const TIMER_KEY = 'awc.timer';
export const DRAFTS_KEY = 'awc.drafts';
export const APP_VERSION = '2.0.0';

export const app = {
  state: null,
  today: null,
  view: 'today', // today | book | kept
  chapterPage: null, // chapter number open inside Book, or null
  writingOpen: false,
  sheetOpen: false,
};

// ---------------------------------------------------------------------------
// Rendering hook: app.js registers the renderer, screens ask for a render.

let renderer = () => {};
export function setRenderer(fn) {
  renderer = fn;
}
export function render(options = {}) {
  renderer(options);
}

/**
 * Makes `next` the state: saves it and re-renders. Core returns the same
 * object when nothing changed, so that case does nothing at all.
 * Pass { render: false } while typing, so the screen isn't rebuilt per key.
 */
export function commit(next, options = {}) {
  if (!next || next === app.state) return false;
  app.state = next;
  persist();
  if (options.render !== false) renderer(options);
  return true;
}

// ---------------------------------------------------------------------------
// Storage. Every access is wrapped: private browsing and full disks throw.

export function readStorage(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(key, value) {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeStorage(key) {
  try {
    window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

// Set when awc.v2 holds data this version can't read and couldn't copy
// aside, or when another tab (a newer version) writes such data: from then
// on this page never writes awc.v2, so it can't destroy that data.
let blocked = false;
let warned = false;

function warnOnce() {
  if (warned) return;
  warned = true;
  toast(COPY.storageError, 6000);
}

export function persist() {
  if (blocked) {
    warnOnce();
    return false;
  }
  const ok = writeStorage(STORAGE_KEY, serialize(app.state));
  if (!ok) warnOnce();
  return ok;
}

/**
 * Reads whatever is stored and builds the working state. Never throws.
 * A stored awc.v2 this version can't read (a newer data version, or damage)
 * is copied to awc.v2.unread before anything is written over it. The old
 * app's key is only ever read.
 */
export function boot() {
  app.today = readToday();
  const v2Raw = readStorage(STORAGE_KEY);
  const result = load({
    v2Raw,
    v1Raw: readStorage(V1_STORAGE_KEY),
    today: app.today,
    nowIso: nowIso(),
  });
  app.state = result.state;

  const guard = unreadGuard(v2Raw, result.source, readStorage);
  if (guard.blocked || (guard.copyTo && !writeStorage(guard.copyTo, v2Raw))) {
    blocked = true;
    warnOnce();
    return result;
  }
  // Write v2 straight away after a migration or a first start, so the old
  // app's data is read exactly once.
  if (result.source !== 'v2') persist();
  return result;
}

/**
 * Keeps this tab in step with others: when another tab saves, its state
 * becomes this one's and the screen redraws (typed drafts live outside the
 * state, so they stay). A save this version can't read stops this tab from
 * writing at all.
 */
export function watchOtherTabs() {
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY || event.newValue === null) return;
    const next = loadSaved(event.newValue, nowIso());
    if (!next) {
      blocked = true;
      return;
    }
    app.state = next;
    renderer({});
  });
}

// ---------------------------------------------------------------------------
// Saves that wait for a pause in typing. Every one registers here, so
// flushPending() can push them all through at once: when the app goes to the
// background, the page is hidden, or before a reload.

const pendingSaves = new Set();

export function pendingSave(fn, ms) {
  const save = debounce(fn, ms);
  pendingSaves.add(save);
  return save;
}

export function flushPending() {
  for (const save of pendingSaves) save.flush();
}

// ---------------------------------------------------------------------------
// Drafts: text typed into a sheet that isn't part of the state until it's
// sent (the check-in answers). Kept in storage, so closing the sheet, a
// reload or iOS ending the app in the background never loses them.

function readDrafts() {
  try {
    const drafts = JSON.parse(readStorage(DRAFTS_KEY) ?? '{}');
    return drafts && typeof drafts === 'object' && !Array.isArray(drafts) ? drafts : {};
  } catch {
    return {};
  }
}

export function getDraft(name) {
  const text = readDrafts()[name];
  return typeof text === 'string' ? text : '';
}

/** Start over and restore throw the drafts away with everything else. */
export function clearDrafts() {
  removeStorage(DRAFTS_KEY);
}

export function setDraft(name, text) {
  const drafts = readDrafts();
  if (text) drafts[name] = String(text);
  else delete drafts[name];
  if (Object.keys(drafts).length) writeStorage(DRAFTS_KEY, JSON.stringify(drafts));
  else removeStorage(DRAFTS_KEY);
}

// ---------------------------------------------------------------------------
// The date. Device local; ?today=YYYY-MM-DD on localhost only, for tests.

export function readToday() {
  return todayOverride() ?? dateKey(new Date());
}

function todayOverride() {
  try {
    const { hostname, search } = window.location;
    if (hostname !== 'localhost' && hostname !== '127.0.0.1') return null;
    const value = new URLSearchParams(search).get('today');
    return isDateKey(value) ? value : null;
  } catch {
    return null;
  }
}

export function nowIso() {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Layers: whatever sits on top makes everything under it inert.

export function applyLayers() {
  const appEl = document.getElementById('app');
  const writing = document.getElementById('writing');
  if (appEl) appEl.inert = app.writingOpen || app.sheetOpen;
  if (writing) writing.inert = !app.writingOpen || app.sheetOpen;
  document.documentElement.classList.toggle('is-locked', app.writingOpen || app.sheetOpen);
}
