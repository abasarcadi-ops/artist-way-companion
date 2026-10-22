// The small sheets that open from Today: backfill a day, choose a week,
// and the chapter check-in.

import { CHAPTERS, CHECKIN, COPY, PICKUP } from '../content.js';
import { CHAPTER_ACCENTS } from '../accents.js';
import { chapterStats, finishChapter, pagesOn, setPages, startChapter } from '../core.js';
import { longDate } from './dates.js';
import { $, esc, fill, focus, patch, setValue, splitAround, strokes } from './dom.js';
import { closeSheet, openSheet, sheetHead } from './sheet.js';
import { app, commit, getDraft, setDraft } from './store.js';

// ---------------------------------------------------------------------------
// Backfill: how many pages on a past day (or today)

export function openBackfill(key, opener = null) {
  openSheet({ name: 'backfill', test: 'backfill-sheet', opener, render: (body) => renderBackfill(body, key) });
}

function renderBackfill(body, key) {
  const n = pagesOn(app.state, key);
  const title = key === app.today
    ? `<span>${esc(COPY.backfillTitleToday)}</span>`
    : titleLines(COPY.backfillTitle, longDate(key, app.today));
  const choices = [0, 1, 2, 3]
    .map((v) => {
      const marks = v === 0 ? '<span class="ground-empty"></span>' : `<span class="strokes">${strokes(v, { now: key === app.today })}</span>`;
      const label = v === 0 ? `<span class="choice-label word">${esc(COPY.backfillNone)}</span>` : `<span class="choice-label">${v}</span>`;
      return (
        `<button class="choice" type="button" data-action="backfill-set" data-key="${key}" data-n="${v}"` +
        ` data-test="backfill-${v}" aria-pressed="${v === n}">${marks}${label}</button>`
      );
    })
    .join('');
  patch(
    body,
    sheetHead(title) +
      `<p class="sheet-sub">${esc(COPY.backfillSub)}</p>` +
      `<div class="choices" role="group" aria-labelledby="sheet-title">${choices}</div>`,
  );
}

// "Pages on" over "Tuesday 20 October": the date gets its own line.
function titleLines(template, date) {
  const [before, after] = splitAround(template, 'date');
  return `<span>${esc(before.trim())}</span> <span>${esc(date)}${esc(after)}</span>`;
}

// ---------------------------------------------------------------------------
// Week chooser: pick up at any week

export function openChooser(opener = null) {
  openSheet({ name: 'chooser', test: 'chooser-sheet', opener, render: renderChooser });
}

function renderChooser(body) {
  const suggested = app.state.course.chapter;
  const tiles = CHAPTERS.map((chapter) => {
    const label = fill(COPY.chapterLine, { n: chapter.num, name: chapter.short });
    const isSuggested = chapter.num === suggested;
    return (
      `<button class="tile${isSuggested ? ' is-suggested' : ''}" type="button" data-accent="${CHAPTER_ACCENTS[chapter.num]}"` +
      ` data-action="choose-week" data-n="${chapter.num}" data-test="week-choose-${chapter.num}" aria-label="${esc(label)}"` +
      `${isSuggested ? ' aria-current="true"' : ''}>` +
      `<span class="tile-n" aria-hidden="true">${chapter.num}</span>` +
      `<span class="tile-name" aria-hidden="true">${esc(chapter.short)}</span>` +
      '<span class="swatch" aria-hidden="true"></span></button>'
    );
  }).join('');
  patch(
    body,
    sheetHead(esc(PICKUP.chooseTitle)) +
      `<p class="sheet-sub">${esc(PICKUP.chooseLine)}</p>` +
      `<div class="tiles">${tiles}</div>`,
  );
}

// ---------------------------------------------------------------------------
// Check-in: closing a chapter and starting the next

// The answers are drafts until "Start week n+1" goes through: closing the
// sheet, a stray tap on the backdrop or "Not yet" keeps them, and so does a
// reload, since they live in storage per chapter.
const draftName = (num, id) => `checkin-${num}-${id}`;

export function openCheckin(opener = null) {
  openSheet({ name: 'checkin', test: 'checkin-sheet', opener, render: renderCheckin });
}

function countText(n, many, one) {
  return n === 1 ? one : fill(many, { n });
}

function checkinIntro(stats) {
  const artistDate = stats.artistDateDone ? COPY.checkinArtistDone : COPY.checkinArtistNone;
  const mornings = countText(stats.mornings, COPY.countMornings, COPY.countMorningsOne);
  if (stats.pages > 0) {
    const pages = countText(stats.pages, COPY.countPages, COPY.countPagesOne);
    return fill(CHECKIN.intro, { pages, mornings, artistDate });
  }
  if (stats.mornings > 0) return fill(COPY.checkinIntroMornings, { mornings, artistDate });
  return fill(COPY.checkinIntroEmpty, { artistDate });
}

function renderCheckin(body) {
  const num = app.state.course.chapter;
  const stats = chapterStats(app.state, num, app.today);
  const last = num === 12;
  const questions = CHECKIN.questions
    .map(
      (q) =>
        '<div class="question">' +
        `<label for="ci-${q.id}">${esc(q.q)}</label>` +
        `<p class="hint" id="ci-${q.id}-hint">${esc(q.hint)}</p>` +
        `<textarea class="note" id="ci-${q.id}" rows="3" maxlength="600" autocapitalize="sentences"` +
        ` placeholder="${esc(COPY.checkinPlaceholder)}" aria-describedby="ci-${q.id}-hint"` +
        ` data-field="checkin" data-id="${q.id}" data-test="checkin-${q.id}"></textarea></div>`,
    )
    .join('');
  const next = last ? '' : ` data-accent="${CHAPTER_ACCENTS[num + 1]}"`;
  const submitText = last ? COPY.checkinFinishLast : fill(COPY.checkinNext, { next: num + 1 });
  patch(
    body,
    sheetHead(esc(fill(COPY.checkinTitle, { n: num }))) +
      `<p class="checkin-intro">${esc(checkinIntro(stats))}</p>` +
      `<p class="sheet-sub">${esc(COPY.checkinOptional)}</p>` +
      questions +
      '<div class="sheet-actions">' +
      `<div${next}><button class="btn-now" type="button" data-action="checkin-submit" data-test="checkin-submit">${esc(submitText)}</button></div>` +
      `<button class="btn" type="button" data-action="sheet-close">${esc(COPY.checkinNotYet)}</button>` +
      '</div>',
  );
  for (const q of CHECKIN.questions) setValue($(`#ci-${q.id}`, body), getDraft(draftName(num, q.id)));
}

// ---------------------------------------------------------------------------
// Actions

export const actions = {
  backfill(el) {
    openBackfill(el.dataset.key, el);
  },
  'backfill-set'(el) {
    commit(setPages(app.state, el.dataset.key, Number(el.dataset.n), app.today), { interactive: true });
    closeSheet();
  },
  'pickup-choose'(el) {
    openChooser(el);
  },
  'choose-week'(el) {
    commit(startChapter(app.state, Number(el.dataset.n), app.today));
    closeSheet({ restoreFocus: false });
    window.scrollTo(0, 0);
    focus(document.querySelector('[data-test="start-writing"]'));
  },
  'open-checkin'(el) {
    openCheckin(el);
  },
  'checkin-submit'() {
    const num = app.state.course.chapter;
    const answers = Object.fromEntries(CHECKIN.questions.map((q) => [q.id, getDraft(draftName(num, q.id))]));
    if (!commit(finishChapter(app.state, app.today, answers))) return;
    for (const q of CHECKIN.questions) setDraft(draftName(num, q.id), '');
    closeSheet({ restoreFocus: false });
    window.scrollTo(0, 0);
    focus(document.querySelector('[data-test="start-writing"]'));
  },
};

export const fields = {
  checkin: {
    input(el) {
      setDraft(draftName(app.state.course.chapter, el.dataset.id), el.value);
    },
  },
};
