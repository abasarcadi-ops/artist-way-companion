// Kept: every line kept from the pages, newest first, with its date.

import { COPY } from '../content.js';
import { keptLines, pagesOn } from '../core.js';
import { longDate } from './dates.js';
import { esc, patch, strokes } from './dom.js';
import { app } from './store.js';

export function renderKept(root) {
  const lines = keptLines(app.state);
  const head =
    '<div class="page-head">' +
    `<h1 class="h-xl">${esc(COPY.keptTitle)}</h1>` +
    `<p class="sub">${esc(COPY.keptSub)}</p></div>`;

  if (lines.length === 0) {
    patch(
      root,
      head +
        '<section class="kept-empty" data-test="kept-empty" aria-labelledby="ke-h">' +
        `<h2 class="h-l" id="ke-h">${esc(COPY.keptEmptyTitle)}</h2>` +
        `<p class="lead">${esc(COPY.keptEmpty)}</p>` +
        '<div class="rules" aria-hidden="true"><span></span><span></span><span></span></div>' +
        '</section>',
    );
    return;
  }

  const items = lines
    .map(({ key, text }) => {
      const pages = pagesOn(app.state, key);
      return (
        '<li class="kept-item">' +
        '<p class="kept-date">' +
        (pages ? `<span class="strokes" aria-hidden="true">${strokes(pages)}</span>` : '') +
        `<time datetime="${key}">${esc(longDate(key, app.today))}</time></p>` +
        `<p class="kept-text">${esc(text)}</p></li>`
      );
    })
    .join('');
  patch(root, `${head}<ol class="kept-list" data-test="kept-list">${items}</ol>`);
}
