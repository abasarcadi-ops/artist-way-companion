// Bottom sheets: one at a time, a real modal dialog for screen readers.
// Everything under a sheet is inert, so focus can't leave it. Escape, the
// close button and a tap on the backdrop all close it, and focus goes back
// to whatever opened it. WebKit doesn't focus a button on tap, so callers
// pass the tapped element in as `opener`.

import { COPY } from '../content.js';
import { esc, focus } from './dom.js';
import { app, applyLayers } from './store.js';

const CLOSE_MS = 360;
let current = null;
const closedListeners = [];

/** Runs after any sheet closes (app.js waits for this before an update reload). */
export function onSheetClosed(fn) {
  closedListeners.push(fn);
}

/**
 * Opens a sheet. `render(body)` fills it and runs again on every app render,
 * so it should patch() rather than rebuild. `test` is the panel's data-test.
 */
export function openSheet({ name, test, render, onClose = null, opener = null }) {
  const active = document.activeElement;
  opener ??= active instanceof HTMLElement && active !== document.body ? active : null;
  if (current) closeSheet({ instant: true, restoreFocus: false });
  for (const old of document.querySelectorAll('.sheet-layer')) old.remove();

  const layer = document.createElement('div');
  layer.className = 'sheet-layer';
  layer.dataset.sheet = name;
  layer.innerHTML =
    '<div class="scrim" data-action="sheet-close" aria-hidden="true"></div>' +
    `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" data-test="${esc(test)}" tabindex="-1">` +
    '<div class="sheet-in"></div></div>';
  document.getElementById('sheets').append(layer);

  current = {
    name,
    layer,
    panel: layer.querySelector('.sheet'),
    body: layer.querySelector('.sheet-in'),
    render,
    onClose,
    opener,
    openerTest: opener?.getAttribute('data-test') ?? null,
  };
  app.sheetOpen = true;
  applyLayers();
  refreshSheet();

  layer.getBoundingClientRect(); // lay out closed first, so the slide runs
  layer.classList.add('open');
  focus(current.panel);
}

/** Re-renders the open sheet from the current state. */
export function refreshSheet() {
  if (current) current.render(current.body);
}

export function sheetName() {
  return current?.name ?? null;
}

export function closeSheet({ instant = false, restoreFocus = true } = {}) {
  const sheet = current;
  if (!sheet) return;
  current = null;
  app.sheetOpen = false;
  applyLayers();

  sheet.layer.inert = true;
  sheet.layer.classList.remove('open');
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (instant || reduced) sheet.layer.remove();
  else setTimeout(() => sheet.layer.remove(), CLOSE_MS);

  if (restoreFocus) {
    const back = sheet.opener?.isConnected
      ? sheet.opener
      : sheet.openerTest && document.querySelector(`[data-test="${CSS.escape(sheet.openerTest)}"]`);
    if (back) focus(back);
  }
  sheet.onClose?.();
  // Next tick: a sheet replacing this one is open by then, so it counts.
  for (const fn of closedListeners) setTimeout(fn, 0);
}

/** The standard sheet header: a title and the close button. */
export function sheetHead(titleHtml) {
  return (
    '<div class="sheet-head">' +
    `<h2 class="sheet-title" id="sheet-title">${titleHtml}</h2>` +
    `<button class="x" type="button" data-action="sheet-close" aria-label="${esc(COPY.close)}"></button>` +
    '</div>'
  );
}
