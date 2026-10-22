// Book: the twelve chapters as a contents page, each row in its own chapter
// colour, and a page per chapter.

import { ACCENTS, CHAPTER_ACCENTS } from '../accents.js';
import { CHAPTERS, CHECKIN, COPY } from '../content.js';
import { chapterInfo, chapterOf, chapterStats, chapterStatus, setRead, startChapter } from '../core.js';
import { artistSectionHtml, ensureIdea, syncArtistFields } from './artist.js';
import { longDate, shortDate } from './dates.js';
import { esc, fill, focus, patch, reveal, splitAround, strokes } from './dom.js';
import { app, commit, render } from './store.js';
import { hideToast } from './toast.js';

let confirming = null; // chapter whose "start this week" is waiting for a yes
let contentsScroll = 0;

export function resetBook() {
  confirming = null;
}

export function renderBook(root) {
  if (app.chapterPage) renderChapter(root, app.chapterPage);
  else renderContents(root);
}

// "Recovering a Sense of" and "Integrity"
function titleParts(chapter) {
  return [chapter.title.slice(0, chapter.title.length - chapter.short.length).trim(), chapter.short];
}

function count(n, many, one) {
  return n === 1 ? one : fill(many, { n });
}

// ---------------------------------------------------------------------------
// Contents

function renderContents(root) {
  const { state } = app;
  const rows = CHAPTERS.map((chapter) => rowHtml(chapter)).join('');
  patch(
    root,
    '<div class="page-head">' +
      `<h1 class="h-xl">${esc(COPY.bookTitle)}</h1>` +
      `<p class="sub">${esc(COPY.bookSub)}</p>` +
      (state.legacyV1 ? `<p class="sub">${esc(COPY.migratedNote)}</p>` : '') +
      '</div>' +
      `<ol class="toc">${rows}</ol>`,
  );
}

function rowHtml(chapter) {
  const { state, today } = app;
  const num = chapter.num;
  const status = chapterStatus(state, num, today);
  const stats = chapterStats(state, num, today);
  const [pre, key] = titleParts(chapter);
  let meta = '';

  if (status === 'done') {
    const parts = [];
    if (stats.mornings > 0) parts.push(count(stats.mornings, COPY.countMornings, COPY.countMorningsOne));
    if (stats.artistDateDone) parts.push(COPY.artistDateDone);
    if (parts.length === 0) parts.push(COPY.statusDone);
    meta =
      '<span class="meta">' +
      (stats.mornings > 0 ? `<span class="strokes" aria-hidden="true">${strokes(stats.mornings, { five: true })}</span>` : '') +
      `<span class="dots">${parts.map((p) => `<span>${esc(p)}</span>`).join('')}</span></span>`;
  } else if (status === 'current') {
    const info = chapterInfo(state, today);
    const started = info.startedOn
      ? fill(COPY.startedOnDay, { date: longDate(info.startedOn, today), day: info.dayOfChapter })
      : COPY.statusCurrent;
    meta = `<span class="meta"><span>${esc(started)}</span></span>`;
    if (stats.mornings > 0) {
      meta +=
        '<span class="meta">' +
        `<span class="strokes" aria-hidden="true">${strokes(stats.mornings, { five: true })}</span>` +
        `<span>${esc(count(stats.mornings, COPY.countMornings, COPY.countMorningsOne))}</span></span>`;
    }
  } else {
    // Still to come: the row names its paint, so the contents read as the colour chart.
    const paint = ACCENTS.find((accent) => accent.key === CHAPTER_ACCENTS[num])?.name;
    if (paint) meta = `<span class="meta"><span class="paint">${esc(paint)}</span></span>`;
  }

  return (
    `<li data-accent="${CHAPTER_ACCENTS[num]}">` +
    `<button class="ch ${status}" type="button" data-action="open-chapter" data-num="${num}" data-test="book-row-${num}"` +
    `${status === 'current' ? ' aria-current="step"' : ''}>` +
    `<span class="n">${num}</span>` +
    `<span class="t"><span class="pre">${esc(pre)}</span><span class="key">${esc(key)}</span>${meta}</span>` +
    '<span class="swatch" aria-hidden="true"></span>' +
    '</button></li>'
  );
}

// ---------------------------------------------------------------------------
// Chapter page

function renderChapter(root, num) {
  ensureIdea();
  const { state, today } = app;
  const chapter = CHAPTERS[num - 1];
  const data = chapterOf(state, num);
  const status = chapterStatus(state, num, today);
  const info = chapterInfo(state, today);
  const isCurrent = num === state.course.chapter;
  const [pre, key] = titleParts(chapter);

  const stateParts = [];
  if (status === 'done') stateParts.push(COPY.statusDone);
  else if (status === 'current') {
    stateParts.push(COPY.statusCurrent);
    if (info.dayOfChapter) stateParts.push(fill(COPY.chapterDay, { day: info.dayOfChapter }));
  } else stateParts.push(COPY.statusUpcoming);

  const html =
    `<div class="chapter" data-accent="${CHAPTER_ACCENTS[num]}" data-test="chapter-page">` +
    `<button class="back" type="button" data-action="chapter-back" data-test="chapter-back"><span class="chev" aria-hidden="true"></span>${esc(COPY.allChapters)}</button>` +
    '<header class="cp-band">' +
    `<div class="numeral${num >= 10 ? ' two' : ''}" aria-hidden="true">${num}</div>` +
    '<div>' +
    `<h1 id="cp-title" tabindex="-1"><span class="vh">${esc(fill(COPY.weekLabel, { n: num }))}. </span>` +
    `<span class="pre">${esc(pre)}</span> <span class="key">${esc(key)}</span></h1>` +
    `<p class="state">${stateParts.map((p) => `<span>${esc(p)}</span>`).join('')}</p>` +
    '</div></header>' +
    `<p class="about">${esc(chapter.about)}</p>` +
    '<section class="sec" aria-labelledby="th-h">' +
    `<h2 class="h-l" id="th-h">${esc(COPY.themesHeading)}</h2>` +
    `<ul class="themes">${chapter.themes.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></section>` +
    (chapter.note
      ? `<aside class="heads-up" aria-labelledby="hu-h"><h2 id="hu-h">${esc(COPY.noteHeading)}</h2><p>${esc(chapter.note)}</p></aside>`
      : '') +
    `<button class="tick-row" type="button" data-action="chapter-read" data-num="${num}" data-test="chapter-read" aria-pressed="${data.read}">` +
    `<span>${esc(COPY.readLabel)}</span><span class="box" aria-hidden="true"></span></button>` +
    `<section class="sec" aria-labelledby="ad-h">${artistSectionHtml(num)}</section>` +
    statsHtml(num, data) +
    checkinHtml(data) +
    startHtml(num, isCurrent, info, status) +
    '</div>';

  patch(root, html);
  syncArtistFields(root, num);
}

function statsHtml(num, data) {
  const { state, today } = app;
  const stats = chapterStats(state, num, today);
  const legacy = data.legacy;
  const dated = stats.mornings - (legacy?.mornings ?? 0);
  const figures = [];
  if (dated > 0) {
    figures.push(figure(dated, COPY.countMornings, COPY.countMorningsOne));
    figures.push(figure(stats.pages, COPY.countPages, COPY.countPagesOne));
  }
  const facts = [];
  if (legacy?.mornings > 0) {
    facts.push(
      `<li><span class="strokes" aria-hidden="true">${strokes(Math.min(legacy.mornings, 7))}</span>` +
        `<span>${esc(count(legacy.mornings, COPY.legacyMornings, COPY.legacyMorningsOne))}</span></li>`,
    );
  }
  if (stats.artistDateDone) {
    facts.push(`<li><i class="stroke is-now" aria-hidden="true"></i><span>${esc(COPY.artistDateDone)}</span></li>`);
  }
  if (figures.length === 0 && facts.length === 0) return '';
  return (
    '<section class="sec" aria-labelledby="lg-h">' +
    `<h2 class="h-l" id="lg-h">${esc(COPY.statsHeading)}</h2>` +
    (figures.length ? `<div class="figures">${figures.join('')}</div>` : '') +
    (facts.length ? `<ul class="facts">${facts.join('')}</ul>` : '') +
    '</section>'
  );
}

// A big number and its word: "14" over "pages".
function figure(n, many, one) {
  const label = n === 1 ? one.replace(/^\s*1\s*/, '') : splitAround(many)[1].trim();
  return `<p class="figure"><b>${n}</b><span>${esc(label)}</span></p>`;
}

function checkinHtml(data) {
  const { doneOn } = data.checkin;
  if (!doneOn) return '';
  const answers = CHECKIN.questions
    .filter((q) => data.checkin[q.id].trim())
    .map((q) => `<dt>${esc(q.q)}</dt><dd>${esc(data.checkin[q.id])}</dd>`)
    .join('');
  if (!answers) return '';
  return (
    '<section class="sec" aria-labelledby="ci-h">' +
    `<div class="sec-head"><h2 class="h-l" id="ci-h">${esc(COPY.checkinHeading)}</h2>` +
    `<span class="sec-aside">${esc(shortDate(doneOn))}</span></div>` +
    `<dl class="answers">${answers}</dl></section>`
  );
}

function startHtml(num, isCurrent, info, status) {
  if (isCurrent && info.finishedOn) return '';
  const restart = isCurrent && Boolean(info.startedOn);
  if (confirming === num) {
    const question = restart
      ? fill(COPY.restartConfirm, { n: num })
      : fill(COPY.startConfirm, { n: num, current: app.state.course.chapter });
    return (
      '<div class="cp-start confirm" role="group" aria-labelledby="cp-q">' +
      `<p id="cp-q" tabindex="-1">${esc(question)}</p>` +
      '<div class="stack">' +
      `<button class="btn btn-ink" type="button" data-action="chapter-confirm" data-num="${num}" data-test="confirm-yes">${esc(fill(COPY.startConfirmYes, { n: num }))}</button>` +
      `<button class="btn" type="button" data-action="chapter-cancel" data-test="confirm-no">${esc(COPY.startConfirmNo)}</button>` +
      '</div></div>'
    );
  }
  if (restart) {
    return (
      '<div class="cp-start">' +
      `<button class="btn btn-wide" type="button" data-action="chapter-ask" data-num="${num}" data-test="chapter-restart">${esc(COPY.restartThisWeek)}</button></div>`
    );
  }
  // Going back to a finished chapter is the rare case, so it gets the quiet button.
  const again = status === 'done';
  return (
    '<div class="cp-start">' +
    `<button class="btn${again ? '' : ' btn-ink'} btn-wide" type="button" data-action="${isCurrent ? 'chapter-confirm' : 'chapter-ask'}" data-num="${num}" data-test="chapter-start">` +
    `${esc(again ? COPY.restartThisWeek : COPY.startThisWeek)}</button></div>`
  );
}

// ---------------------------------------------------------------------------
// Actions

export const actions = {
  'open-chapter'(el) {
    contentsScroll = window.scrollY;
    confirming = null;
    app.chapterPage = Number(el.dataset.num);
    render();
    window.scrollTo(0, 0);
    focus(document.getElementById('cp-title'));
  },
  'chapter-back'() {
    const num = app.chapterPage;
    app.chapterPage = null;
    confirming = null;
    render();
    window.scrollTo(0, contentsScroll);
    focus(document.querySelector(`[data-test="book-row-${num}"]`));
  },
  'chapter-read'(el) {
    const num = Number(el.dataset.num);
    commit(setRead(app.state, num, !chapterOf(app.state, num).read));
  },
  'chapter-ask'(el) {
    confirming = Number(el.dataset.num);
    render();
    hideToast();
    const question = document.getElementById('cp-q');
    reveal(question?.closest('.confirm'), question);
  },
  'chapter-cancel'() {
    const num = confirming;
    confirming = null;
    render();
    focus(document.querySelector(`[data-num="${num}"][data-action="chapter-ask"]`));
  },
  'chapter-confirm'(el) {
    confirming = null;
    commit(startChapter(app.state, Number(el.dataset.num), app.today));
    window.scrollTo(0, 0);
    focus(document.getElementById('cp-title'));
  },
};
