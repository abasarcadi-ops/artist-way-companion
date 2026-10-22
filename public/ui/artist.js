// The artist date card, for one chapter. Today shows the current chapter's,
// the chapter page shows its own. Three states: unplanned (an idea from the
// deck, or his own plan), planned, done (with a note).

import { COPY, IDEAS } from '../content.js';
import {
  artistDateState,
  chapterOf,
  markArtistDate,
  markSeen,
  pickNext,
  planArtistDate,
  setArtistNote,
  unmarkArtistDate,
} from '../core.js';
import { longDate } from './dates.js';
import { $, esc, fill, focus, setValue } from './dom.js';
import { app, commit, getDraft, pendingSave, render, setDraft } from './store.js';

const changing = new Set(); // chapters whose plan is being swapped for another
const ownOpen = new Set(); // chapters whose "Write your own" field is showing
// A typed-but-unsaved own plan is a draft in storage, so a reload keeps it.
const ownDraft = (num) => `own-${num}`;

export function resetArtist() {
  changing.clear();
  ownOpen.clear();
}

/** The idea on show: the last one seen. Stable across renders and reloads. */
export function currentIdea(state) {
  const seen = state.seen.ideas;
  for (let i = seen.length - 1; i >= 0; i -= 1) {
    const idea = IDEAS.find((item) => item.id === seen[i]);
    if (idea) return idea;
  }
  return null;
}

/** Makes sure an idea is picked before a card renders. Saves without a render. */
export function ensureIdea() {
  if (currentIdea(app.state)) return;
  const idea = pickNext(IDEAS, app.state.seen.ideas);
  if (idea) commit(markSeen(app.state, 'ideas', idea.id), { render: false });
}

/** The whole section: heading, sub line, card. `primary` inks the main button. */
export function artistSectionHtml(num, { primary = false } = {}) {
  return (
    '<div class="sec-head">' +
    `<h2 class="h-l" id="ad-h">${esc(COPY.artistDate)}</h2>` +
    `<span class="sec-aside">${esc(fill(COPY.weekLabel, { n: num }))}</span></div>` +
    `<p class="sub">${esc(COPY.artistSub)}</p>` +
    cardHtml(num, primary)
  );
}

function cardHtml(num, primary) {
  const state = app.state;
  const status = artistDateState(state, num);
  const chapter = chapterOf(state, num);
  const mode = status === 'planned' && changing.has(num) ? 'changing' : status;
  const main = primary ? 'btn btn-ink' : 'btn';
  let body = '';

  if (mode === 'unplanned' || mode === 'changing') {
    const idea = currentIdea(state);
    // His own plan sits behind a quiet link until he asks for it (or has a draft going).
    const own = ownOpen.has(num) || Boolean(getDraft(ownDraft(num)));
    const links = [];
    if (!own) {
      links.push(
        `<button class="textbtn quiet" type="button" data-action="artist-own-open" data-test="artist-own-open">${esc(COPY.ownPlan)}</button>`,
      );
    }
    if (mode === 'changing') {
      links.push(`<button class="textbtn quiet" type="button" data-action="artist-cancel">${esc(COPY.cancel)}</button>`);
    }
    body =
      (idea
        ? `<p class="idea-meta dots"><span>${esc(COPY.ideaKinds[idea.kind])}</span><span>${esc(COPY.ideaCosts[idea.cost])}</span></p>` +
          `<p class="idea" data-test="artist-idea">${esc(idea.text)}</p>`
        : '') +
      '<div class="pair">' +
      `<button class="btn" type="button" data-action="artist-another" data-test="artist-another">${esc(COPY.another)}</button>` +
      `<button class="${main}" type="button" data-action="artist-plan" data-test="artist-plan">${esc(COPY.planThis)}</button>` +
      '</div>' +
      `<div class="own"${own ? '' : ' hidden'}>` +
      `<label for="own-${num}">${esc(COPY.ownPlan)}</label>` +
      '<div class="own-row">' +
      `<input class="line-input" id="own-${num}" type="text" maxlength="200" autocomplete="off" autocapitalize="sentences"` +
      ` enterkeyhint="done" placeholder="${esc(COPY.planPlaceholder)}" data-field="own-plan" data-test="artist-own-input">` +
      `<button class="btn" type="button" data-action="artist-own-save">${esc(COPY.planSave)}</button>` +
      '</div></div>' +
      (links.length ? `<div class="artist-links">${links.join('')}</div>` : '');
  } else if (mode === 'planned') {
    body =
      `<p class="idea-label">${esc(COPY.artistPlanned)}</p>` +
      `<p class="idea">${esc(planText(chapter))}</p>` +
      '<div class="pair">' +
      `<button class="${main}" type="button" data-action="artist-did" data-test="artist-did">${esc(COPY.didIt)}</button>` +
      `<button class="btn" type="button" data-action="artist-change" data-test="artist-change">${esc(COPY.change)}</button>` +
      '</div>';
  } else {
    const { doneOn } = chapter.artistDate;
    const plan = planText(chapter);
    body =
      `<p class="done-head" id="ad-done-${num}" tabindex="-1"><i class="stroke is-now" aria-hidden="true"></i>${esc(COPY.artistDoneAsk)}</p>` +
      (plan ? `<p class="was">${esc(plan)}</p>` : '') +
      (doneOn
        ? `<p class="was">${esc(fill(COPY.artistDoneOn, { date: longDate(doneOn, app.today) }))}</p>`
        : `<p class="was">${esc(COPY.legacyArtistDate)}</p>`) +
      `<label class="vh" for="note-${num}">${esc(COPY.artistDoneAsk)}</label>` +
      `<textarea class="note" id="note-${num}" rows="3" maxlength="600" autocapitalize="sentences"` +
      ` placeholder="${esc(COPY.artistNotePlaceholder)}" data-field="artist-note" data-test="artist-note"></textarea>` +
      `<button class="textbtn quiet" type="button" data-action="artist-undo">${esc(COPY.artistUndo)}</button>`;
  }

  return `<div class="artist" data-test="artist-card" data-num="${num}" data-state="${mode}">${body}</div>`;
}

/** Puts the saved and drafted text back into the card's fields after a render. */
export function syncArtistFields(root, num) {
  setValue($(`#note-${num}`, root), chapterOf(app.state, num).artistDate.note);
  setValue($(`#own-${num}`, root), getDraft(ownDraft(num)));
}

function planText(chapter) {
  const { plan, ideaId } = chapter.artistDate;
  if (plan) return plan;
  return IDEAS.find((idea) => idea.id === ideaId)?.text ?? '';
}

function cardNum(el) {
  return Number(el.closest('[data-num]')?.dataset.num);
}

function focusTest(test) {
  focus(document.querySelector(`[data-test="${test}"]`));
}

function savePlan(num, text, ideaId) {
  changing.delete(num);
  ownOpen.delete(num);
  setDraft(ownDraft(num), '');
  commit(planArtistDate(app.state, num, text, ideaId));
  focusTest('artist-did');
}

const saveNote = pendingSave((num, text) => {
  commit(setArtistNote(app.state, num, text), { render: false });
}, 450);

export const actions = {
  'artist-another'() {
    const idea = pickNext(IDEAS, app.state.seen.ideas);
    if (idea) commit(markSeen(app.state, 'ideas', idea.id));
  },
  'artist-plan'(el) {
    const idea = currentIdea(app.state);
    if (idea) savePlan(cardNum(el), idea.text, idea.id);
  },
  'artist-own-open'(el) {
    const num = cardNum(el);
    ownOpen.add(num);
    render();
    // Still inside the tap, so iOS brings up the keyboard.
    document.getElementById(`own-${num}`)?.focus();
  },
  'artist-own-save'(el) {
    const num = cardNum(el);
    const input = document.getElementById(`own-${num}`);
    const text = (input?.value ?? '').trim();
    if (!text) {
      focus(input);
      return;
    }
    if (input) input.value = '';
    savePlan(num, text, null);
  },
  'artist-did'(el) {
    const num = cardNum(el);
    commit(markArtistDate(app.state, num, app.today));
    focus(document.getElementById(`ad-done-${num}`));
  },
  'artist-change'(el) {
    changing.add(cardNum(el));
    render();
    focusTest('artist-plan');
  },
  'artist-cancel'(el) {
    const num = cardNum(el);
    changing.delete(num);
    ownOpen.delete(num);
    setDraft(ownDraft(num), '');
    render();
    focusTest('artist-change');
  },
  'artist-undo'(el) {
    saveNote.flush();
    commit(unmarkArtistDate(app.state, cardNum(el)));
    focusTest('artist-did');
  },
};

export const fields = {
  'own-plan': {
    input(el) {
      setDraft(ownDraft(cardNum(el)), el.value);
    },
    enter(el, event) {
      event.preventDefault();
      actions['artist-own-save'](el);
    },
  },
  'artist-note': {
    input(el) {
      saveNote(cardNum(el), el.value);
    },
    blur() {
      saveNote.flush();
    },
  },
};
