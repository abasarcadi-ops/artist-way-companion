// The three page slots and the line beside them. Used on Today and on the
// writing screen. Slots are built once and updated in place, so the fill
// can run its stroke animation.

import { COPY, DONE_LINES } from '../content.js';
import { pickByDay } from './dates.js';
import { esc, fill, sentences, splitAround } from './dom.js';

/** `prefix` keeps test hooks apart: "" on Today, "w-" on the writing screen. */
export function slotsHtml(prefix, labelledBy) {
  let html = `<div class="slots" role="group" aria-labelledby="${labelledBy}">`;
  for (let k = 1; k <= 3; k += 1) {
    html +=
      `<button class="slot" type="button" data-action="tap-page" data-slot="${k}" data-test="${prefix}page-slot-${k}"` +
      ` aria-pressed="false" aria-label="${esc(fill(COPY.pageSlot, { n: k }))}">` +
      '<span class="bar-s" aria-hidden="true"><span class="fill"></span></span></button>';
  }
  return `${html}</div>`;
}

/**
 * Shows n pages. `prev` is the count drawn before, when the change came from
 * a tap: the newly filled slots then fill one after another.
 */
export function syncSlots(group, n, prev = null) {
  if (!group) return;
  for (const slot of group.querySelectorAll('.slot')) {
    const k = Number(slot.dataset.slot);
    const on = k <= n;
    slot.setAttribute('aria-pressed', String(on));
    slot.classList.toggle('next', k === n + 1);
    const delay = prev !== null && on && k > prev ? (k - prev - 1) * 80 : 0;
    slot.querySelector('.fill').style.transitionDelay = `${delay}ms`;
  }
}

/**
 * The line next to the slots: a hint at 0, "n of 3" at 1 or 2, the done
 * line at 3. `hooks` adds the test hooks (Today only, so they stay unique).
 */
export function statusHtml(n, { today, hint, arrive = false, hooks = false }) {
  if (n <= 0) return hint ? `<span class="hint">${esc(hint)}</span>` : '';
  if (n < 3) {
    const [before, after] = splitAround(COPY.pagesPartial);
    return (
      `<span class="count"${hooks ? ' data-test="pages-count"' : ''}>` +
      `${esc(before)}${n}<small>${esc(after)}</small></span>`
    );
  }
  const line = pickByDay(DONE_LINES, today);
  const parts = sentences(line).map((s) => `<span>${esc(s)}</span>`).join(' ');
  return `<span class="done${arrive ? ' arrive' : ''}"${hooks ? ' data-test="done-line"' : ''}>${parts}</span>`;
}
