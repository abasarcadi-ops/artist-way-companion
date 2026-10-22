// Settings sheet: theme, colour, timer, sounds, backup and restore, start over.

import { ACCENTS, CHAPTER_ACCENTS } from '../accents.js';
import { COPY } from '../content.js';
import { emptyState, exportBackup, importBackup, setSetting } from '../core.js';
import { dayMonth } from './dates.js';
import { esc, fill, focus, patch, reveal, splitAround } from './dom.js';
import { closeSheet, openSheet, sheetHead } from './sheet.js';
import { APP_VERSION, app, commit, nowIso } from './store.js';
import { hideToast, toast } from './toast.js';

let asking = null; // 'restore' | 'start-over' while an in-sheet confirm is up
let pending = null; // { state, migrated, exportedAt } read from a backup file

let afterReset = () => {};
/** app.js passes a callback that clears per-screen UI state after a restore or start over. */
export function onDataReplaced(fn) {
  afterReset = fn;
}

export function openSettings(opener = null) {
  asking = null;
  pending = null;
  openSheet({ name: 'settings', test: 'settings-sheet', opener, render: renderSettings });
}

function pressed(on) {
  return `aria-pressed="${on ? 'true' : 'false'}"`;
}

function renderSettings(body) {
  const { settings } = app.state;
  const pinned = ACCENTS.some((a) => a.key === settings.accent) ? settings.accent : 'chapter';
  const unit = splitAround(COPY.minutesOption)[1].trim();

  const themes = [
    ['system', COPY.themeSystem],
    ['light', COPY.themeLight],
    ['dark', COPY.themeDark],
  ]
    .map(
      ([value, label]) =>
        `<button type="button" data-action="set-theme" data-value="${value}" data-test="set-theme-${value}" ${pressed(settings.theme === value)}>${esc(label)}</button>`,
    )
    .join('');

  const spectrum = Object.keys(CHAPTER_ACCENTS)
    .sort((a, b) => a - b)
    .map((num) => `<i data-accent="${CHAPTER_ACCENTS[num]}"></i>`)
    .join('');
  const swatches = ACCENTS.map(
    (accent) =>
      `<li><button class="sw" type="button" data-accent="${accent.key}" data-action="set-accent" data-value="${accent.key}"` +
      ` data-test="set-accent-${accent.key}" ${pressed(pinned === accent.key)}>` +
      `<span class="chip" aria-hidden="true"></span><span class="nm">${esc(accent.name)}</span></button></li>`,
  ).join('');
  const pinnedNote = pinned !== 'chapter' ? ACCENTS.find((a) => a.key === pinned)?.note : null;

  const minutes = [20, 25, 30]
    .map(
      (m) =>
        `<button type="button" data-action="set-minutes" data-value="${m}" data-test="set-minutes-${m}" ${pressed(settings.minutes === m)}` +
        ` aria-label="${esc(fill(COPY.minutesOption, { n: m }))}">${m}</button>`,
    )
    .join('');

  const html =
    sheetHead(esc(COPY.settingsTitle)) +
    // Theme
    '<section class="set" aria-labelledby="st-theme">' +
    `<h3 class="set-label" id="st-theme">${esc(COPY.themeLabel)}</h3>` +
    `<div class="seg" role="group" aria-labelledby="st-theme">${themes}</div></section>` +
    // Colour
    '<section class="set" aria-labelledby="st-colour">' +
    `<h3 class="set-label" id="st-colour">${esc(COPY.accentLabel)}</h3>` +
    `<button class="follow" type="button" data-action="set-accent" data-value="chapter" data-test="set-accent-chapter" ${pressed(pinned === 'chapter')}>` +
    `<span class="spectrum" aria-hidden="true">${spectrum}</span>` +
    `<span class="follow-text"><b>${esc(COPY.accentFollow)}</b><span>${esc(COPY.accentFollowSub)}</span></span></button>` +
    `<ul class="swatches">${swatches}</ul>` +
    (pinnedNote ? `<p class="sheet-sub">${esc(pinnedNote)}</p>` : '') +
    '</section>' +
    // Timer
    '<section class="set" aria-labelledby="st-timer">' +
    `<h3 class="set-label" id="st-timer">${esc(COPY.timerLabel)}</h3>` +
    `<div class="seg" role="group" aria-labelledby="st-timer">${minutes}<span class="unit" aria-hidden="true">${esc(unit)}</span></div></section>` +
    // Sounds
    '<div class="toggles">' +
    `<button class="toggle-row" type="button" data-action="set-bell" data-test="set-bell" ${pressed(settings.bell)}>` +
    `<span>${esc(COPY.bellLabel)}</span><span class="box" aria-hidden="true"></span></button>` +
    `<button class="toggle-row" type="button" data-action="set-rain" data-test="set-rain" ${pressed(settings.rain)}>` +
    `<span>${esc(COPY.rainLabel)}</span><span class="box" aria-hidden="true"></span></button>` +
    '</div>' +
    // Backup
    '<section class="set backup" aria-labelledby="st-backup">' +
    `<h3 class="set-label" id="st-backup">${esc(COPY.backupTitle)}</h3>` +
    `<p class="sheet-sub">${esc(COPY.backupSub)}</p>` +
    '<div class="pair">' +
    `<button class="btn" type="button" data-action="backup-copy" data-test="backup-copy">${esc(COPY.backupCopy)}</button>` +
    `<button class="btn" type="button" data-action="backup-download" data-test="backup-download">${esc(COPY.backupDownload)}</button>` +
    '</div>' +
    (asking === 'restore'
      ? restoreConfirmHtml()
      : `<label class="btn file-btn">${esc(COPY.backupRestore)}` +
        '<input type="file" accept=".json,application/json,text/plain" data-field="restore" data-test="restore-file"></label>') +
    '</section>' +
    // Start over
    '<section class="start-over">' +
    (asking === 'start-over'
      ? '<div class="confirm" role="group" aria-labelledby="so-q">' +
        `<p id="so-q" tabindex="-1">${esc(COPY.startOverConfirm)}</p>` +
        '<div class="stack">' +
        `<button class="btn btn-ink" type="button" data-action="start-over-yes" data-test="start-over-confirm">${esc(COPY.startOverYes)}</button>` +
        `<button class="btn" type="button" data-action="start-over-no">${esc(COPY.startOverNo)}</button>` +
        '</div></div>'
      : `<button class="textbtn" type="button" data-action="start-over" data-test="start-over">${esc(COPY.startOver)}</button>`) +
    '</section>' +
    `<p class="version">${esc(fill(COPY.version, { version: APP_VERSION }))}</p>`;

  patch(body, html);
}

function restoreConfirmHtml() {
  const question = pending?.exportedAt
    ? fill(COPY.restoreConfirmDated, { date: pending.exportedAt })
    : COPY.restoreConfirm;
  return (
    '<div class="confirm" role="group" aria-labelledby="rs-q">' +
    `<p id="rs-q" tabindex="-1">${esc(question)}</p>` +
    '<div class="stack">' +
    `<button class="btn btn-ink" type="button" data-action="restore-yes" data-test="confirm-yes">${esc(COPY.restoreYes)}</button>` +
    `<button class="btn" type="button" data-action="restore-no" data-test="confirm-no">${esc(COPY.restoreNo)}</button>` +
    '</div></div>'
  );
}

// ---------------------------------------------------------------------------
// Backup

function backupFileName() {
  return `artists-way-backup-${app.today}.json`;
}

async function copyBackup() {
  const text = exportBackup(app.state, nowIso());
  try {
    await navigator.clipboard.writeText(text);
    toast(COPY.backupCopied);
  } catch {
    toast(COPY.backupCopyFailed);
  }
}

async function downloadBackup() {
  const text = exportBackup(app.state, nowIso());
  const name = backupFileName();
  // A home-screen app on iOS can't follow a download link; the share sheet
  // offers Save to Files instead.
  if (navigator.standalone === true && navigator.canShare) {
    try {
      const file = new File([text], name, { type: 'application/json' });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file] });
        toast(COPY.backupDownloaded);
        return;
      }
    } catch (error) {
      if (error?.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast(COPY.backupDownloaded);
}

async function readRestoreFile(input) {
  const file = input.files?.[0];
  if (!file) return;
  let text;
  try {
    text = await file.text();
  } catch {
    input.value = '';
    toast(COPY.restoreErrors.file);
    return;
  }
  input.value = '';
  const result = importBackup(text, app.today, nowIso());
  if (!result.ok) {
    toast(COPY.restoreErrors[result.code] ?? result.error);
    return;
  }
  pending = { state: result.state, migrated: result.migrated, exportedAt: exportedDate(text) };
  asking = 'restore';
  renderAgain();
  revealConfirm('rs-q');
}

// The backup's own date, for "the backup from 20 October 2026".
function exportedDate(text) {
  try {
    const at = JSON.parse(text)?.exportedAt;
    const date = typeof at === 'string' ? new Date(at) : null;
    if (!date || Number.isNaN(date.getTime())) return null;
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    return `${dayMonth(key)} ${date.getFullYear()}`;
  } catch {
    return null;
  }
}

// A confirm needs its buttons in plain sight, so any toast steps aside.
function revealConfirm(id) {
  hideToast();
  const question = document.getElementById(id);
  reveal(question?.closest('.confirm'), question);
}

function renderAgain() {
  const body = document.querySelector('[data-test="settings-sheet"] .sheet-in');
  if (body) renderSettings(body);
}

function replaceState(next) {
  afterReset();
  app.view = 'today';
  app.chapterPage = null;
  commit(next);
}

// ---------------------------------------------------------------------------
// Actions

function setting(key, value) {
  commit(setSetting(app.state, key, value));
}

export const actions = {
  'open-settings'(el) {
    openSettings(el);
  },
  'set-theme'(el) {
    setting('theme', el.dataset.value);
  },
  'set-accent'(el) {
    setting('accent', el.dataset.value);
  },
  'set-minutes'(el) {
    setting('minutes', Number(el.dataset.value));
  },
  'set-bell'() {
    setting('bell', !app.state.settings.bell);
  },
  'set-rain'() {
    setting('rain', !app.state.settings.rain);
  },
  'backup-copy'() {
    copyBackup();
  },
  'backup-download'() {
    downloadBackup();
  },
  'restore-yes'() {
    if (!pending) return;
    const { state, migrated } = pending;
    pending = null;
    asking = null;
    replaceState(state);
    closeSheet({ restoreFocus: false });
    window.scrollTo(0, 0);
    toast(migrated ? COPY.restoreDoneOld : COPY.restoreDone);
  },
  'restore-no'() {
    pending = null;
    asking = null;
    renderAgain();
    focus(document.querySelector('[data-test="restore-file"]'));
    toast(COPY.restoreUnchanged);
  },
  'start-over'() {
    asking = 'start-over';
    renderAgain();
    revealConfirm('so-q');
  },
  'start-over-no'() {
    asking = null;
    renderAgain();
    focus(document.querySelector('[data-test="start-over"]'));
  },
  'start-over-yes'() {
    asking = null;
    // A fresh state goes straight into awc.v2, so the old app's data under
    // its own key is never migrated again. That key stays untouched.
    replaceState(emptyState(app.today, nowIso()));
    closeSheet({ restoreFocus: false });
    window.scrollTo(0, 0);
    toast(COPY.startOverDone);
  },
};

export const fields = {
  restore: {
    change(el) {
      readRestoreFile(el);
    },
  },
};
