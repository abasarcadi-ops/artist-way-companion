// Today: where he is in the course, the morning pages, this week, the
// artist date and the month count. Before today's pages are done the
// screen is about the pages.

import { CHAPTERS, COPY, PICKUP, REENTRY } from '../content.js';
import {
  chapterInfo,
  monthOf,
  monthPages,
  pagesOn,
  parseKey,
  reentry,
  setKeep,
  startChapter,
  weekRow,
} from '../core.js';
import { artistSectionHtml, ensureIdea, syncArtistFields } from './artist.js';
import { dayMonth, longDate, monthName, pickByDay, weekRange, weekdayName } from './dates.js';
import { esc, fill, fillHtml, fitHeight, focus, patch, raw, sentences, setValue, strokes } from './dom.js';
import { slotsHtml, statusHtml, syncSlots } from './slots.js';
import { app, commit, pendingSave } from './store.js';

// What the last render drew, so only real changes animate.
let mountedOn = null;
let shown = null;
let closing = null; // timer that closes up the faded re-entry line

export function resetToday() {
  mountedOn = null;
  shown = null;
  clearTimeout(closing);
}

function mount(root) {
  root.innerHTML =
    '<section class="where" aria-label="' + esc(COPY.navToday) + '" data-region="where"></section>' +
    '<div data-region="pickup"></div>' +
    '<div data-region="course"></div>' +
    '<div class="reentry gone" data-test="reentry" data-region="reentry" aria-hidden="true"><div><p></p></div></div>' +
    '<section class="pages" aria-labelledby="mp-h">' +
    `<h2 class="h-xl" id="mp-h">${esc(COPY.morningPages)}</h2>` +
    `<p class="sub">${esc(COPY.morningSub)}</p>` +
    '<div class="slots-row">' +
    slotsHtml('', 'mp-h') +
    '<p class="status" aria-live="polite" data-region="status"></p>' +
    '</div>' +
    '<button class="btn-now start" type="button" data-action="open-writing" data-test="start-writing">' +
    `<span>${esc(COPY.startWriting)}</span><span class="aside" data-region="minutes"></span></button>` +
    '<div class="keep" data-region="keep" hidden>' +
    '<div class="keep-head">' +
    `<label for="keep-in">${esc(COPY.keepPrompt)}</label>` +
    '<span class="kept-flag" data-region="kept-flag" aria-live="polite"></span></div>' +
    // A textarea that grows with its text, so a long line shows in full. Enter still saves.
    '<textarea class="line-input" id="keep-in" rows="1" maxlength="280" autocomplete="off" autocapitalize="sentences"' +
    ` enterkeyhint="done" placeholder="${esc(COPY.keepPlaceholder)}" data-field="keep" data-test="keep-input"></textarea>` +
    '</div>' +
    '</section>' +
    '<section class="sec" aria-labelledby="wk-h" data-region="week"></section>' +
    '<section class="sec" aria-labelledby="ad-h" data-region="artist"></section>' +
    '<section class="sec" aria-labelledby="mo-h" data-region="month"></section>';
  mountedOn = root;
  // reentry: off | on | fading | closed. touched: a page changed during this visit.
  shown = { pages: null, days: null, reentry: 'off', touched: false };
}

export function renderToday(root, { interactive = false } = {}) {
  if (mountedOn !== root || !root.firstChild) mount(root);
  ensureIdea();
  const { state, today } = app;
  const info = chapterInfo(state, today);
  const pickup = !info.startedOn;
  const n = pagesOn(state, today);
  const prev = interactive ? shown.pages : null;
  const region = (name) => root.querySelector(`[data-region="${name}"]`);

  patch(region('where'), whereHtml(info, pickup, today));
  patch(region('pickup'), pickup ? pickupHtml(info) : '');
  patch(region('course'), info.finishedOn && info.num === 12 ? `<p class="lead course-done">${esc(COPY.courseDone)}</p>` : '');
  syncReentry(region('reentry'), pickup ? null : reentry(state, today), today, interactive);

  // Morning pages
  syncSlots(root.querySelector('.slots'), n, prev);
  patch(region('status'), statusHtml(n, { today, hint: COPY.pagesHint, arrive: prev !== null && prev < 3, hooks: true }));
  region('minutes').textContent = fill(COPY.minutesOption, { n: state.settings.minutes });
  root.querySelector('[data-test="start-writing"]').hidden = n === 3;
  const keepText = state.days[today]?.keep ?? '';
  const keep = region('keep');
  keep.hidden = n < 3 && keepText === '';
  setValue(keep.querySelector('#keep-in'), keepText);
  fitHeight(keep.querySelector('#keep-in'));

  // Everything below the pages
  const days = daysShown(state, today);
  patch(region('week'), weekHtml(state, today, info, shown.days));
  patch(region('artist'), artistSectionHtml(info.num, { primary: n === 3 }));
  syncArtistFields(region('artist'), info.num);
  patch(region('month'), monthHtml(state, today, shown.days));

  shown.pages = n;
  shown.days = days;
}

// ---------------------------------------------------------------------------
// Where he is

function whereHtml(info, pickup, today) {
  const chapter = CHAPTERS[info.num - 1];
  const numeral = `<div class="numeral${info.num >= 10 ? ' two' : ''}" aria-hidden="true">${info.num}</div>`;
  const date = `<h1 class="date"><span>${esc(weekdayName(today))}</span> <span>${esc(dayMonth(today))}</span></h1>`;
  if (pickup) return `${numeral}<div class="where-text">${date}</div>`;
  // The name never splits at its own hyphen ("Self-" / "Protection") in a narrow column.
  const line = fillHtml(COPY.chapterLine, { n: info.num, name: raw(`<span class="nw">${esc(chapter.short)}</span>`) });
  const day = info.finishedOn ? '' : `<p class="dayof">${esc(fill(COPY.chapterDay, { day: info.dayOfChapter }))}</p>`;
  return (
    `${numeral}<div class="where-text">${date}` +
    `<p class="week" data-test="chapter-line">${line}</p>` +
    `<p class="title">${esc(chapter.title)}</p>${day}</div>`
  );
}

function pickupHtml(info) {
  const { state } = app;
  const moved = state.legacyV1 !== null;
  const fresh = !moved && Object.keys(state.chapters).length === 0 && Object.keys(state.days).length === 0;
  const title = fresh ? PICKUP.freshTitle : fill(PICKUP.title, { n: info.num });
  const line = moved ? PICKUP.lineMoved : fresh ? PICKUP.freshLine : PICKUP.line;
  return (
    '<section class="pickup" data-test="pickup" aria-labelledby="pk-h">' +
    `<h2 class="h-xl" id="pk-h">${esc(title)}</h2>` +
    `<p class="lead">${esc(line)}</p>` +
    // Outlined: Start writing stays the one filled button on Today.
    `<button class="btn btn-wide" type="button" data-action="pickup-start" data-test="pickup-start">${esc(fill(PICKUP.start, { n: info.num }))}</button>` +
    `<button class="textbtn" type="button" data-action="pickup-choose" data-test="pickup-choose">${esc(PICKUP.choose)}</button>` +
    '</section>'
  );
}

// ---------------------------------------------------------------------------
// The coming-back line, said once per visit.
//
// It shows when Today is drawn and no page has been touched yet. Marking a
// page fades it where it stands, so the slots don't move under the thumb.
// The empty space closes up once nobody has touched or scrolled the screen
// for a moment, and stays closed until the next visit. Unmarking the page
// before then fades the line back in, in the same place.

const QUIET_MS = 1600;
const STALE_MS = 6000; // a finger whose pointerup never came stops counting
const fingers = new Set();
let lastTouch = 0;

function noteTouch(event) {
  lastTouch = Date.now();
  if (event.type === 'pointerdown') fingers.add(event.pointerId);
  else if (event.type !== 'scroll') fingers.delete(event.pointerId);
}
for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'scroll']) {
  window.addEventListener(type, noteTouch, { capture: true, passive: true });
}

function syncReentry(el, gap, today, interactive) {
  if (interactive) shown.touched = true;
  if (gap) {
    const line = fill(pickByDay(REENTRY[gap.bucket], today), { n: gap.gapDays });
    const [first, ...rest] = sentences(line);
    patch(el.querySelector('p'), `<strong>${esc(first)}</strong> ${esc(rest.join(' '))}`);
  }
  const was = shown.reentry;
  let now = was;
  if (gap && (was === 'fading' || (was === 'off' && !shown.touched))) now = 'on';
  else if (!gap && was === 'on') now = interactive ? 'fading' : 'closed';
  if (now === was) return;

  shown.reentry = now;
  el.setAttribute('aria-hidden', String(now !== 'on'));
  if (now === 'on') {
    clearTimeout(closing);
    el.classList.remove('gone', 'faded');
  } else if (now === 'fading') {
    el.classList.add('faded');
    closeWhenQuiet(el);
  } else {
    closeReentry(el, { instant: true });
  }
}

function closeWhenQuiet(el, wait = QUIET_MS) {
  clearTimeout(closing);
  closing = setTimeout(() => {
    if (shown?.reentry !== 'fading' || !el.isConnected) return;
    const quiet = Date.now() - lastTouch;
    if (quiet > STALE_MS) fingers.clear();
    if (fingers.size === 0 && quiet >= QUIET_MS) closeReentry(el);
    else closeWhenQuiet(el, Math.max(250, QUIET_MS - quiet));
  }, wait);
}

// Closes up the space. Scrolled out of view above, or with the app in the
// background, it closes at once, and the scroll moves with it so whatever is
// on screen stays exactly where it was.
function closeReentry(el, { instant = false } = {}) {
  clearTimeout(closing);
  shown.reentry = 'closed';
  el.setAttribute('aria-hidden', 'true');
  const above = el.getBoundingClientRect().top < 0;
  const still = instant || above || document.visibilityState === 'hidden';
  // Everything below the line (starting with the pages section) moves by the
  // same amount, so one element is enough to measure.
  const below = el.nextElementSibling;
  const before = below.getBoundingClientRect().top;
  if (still) el.classList.add('still');
  el.classList.remove('faded');
  el.classList.add('gone');
  if (!still) return;
  // Reading the position also settles the new size before transitions come
  // back. Some browsers keep the view steady on their own (scroll anchoring),
  // so only scroll by whatever actually moved.
  const moved = below.getBoundingClientRect().top - before;
  if (above && moved) window.scrollBy(0, moved);
  el.classList.remove('still');
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'hidden' || shown?.reentry !== 'fading') return;
  const el = document.querySelector('[data-region="reentry"]');
  if (el) closeReentry(el, { instant: true });
});

// ---------------------------------------------------------------------------
// This week

function daysShown(state, today) {
  const map = {};
  for (const d of weekRow(state, today)) map[d.key] = d.pages;
  const prefix = `${monthOf(today)}-`;
  for (const [key, day] of Object.entries(state.days)) {
    if (key.startsWith(prefix) && key <= today) map[key] = day.pages;
  }
  return map;
}

function freshFrom(prevDays, key, pages) {
  if (!prevDays) return null;
  const before = prevDays[key] ?? 0;
  return pages > before ? before : null;
}

function weekHtml(state, today, info, prevDays) {
  const row = weekRow(state, today);
  const cells = row
    .map((d, i) => {
      const label = fill(COPY.dayAria, { date: longDate(d.key), n: d.pages });
      const inner =
        `<span class="ground" aria-hidden="true">${strokes(d.pages, { now: d.isToday, fresh: freshFrom(prevDays, d.key, d.pages) })}</span>` +
        `<span class="dl" aria-hidden="true">${esc(COPY.weekDays[i])}</span>` +
        `<span class="dn" aria-hidden="true">${parseKey(d.key).getDate()}</span>`;
      const cls = `day${d.isToday ? ' today' : ''}${d.isFuture ? ' future' : ''}`;
      if (d.isFuture) {
        return `<li class="${cls}"><div class="day-cell" data-test="week-day-${d.key}"><span class="vh">${esc(label)}</span>${inner}</div></li>`;
      }
      return (
        `<li class="${cls}"><button class="day-cell" type="button" data-action="backfill" data-key="${d.key}"` +
        ` data-test="week-day-${d.key}" aria-label="${esc(label)}"${d.isToday ? ' aria-current="date"' : ''}>${inner}</button></li>`
      );
    })
    .join('');

  let move = '';
  if (info.readyToMove) {
    const text = info.num === 12
      ? fill(COPY.moveLineLast, { day: info.dayOfChapter })
      : fill(COPY.moveLine, { day: info.dayOfChapter, n: info.num });
    move =
      `<button class="moveon" type="button" data-action="open-checkin" data-test="move-on">` +
      `<span>${esc(text)}</span><span class="arrow" aria-hidden="true"></span></button>`;
  }

  return (
    '<div class="sec-head">' +
    `<h2 class="h-l" id="wk-h">${esc(COPY.weekTitle)}</h2>` +
    `<span class="sec-aside">${esc(weekRange(row.map((d) => d.key)))}</span></div>` +
    `<ol class="weekrow" aria-labelledby="wk-h">${cells}</ol>${move}`
  );
}

// ---------------------------------------------------------------------------
// Month count: count up only

function monthHtml(state, today, prevDays) {
  const total = monthPages(state, today);
  const month = monthName(today);
  let heading;
  if (total === 0) heading = `<h2 class="month-line empty" id="mo-h" data-test="month-count">${esc(COPY.monthEmpty)}</h2>`;
  else {
    const text = total === 1
      ? esc(fill(COPY.monthCountOne, { month }))
      : fillHtml(COPY.monthCount, { n: raw(`<b>${total}</b>`), month });
    heading = `<h2 class="month-line" id="mo-h" data-test="month-count">${text}</h2>`;
  }
  const prefix = `${monthOf(today)}-`;
  const groups = Object.keys(state.days)
    .filter((key) => key.startsWith(prefix) && state.days[key].pages > 0)
    .sort()
    .map((key) => {
      const pages = state.days[key].pages;
      const isToday = key === today;
      return (
        `<div class="group${isToday ? ' is-now' : ''}">` +
        `<span class="strokes">${strokes(pages, { now: isToday, fresh: freshFrom(prevDays, key, pages) })}</span>` +
        `<span class="gd">${parseKey(key).getDate()}</span></div>`
      );
    })
    .join('');
  return heading + (groups ? `<div class="tally" aria-hidden="true">${groups}</div>` : '');
}

// ---------------------------------------------------------------------------
// Actions

const saveKeep = pendingSave((key, text) => {
  commit(setKeep(app.state, key, text), { render: false });
}, 450);

let keptTimer = null;
function flashKept() {
  const flag = document.querySelector('[data-region="kept-flag"]');
  if (!flag) return;
  flag.textContent = COPY.keepSaved;
  flag.classList.add('on');
  clearTimeout(keptTimer);
  keptTimer = setTimeout(() => {
    flag.classList.remove('on');
    flag.textContent = '';
  }, 2200);
}

export const actions = {
  'pickup-start'() {
    commit(startChapter(app.state, app.state.course.chapter, app.today));
    focus(document.querySelector('[data-test="start-writing"]'));
  },
};

// The keep line rewraps when the phone turns.
window.addEventListener('resize', () => fitHeight(document.getElementById('keep-in')));

export const fields = {
  keep: {
    input(el) {
      saveKeep(app.today, el.value);
      fitHeight(el);
    },
    blur(el) {
      saveKeep.flush();
      if (el.value.trim()) flashKept();
    },
    enter(el, event) {
      event.preventDefault();
      el.blur();
    },
  },
};
