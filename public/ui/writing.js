// The writing screen: a full-screen timer for the pages on paper.
//
// The timer is wall-clock based (core timer helpers): it stores when it ends,
// not how many ticks are left, so a phone that sleeps still ends on time.
// It's also saved under awc.timer, so a killed home-screen app comes back to
// the running timer. While it runs the screen is kept awake. At the end a
// synthesised bell rings, once, if the app is open.

import { COPY, STARTERS } from '../content.js';
import {
  TIMER_MINUTES,
  markSeen,
  pagesOn,
  pickNext,
  setSetting,
  timerLeft,
  timerPause,
  timerResume,
  timerStart,
} from '../core.js';
import { longDate } from './dates.js';
import { $, $$, esc, fill, focus, splitAround } from './dom.js';
import { slotsHtml, statusHtml, syncSlots } from './slots.js';
import { audioRunning, rainPlaying, ringBell, startRain, stopRain, unlockAudio } from './sound.js';
import { TIMER_KEY, app, applyLayers, commit, readStorage, removeStorage, render, writeStorage } from './store.js';

const RING_WINDOW_MS = 60_000; // ring only for an end seen within a minute
const RESTORE_ENDED_MS = 30 * 60_000; // reopen an ended timer this long after
const RESTORE_PAUSED_MS = 3 * 60 * 60_000; // reopen a paused session this long after

let el = null;
let timer = null; // core timer { endsAt, minutes, pausedLeft }, or null when idle
let ticking = null;
let starterId = null;
let rainOn = false;
let wakeLock = null;
let shownPages = null;
let rulerFor = null;
const closedListeners = [];

// ---------------------------------------------------------------------------
// Building and rendering

export function buildWriting(root) {
  el = root;
  const unit = splitAround(COPY.minutesOption)[1].trim();
  const presets = TIMER_MINUTES.map(
    (m) =>
      `<button class="preset" type="button" data-action="timer-preset" data-min="${m}" data-test="timer-preset-${m}"` +
      ` aria-pressed="false" aria-label="${esc(fill(COPY.minutesOption, { n: m }))}">${m}</button>`,
  ).join('');
  el.innerHTML =
    '<div class="writing-in">' +
    `<div class="w-top"><h2 class="lbl" id="w-label">${esc(COPY.morningPages)}</h2><span class="dt" data-w="date"></span></div>` +
    '<div class="clock" role="timer" data-test="timer-digits" data-w="clock">' +
    '<span data-w="mm">25</span><span class="colon">:</span><span data-w="ss">00</span></div>' +
    '<div class="ruler" aria-hidden="true" data-w="ruler"></div>' +
    '<p class="facedown" data-w="line" aria-live="polite"></p>' +
    '<div class="w-controls">' +
    `<div class="presets" role="group" aria-label="${esc(COPY.timerLabel)}">${presets}<span class="unit" aria-hidden="true">${esc(unit)}</span></div>` +
    `<button class="rain" type="button" data-action="rain-toggle" data-test="rain-toggle" aria-pressed="false"><span class="box" aria-hidden="true"></span>${esc(COPY.rainToggle)}</button>` +
    '</div>' +
    '<div class="run">' +
    `<button class="btn-now" type="button" data-action="timer-main" data-test="timer-start" data-w="main">${esc(COPY.timerStart)}</button>` +
    `<button class="btn" type="button" data-action="timer-reset" data-test="timer-reset" data-w="reset" disabled>${esc(COPY.timerReset)}</button>` +
    '</div>' +
    '<div class="starter">' +
    `<p class="q">${esc(COPY.stuckLine)}</p>` +
    '<p class="line" data-test="starter-line" data-w="starter" aria-live="polite"></p>' +
    `<button class="textbtn" type="button" data-action="starter-another" data-test="starter-another">${esc(COPY.anotherLine)}</button>` +
    '</div>' +
    '<div class="w-foot"><div class="w-foot-in">' +
    `<p class="lbl" id="wp-l">${esc(COPY.backfillTitleToday)}</p>` +
    `<div class="w-pages">${slotsHtml('w-', 'wp-l')}<p class="status" aria-live="polite" data-w="status"></p></div>` +
    `<button class="btn btn-ink w-done" type="button" data-action="writing-done" data-test="writing-done">${esc(COPY.writingDone)}</button>` +
    '</div></div>' +
    '</div>';
}

const part = (name) => el.querySelector(`[data-w="${name}"]`);

/** Idle, running, paused or ended. */
export function phase(now = Date.now()) {
  if (!timer) return 'idle';
  if (typeof timer.pausedLeft === 'number') return 'paused';
  return timerLeft(timer, now) > 0 ? 'running' : 'ended';
}

export function timerRunning() {
  return phase() === 'running';
}

function minutesShown() {
  return timer ? timer.minutes : app.state.settings.minutes;
}

export function renderWriting({ interactive = false } = {}) {
  if (!el || !app.writingOpen) return;
  const now = Date.now();
  const state = phase(now);
  const { settings } = app.state;

  part('date').textContent = longDate(app.today);
  renderClock(now);

  const line = part('line');
  line.textContent =
    state === 'ended' ? COPY.timerEnded
      : state === 'paused' ? COPY.timerPaused
        : settings.bell ? COPY.writingLine : COPY.writingLineNoBell;
  line.classList.toggle('rang', state === 'ended');

  const main = part('main');
  main.textContent = state === 'running' ? COPY.timerPause : state === 'paused' ? COPY.timerResume : COPY.timerStart;
  main.dataset.test = state === 'running' ? 'timer-pause' : 'timer-start';
  part('reset').disabled = state === 'idle';

  // A session under way (running or paused) keeps its length: Reset first to change it.
  const underway = state === 'running' || state === 'paused';
  for (const preset of $$('.preset', el)) {
    preset.setAttribute('aria-pressed', String(Number(preset.dataset.min) === minutesShown()));
    preset.disabled = underway;
  }
  $('[data-test="rain-toggle"]', el).setAttribute('aria-pressed', String(rainOn));
  part('starter').textContent = STARTERS.find((s) => s.id === starterId)?.text ?? '';

  const n = pagesOn(app.state, app.today);
  const prev = interactive ? shownPages : null;
  syncSlots($('.slots', el), n, prev);
  const status = statusHtml(n, { today: app.today, hint: COPY.writingPagesHint, arrive: prev !== null && prev < 3 });
  if (part('status').__html !== status) {
    part('status').innerHTML = status;
    part('status').__html = status;
  }
  shownPages = n;
}

function renderClock(now = Date.now()) {
  const minutes = minutesShown();
  const total = minutes * 60_000;
  const left = timer ? timerLeft(timer, now) : total;
  const secs = Math.ceil(left / 1000);
  const mm = Math.floor(secs / 60);
  const ss = secs % 60;
  part('mm').textContent = String(mm).padStart(2, '0');
  part('ss').textContent = String(ss).padStart(2, '0');
  part('clock').setAttribute('aria-label', fill(COPY.timerLeft, { time: `${mm}:${String(ss).padStart(2, '0')}` }));

  const ruler = part('ruler');
  if (rulerFor !== minutes) {
    let html = '';
    for (let g = 0; g < Math.ceil(minutes / 5); g += 1) {
      html += '<span class="grp">';
      for (let i = 0; i < 5 && g * 5 + i < minutes; i += 1) html += '<span class="tick"><i></i></span>';
      html += '</span>';
    }
    ruler.className = `ruler n${minutes}`;
    ruler.innerHTML = html;
    rulerFor = minutes;
  }
  const elapsed = total - left;
  const full = Math.floor(elapsed / 60_000);
  const fraction = (elapsed % 60_000) / 60_000;
  $$('.tick i', ruler).forEach((tick, i) => {
    tick.style.setProperty('--f', i < full ? 1 : i === full ? fraction : 0);
  });
}

// ---------------------------------------------------------------------------
// Opening and closing

export function openWriting({ fromTap = false, byKeyboard = false } = {}) {
  if (!el || app.writingOpen) return;
  app.writingOpen = true;
  applyLayers();
  el.setAttribute('aria-hidden', 'false');
  pickStarter();
  if (fromTap) unlockAudio();
  if (app.state.settings.rain && phase() !== 'ended') {
    rainOn = true;
    if (fromTap) startRain();
  }
  if (!fromTap) armFirstTap();
  shownPages = null;
  renderWriting();
  // Opened from the keyboard, focus goes to Start. A finger tap or a restored
  // session focuses the screen itself, so iOS draws no focus ring on a button
  // nobody aimed at.
  setTimeout(() => focus(byKeyboard ? part('main') : el), 60);
}

/** Done: the session ends. Timer, rain and the wake lock all stop. */
export function closeWriting() {
  if (!app.writingOpen) return;
  disarmFirstTap();
  stopTicking();
  releaseWakeLock();
  stopRain(0.8);
  rainOn = false;
  timer = null;
  saveTimer();
  app.writingOpen = false;
  applyLayers();
  el.setAttribute('aria-hidden', 'true');
  window.scrollTo(0, 0);
  render();
  const start = document.querySelector('[data-test="start-writing"]');
  focus(start && !start.hidden ? start : document.querySelector('[data-test="page-slot-1"]'));
  for (const fn of closedListeners) fn();
}

export function onWritingClosed(fn) {
  closedListeners.push(fn);
}

// A restored session has had no tap yet, and iOS only lets audio start from
// one (a click or the end of a touch, not its start). Every tap tries until
// the audio context really runs, so the bell can ring at the end.
const TAP_EVENTS = ['click', 'pointerup'];
let armed = null;

function armFirstTap() {
  if (armed) return;
  armed = () => {
    const audio = unlockAudio();
    if (rainOn && !rainPlaying()) startRain();
    if (phase() === 'running') requestWakeLock();
    if (audioRunning()) disarmFirstTap();
    else audio?.resume?.().then(() => audioRunning() && disarmFirstTap(), () => {});
  };
  for (const type of TAP_EVENTS) document.addEventListener(type, armed, true);
}

function disarmFirstTap() {
  if (!armed) return;
  for (const type of TAP_EVENTS) document.removeEventListener(type, armed, true);
  armed = null;
}

// ---------------------------------------------------------------------------
// The timer

function startTicking() {
  stopTicking();
  ticking = setInterval(tick, 250);
}

function stopTicking() {
  clearInterval(ticking);
  ticking = null;
}

function tick() {
  if (phase() === 'ended') finish();
  else if (app.writingOpen) renderClock();
}

function finish() {
  stopTicking();
  releaseWakeLock();
  const late = timer ? Date.now() - timer.endsAt : Infinity;
  if (app.state.settings.bell && late < RING_WINDOW_MS) ringBell();
  if (rainOn) {
    stopRain(4);
    rainOn = false;
  }
  saveTimer();
  renderWriting();
}

function saveTimer() {
  if (timer) writeStorage(TIMER_KEY, JSON.stringify({ ...timer, savedAt: Date.now() }));
  else removeStorage(TIMER_KEY);
}

/** Brings back a session from awc.timer after the app was closed or killed. */
export function restoreTimer() {
  const saved = readTimer(readStorage(TIMER_KEY));
  if (!saved) {
    removeStorage(TIMER_KEY);
    return;
  }
  timer = saved.timer;
  const now = Date.now();
  const state = phase(now);
  const keep =
    state === 'running' ||
    (state === 'ended' && now - timer.endsAt < RESTORE_ENDED_MS) ||
    (state === 'paused' && now - saved.savedAt < RESTORE_PAUSED_MS);
  if (!keep) {
    timer = null;
    saveTimer();
    return;
  }
  openWriting();
  if (state === 'running') {
    startTicking();
    requestWakeLock();
  }
}

function readTimer(raw) {
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || !TIMER_MINUTES.includes(data.minutes)) return null;
    const full = data.minutes * 60_000;
    const running = Number.isFinite(data.endsAt) && data.pausedLeft === null;
    const paused = data.endsAt === null && Number.isFinite(data.pausedLeft) && data.pausedLeft > 0 && data.pausedLeft <= full;
    if (!running && !paused) return null;
    // An end further off than the timer's length means the clock moved back.
    if (running && data.endsAt - Date.now() > full + 5_000) return null;
    return {
      timer: { endsAt: running ? data.endsAt : null, minutes: data.minutes, pausedLeft: paused ? data.pausedLeft : null },
      savedAt: Number.isFinite(data.savedAt) ? data.savedAt : 0,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Keeping the screen on

async function requestWakeLock() {
  if (wakeLock || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  try {
    const lock = await navigator.wakeLock.request('screen');
    if (phase() !== 'running') {
      lock.release().catch(() => {});
      return;
    }
    wakeLock = lock;
    lock.addEventListener('release', () => {
      if (wakeLock === lock) wakeLock = null;
    });
  } catch {
    wakeLock = null;
  }
}

function releaseWakeLock() {
  const lock = wakeLock;
  wakeLock = null;
  if (lock) lock.release().catch(() => {});
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !ticking) return;
  tick();
  if (phase() === 'running') requestWakeLock();
});

// ---------------------------------------------------------------------------
// Starter lines

function pickStarter() {
  const starter = pickNext(STARTERS, app.state.seen.starters);
  if (!starter) return;
  starterId = starter.id;
  commit(markSeen(app.state, 'starters', starter.id), { render: false });
}

// ---------------------------------------------------------------------------
// Actions

export const actions = {
  'open-writing'(el, event) {
    // A click the keyboard made has detail 0.
    openWriting({ fromTap: true, byKeyboard: event?.detail === 0 });
  },
  'writing-done'() {
    closeWriting();
  },
  'timer-main'() {
    const now = Date.now();
    const state = phase(now);
    if (state === 'running') {
      timer = timerPause(timer, now);
      stopTicking();
      releaseWakeLock();
    } else {
      unlockAudio();
      if (rainOn && !rainPlaying()) startRain();
      timer = state === 'paused' ? timerResume(timer, now) : timerStart(minutesShown(), now);
      startTicking();
      requestWakeLock();
    }
    saveTimer();
    renderWriting();
  },
  'timer-reset'() {
    timer = null;
    stopTicking();
    releaseWakeLock();
    saveTimer();
    renderWriting();
  },
  'timer-preset'(button) {
    const state = phase();
    if (state === 'running' || state === 'paused') return;
    timer = null;
    saveTimer();
    commit(setSetting(app.state, 'minutes', Number(button.dataset.min)));
    renderWriting();
  },
  'rain-toggle'() {
    rainOn = !rainOn;
    if (rainOn) startRain();
    else stopRain(0.6);
    renderWriting();
  },
  'starter-another'() {
    pickStarter();
    renderWriting();
  },
};
