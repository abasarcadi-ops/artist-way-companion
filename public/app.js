// Artist's Way Companion v2 · UI entry.
//
// core.js holds every rule, content.js every word, accents.js the colours.
// This file boots the state, draws the screen that's showing, and routes
// taps and typing to the screen modules in ./ui/.

import { accentFor } from './accents.js';
import { COPY } from './content.js';
import { tapPage } from './core.js';
import * as artist from './ui/artist.js';
import * as book from './ui/book.js';
import { esc, patch } from './ui/dom.js';
import { renderKept } from './ui/kept.js';
import { closeSheet, onSheetClosed, refreshSheet, sheetName } from './ui/sheet.js';
import * as sheets from './ui/sheets.js';
import * as settings from './ui/settings.js';
import {
  app,
  applyLayers,
  boot,
  clearDrafts,
  commit,
  flushPending,
  readToday,
  render,
  setRenderer,
  watchOtherTabs,
} from './ui/store.js';
import * as today from './ui/today.js';
import { toast } from './ui/toast.js';
import * as writing from './ui/writing.js';

const VIEWS = ['today', 'book', 'kept'];
const PAPER = { light: '#FFFFFF', dark: '#0B0B0C' };

const views = {
  today: (root, options) => today.renderToday(root, options),
  book: (root) => book.renderBook(root),
  kept: (root) => renderKept(root),
};

// ---------------------------------------------------------------------------
// Rendering

function renderAll(options = {}) {
  applyLook();
  renderBar();
  for (const name of VIEWS) {
    const root = document.getElementById(`view-${name}`);
    const active = name === app.view;
    root.hidden = !active;
    if (!active && root.firstChild) {
      // Only the showing screen is in the DOM, so every test hook is unique.
      root.innerHTML = '';
      root.__html = null;
      if (name === 'today') today.resetToday();
    }
  }
  views[app.view](document.getElementById(`view-${app.view}`), options);
  writing.renderWriting(options);
  refreshSheet();
}

/** Theme and colour on <html>, plus the browser's bar colour. */
function applyLook() {
  const root = document.documentElement;
  const { theme, accent } = app.state.settings;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  root.dataset.accent = accentFor(app.state.course.chapter, accent);
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    const own = (meta.getAttribute('media') ?? '').includes('dark') ? PAPER.dark : PAPER.light;
    meta.setAttribute('content', theme === 'system' ? own : PAPER[theme]);
  }
}

function renderBar() {
  const tab = (view, label) =>
    `<button class="tab" type="button" data-action="go" data-view="${view}" data-test="nav-${view}"` +
    `${app.view === view ? ' aria-current="page"' : ''}>${esc(label)}</button>`;
  patch(
    document.getElementById('bar'),
    `<nav class="tabs" aria-label="${esc(COPY.appName)}">` +
      tab('today', COPY.navToday) +
      tab('book', COPY.navBook) +
      tab('kept', COPY.navKept) +
      '</nav>' +
      `<button class="gear" type="button" data-action="open-settings" data-test="settings-open" aria-label="${esc(COPY.settings)}">` +
      '<span class="gear-glyph" aria-hidden="true"><i></i><i></i></span></button>',
  );
}

// ---------------------------------------------------------------------------
// Actions and fields, gathered from the screen modules

const ACTIONS = {
  ...artist.actions,
  ...book.actions,
  ...sheets.actions,
  ...settings.actions,
  ...today.actions,
  ...writing.actions,
  go(el) {
    const view = el.dataset.view;
    if (view === app.view) {
      if (view === 'book' && app.chapterPage) {
        ACTIONS['chapter-back']();
        return;
      }
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
      return;
    }
    app.view = view;
    app.chapterPage = null;
    book.resetBook();
    render();
    window.scrollTo(0, 0);
  },
  'tap-page'(el) {
    const slot = Number(el.dataset.slot);
    commit(tapPage(app.state, app.today, slot, app.today), { interactive: true });
  },
  'sheet-close'() {
    closeSheet();
  },
};

const FIELDS = {
  ...artist.fields,
  ...sheets.fields,
  ...settings.fields,
  ...today.fields,
};

function fieldOf(target) {
  const name = target?.dataset?.field;
  return name ? FIELDS[name] : null;
}

function wireEvents() {
  document.addEventListener('click', (event) => {
    const el = event.target.closest('[data-action]');
    if (!el || el.disabled || el.closest('[inert]')) return;
    const handler = ACTIONS[el.dataset.action];
    if (handler) handler(el, event);
  });
  document.addEventListener('input', (event) => fieldOf(event.target)?.input?.(event.target, event));
  document.addEventListener('change', (event) => fieldOf(event.target)?.change?.(event.target, event));
  document.addEventListener('focusout', (event) => fieldOf(event.target)?.blur?.(event.target, event));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (sheetName()) closeSheet();
      // A running timer only stops on purpose, with Pause or Done.
      else if (app.writingOpen) {
        if (!writing.timerRunning()) writing.closeWriting();
      }
      else if (app.view === 'book' && app.chapterPage) ACTIONS['chapter-back']();
      return;
    }
    if (event.key === 'Enter' && !event.isComposing) fieldOf(event.target)?.enter?.(event.target, event);
  });
  // In a sheet, keep a focused field above the keyboard.
  document.addEventListener('focusin', (event) => {
    const field = event.target;
    if (!field.matches?.('input, textarea') || !field.closest('.sheet')) return;
    setTimeout(() => field.scrollIntoView({ block: 'nearest' }), 320);
  });
}

// ---------------------------------------------------------------------------
// The date rolls over at midnight; the page may have slept through it.

function checkDate() {
  const next = readToday();
  if (next === app.today) return;
  app.today = next;
  today.resetToday();
  render();
}

function watchDate() {
  setInterval(checkDate, 60_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkDate();
  });
  window.addEventListener('focus', checkDate);
  window.addEventListener('pageshow', checkDate);
}

// Sheets follow the visible viewport, so the keyboard never covers them.
function watchViewport() {
  const viewport = window.visualViewport;
  if (!viewport) return;
  const sync = () => {
    const style = document.documentElement.style;
    style.setProperty('--vv-h', `${viewport.height}px`);
    style.setProperty('--vv-top', `${viewport.offsetTop}px`);
  };
  viewport.addEventListener('resize', sync);
  viewport.addEventListener('scroll', sync);
  sync();
}

// ---------------------------------------------------------------------------
// Saves that wait for a pause in typing go through at once when the app goes
// to the background or the page goes away.

function watchLifecycle() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPending();
  });
  window.addEventListener('pagehide', flushPending);
}

// ---------------------------------------------------------------------------
// Service worker: a new version takes over and the page reloads once, but
// never under his hands. It waits while the writing screen is open or its
// timer runs, while a sheet is open, and while he's typing; then it reloads
// as soon as that ends, or when the app goes to the background (where
// nobody sees it), unless a writing session is still going.

function typing() {
  const field = document.activeElement;
  return Boolean(field?.matches?.('textarea, input:not([type="file"])'));
}

function registerWorker() {
  if (!('serviceWorker' in navigator) || window.location.protocol === 'file:') return;
  const hadController = Boolean(navigator.serviceWorker.controller);
  let ready = false;
  let reloading = false;
  let told = false;

  const writingBusy = () => app.writingOpen || writing.timerRunning();
  const busy = () => writingBusy() || sheetName() !== null || typing();

  const reload = () => {
    if (reloading) return;
    reloading = true;
    flushPending();
    window.location.reload();
  };
  const reloadWhenFree = () => {
    if (ready && !busy()) reload();
  };

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return; // first install: nothing old on screen
    ready = true;
    if (!busy()) {
      reload();
      return;
    }
    if (writingBusy() && !told) {
      told = true;
      toast(COPY.updateWaiting);
    }
  });
  writing.onWritingClosed(reloadWhenFree);
  onSheetClosed(reloadWhenFree);
  // After a blur, focus may land on another field: check once it has.
  document.addEventListener('focusout', () => setTimeout(reloadWhenFree, 0));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && ready && !writingBusy()) reload();
  });

  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// ---------------------------------------------------------------------------
// Boot

function start() {
  boot();
  setRenderer(renderAll);
  settings.onDataReplaced(() => {
    clearDrafts();
    today.resetToday();
    artist.resetArtist();
    book.resetBook();
  });
  writing.buildWriting(document.getElementById('writing'));
  wireEvents();
  render();
  applyLayers();
  writing.restoreTimer();
  watchDate();
  watchViewport();
  watchLifecycle();
  watchOtherTabs();
  registerWorker();
  requestAnimationFrame(() =>
    requestAnimationFrame(() => document.documentElement.classList.remove('no-anim')),
  );
}

start();
