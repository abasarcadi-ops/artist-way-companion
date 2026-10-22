/**
 * core.js · Artist's Way Companion v2
 *
 * All of the app's logic as pure functions. No DOM, no storage, no clock:
 * the caller passes `today` (a "YYYY-MM-DD" key in device local time),
 * `nowIso` and `nowMs` in. Same input, same answer, in any time zone.
 *
 * Conventions
 * - Functions that change state never mutate their input. They return a new
 *   state, or the very same object when nothing changed, so `next === state`
 *   means there is nothing to save.
 * - Future dates are refused quietly: the state comes back unchanged.
 * - A malformed date key, chapter number, page slot or deck kind is a bug in
 *   the caller and throws a RangeError.
 * - load() and importBackup() read outside data and never throw.
 * - Stored text is never cut on load. Length limits apply when text is set.
 */

// ---------------------------------------------------------------------------
// Constants

export const STORAGE_KEY = 'awc.v2';
export const V1_STORAGE_KEY = 'artists_way_tracker_v1';
/** Where a stored awc.v2 this version can't read is kept, instead of being overwritten. */
export const UNREAD_KEY = 'awc.v2.unread';
const UNREAD_SLOTS = 20;
export const APP_ID = 'artists-way-companion';
export const DATA_VERSION = 2;
export const CHAPTER_COUNT = 12;

/** Text limits in characters (code points), plus the length of each seen list. */
export const LIMITS = Object.freeze({ keep: 280, plan: 200, note: 600, answer: 600, seen: 20 });

export const THEMES = Object.freeze(['system', 'light', 'dark']);
export const TIMER_MINUTES = Object.freeze([20, 25, 30]);
export const DEFAULT_SETTINGS = Object.freeze({ theme: 'system', minutes: 25, bell: true, rain: false, accent: 'chapter' });

const DECK_KINDS = Object.freeze(['starters', 'ideas']);
const READY_TO_MOVE_DAY = 7;
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
const KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
// settings.accent: "chapter" (follow the current chapter) or a pinned accent key.
// Any well-formed key is kept; the UI falls back to the chapter colour for a key it doesn't know.
const ACCENT_PATTERN = /^[a-z][a-z0-9-]{0,23}$/;
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

// ---------------------------------------------------------------------------
// Dates
//
// A date key names a calendar day in device local time. Only dateKey() and
// parseKey() look at local time. Everything else is calendar arithmetic on
// the key itself, done in UTC where no day is ever 23 or 25 hours long, so a
// DST change or the device's offset can't shift the result.

/** True for a real calendar day written as "YYYY-MM-DD". */
export function isDateKey(value) {
  if (typeof value !== 'string') return false;
  const match = KEY_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

/** "YYYY-MM-DD" for the local calendar day of a Date or ms timestamp. Never toISOString (that is UTC). */
export function dateKey(date) {
  const d = typeof date === 'number' ? new Date(date) : date;
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) {
    throw new RangeError(`Not a valid date: ${describe(date)}`);
  }
  return formatKey(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/** The Date at local noon of a key's day. Noon is never skipped or repeated by a DST change. */
export function parseKey(key) {
  assertKey(key);
  const [year, month, day] = keyParts(key);
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (year < 100) date.setFullYear(year); // the constructor reads 0..99 as 1900..1999
  return date;
}

/** The key `n` calendar days after `key` (n may be negative). */
export function addDays(key, n) {
  assertKey(key);
  if (!Number.isInteger(n)) throw new RangeError(`Not a whole number of days: ${describe(n)}`);
  return keyFromDayNumber(dayNumber(key) + n);
}

/** Whole calendar days from a to b. Positive when b is later. */
export function daysBetween(a, b) {
  assertKey(a);
  assertKey(b);
  return dayNumber(b) - dayNumber(a);
}

/** The 7 keys, Monday to Sunday, of the week that contains `key`. */
export function weekOf(key) {
  assertKey(key);
  const n = dayNumber(key);
  const sinceMonday = (((n + 3) % 7) + 7) % 7; // day 0, 1970-01-01, was a Thursday
  return Array.from({ length: 7 }, (_, i) => keyFromDayNumber(n - sinceMonday + i));
}

/** "YYYY-MM" for a key. */
export function monthOf(key) {
  assertKey(key);
  return key.slice(0, 7);
}

function daysInMonth(year, month) {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function keyParts(key) {
  return [Number(key.slice(0, 4)), Number(key.slice(5, 7)), Number(key.slice(8, 10))];
}

function formatKey(year, month, day) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Days since 1970-01-01 for a key, counted in UTC.
function dayNumber(key) {
  const [year, month, day] = keyParts(key);
  const t = new Date(0);
  t.setUTCFullYear(year, month - 1, day);
  return Math.round(t.getTime() / DAY_MS);
}

function keyFromDayNumber(n) {
  const t = new Date(n * DAY_MS);
  return formatKey(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

function assertKey(key) {
  if (!isDateKey(key)) throw new RangeError(`Not a date key: ${describe(key)}`);
}

function describe(value) {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

// ---------------------------------------------------------------------------
// State

/**
 * A fresh v2 state: chapter 1, not started yet (the Today screen offers to
 * start it). `today` is accepted for symmetry and not needed.
 */
export function emptyState(_today, nowIso) {
  return {
    version: DATA_VERSION,
    createdAt: isIsoString(nowIso) ? nowIso : null,
    course: { chapter: 1 },
    chapters: {},
    days: {},
    settings: { ...DEFAULT_SETTINGS },
    seen: { starters: [], ideas: [] },
    legacyV1: null,
  };
}

/**
 * Builds the working state from what localStorage holds.
 * Raws are JSON strings (or already parsed objects) or null. A readable v2
 * state wins; otherwise a readable v1 state is migrated; otherwise a fresh
 * start. Never throws.
 *
 * Returns { state, migrated, needsPickUp, source } where needsPickUp means
 * the current chapter has no start date (fresh start or after migration) and
 * source is "v2", "v1" or "empty".
 */
export function load(options) {
  const { v2Raw, v1Raw, today, nowIso } = readLoadOptions(options);
  try {
    const v2 = parseJson(v2Raw);
    if (isV2State(v2)) return loaded(normalizeState(v2, nowIso), false, 'v2');
    // An unreadable v2 falls through to v1: old data beats no data.
    const v1 = parseJson(v1Raw);
    if (isV1State(v1)) return loaded(migrateV1(v1, today, nowIso), true, 'v1');
  } catch {
    // Anything unexpected in stored data means a fresh start, never a crash.
  }
  return loaded(emptyState(today, nowIso), false, 'empty');
}

/**
 * Turns a v1 state into v2.
 * v1 ticks have no dates, so no pages are invented on real days: each touched
 * week becomes a chapter with `legacy` counts, and the course lands on the
 * highest week with a tick or artist date (the next one when that week was
 * complete), not started yet so the UI can offer the pick-up step.
 * The raw v1 object is kept in `legacyV1`. v1's theme, open weeks and quote
 * index are UI state and are not carried over.
 */
export function migrateV1(v1, _today, nowIso) {
  const state = emptyState(null, nowIso);
  const weeks = isRecord(v1) && isObjectLike(v1.weeks) ? v1.weeks : {};
  let suggested = 1;

  for (let num = 1; num <= CHAPTER_COUNT; num += 1) {
    const week = readV1Week(weeks[String(num)]);
    const ticked = week.mornings > 0 || week.artistDate;
    if (ticked || week.note) {
      const chapter = newChapter();
      chapter.artistDate.note = week.note;
      chapter.legacy = { mornings: week.mornings, artistDate: week.artistDate };
      state.chapters[String(num)] = chapter;
    }
    if (ticked) {
      const complete = week.mornings === 7 && week.artistDate;
      suggested = complete ? Math.min(CHAPTER_COUNT, num + 1) : num;
    }
  }

  state.course.chapter = suggested;
  state.legacyV1 = isRecord(v1) ? cloneJson(v1) : null;
  return state;
}

/** The state as a JSON string for localStorage. */
export function serialize(state) {
  return JSON.stringify(state);
}

/**
 * The start-up guard, decided before anything is written. When awc.v2 holds
 * text that load() could not read as a v2 state (a newer data version, or
 * damage), that text is copied aside first, never overwritten.
 *
 * `source` is what load() returned it from. `stored(key)` gives what storage
 * holds under a key, or null. Returns { copyTo, blocked }:
 *   copyTo   "awc.v2.unread", or ".2", ".3" and so on when an earlier copy
 *            with different text sits there already; null when there is
 *            nothing to keep
 *   blocked  every slot holds other text: write nothing to awc.v2 at all
 */
export function unreadGuard(v2Raw, source, stored) {
  const none = { copyTo: null, blocked: false };
  if (source === 'v2' || typeof v2Raw !== 'string' || v2Raw.trim() === '') return none;
  for (let slot = 1; slot <= UNREAD_SLOTS; slot += 1) {
    const key = slot === 1 ? UNREAD_KEY : `${UNREAD_KEY}.${slot}`;
    const there = stored(key);
    if (there === null || there === undefined || there === v2Raw) return { copyTo: key, blocked: false };
  }
  return { copyTo: null, blocked: true };
}

/**
 * The state another tab just saved under awc.v2, normalized, or null when
 * the text can't be read as a v2 state. Null means leave it alone: it may
 * come from a newer version of the app. Never throws.
 */
export function loadSaved(raw, nowIso) {
  if (typeof raw !== 'string') return null;
  const result = load({ v2Raw: raw, v1Raw: null, today: null, nowIso });
  return result.source === 'v2' ? result.state : null;
}

function newChapter() {
  return {
    startedOn: null,
    finishedOn: null,
    read: false,
    artistDate: { plan: '', ideaId: null, doneOn: null, note: '' },
    checkin: { doneOn: null, lineUp: '', matters: '' },
    legacy: null,
  };
}

function readLoadOptions(options) {
  try {
    const { v2Raw = null, v1Raw = null, today = null, nowIso = null } = options ?? {};
    return { v2Raw, v1Raw, today, nowIso };
  } catch {
    return { v2Raw: null, v1Raw: null, today: null, nowIso: null };
  }
}

function loaded(state, migrated, source) {
  const current = storedChapter(state, state.course.chapter);
  return { state, migrated, needsPickUp: !current?.startedOn, source };
}

function parseJson(raw) {
  if (typeof raw !== 'string') return raw ?? undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function isV2State(value) {
  return isRecord(value) && value.version === DATA_VERSION;
}

function isV1State(value) {
  return isRecord(value) && isObjectLike(value.weeks);
}

// A v1 week, read the way v1 meant it. A days array of the wrong length
// still counts the `true` ticks among its first 7 entries.
function readV1Week(week) {
  if (!isRecord(week)) return { mornings: 0, artistDate: false, note: '' };
  const days = Array.isArray(week.days) ? week.days.slice(0, 7) : [];
  return {
    mornings: days.filter((tick) => tick === true).length,
    artistDate: week.artistDate === true,
    note: typeof week.artistDateNote === 'string' ? week.artistDateNote.trim() : '',
  };
}

// Rebuilds a stored v2 state field by field. Unknown fields are dropped,
// wrong types fall back to defaults, numbers are clamped, invalid date keys
// are dropped. Text is kept as stored.
function normalizeState(raw, nowIso) {
  const state = emptyState(null, nowIso);
  if (isIsoString(raw.createdAt)) state.createdAt = raw.createdAt;
  state.course.chapter = toChapterNumber(isRecord(raw.course) ? raw.course.chapter : null) ?? 1;

  if (isRecord(raw.chapters)) {
    for (const [key, value] of Object.entries(raw.chapters)) {
      const num = toChapterNumber(key);
      if (num === null || String(num) !== key || !isRecord(value)) continue;
      state.chapters[key] = normalizeChapter(value);
    }
  }

  if (isRecord(raw.days)) {
    for (const [key, value] of Object.entries(raw.days)) {
      const day = isDateKey(key) ? normalizeDay(value) : null;
      if (day) state.days[key] = day;
    }
  }

  const settings = isRecord(raw.settings) ? raw.settings : {};
  state.settings = {
    theme: THEMES.includes(settings.theme) ? settings.theme : DEFAULT_SETTINGS.theme,
    minutes: TIMER_MINUTES.includes(settings.minutes) ? settings.minutes : DEFAULT_SETTINGS.minutes,
    bell: typeof settings.bell === 'boolean' ? settings.bell : DEFAULT_SETTINGS.bell,
    rain: typeof settings.rain === 'boolean' ? settings.rain : DEFAULT_SETTINGS.rain,
    accent: isAccentSetting(settings.accent) ? settings.accent : DEFAULT_SETTINGS.accent,
  };

  const seen = isRecord(raw.seen) ? raw.seen : {};
  for (const kind of DECK_KINDS) {
    state.seen[kind] = Array.isArray(seen[kind]) ? recentUnique(seen[kind].filter(isDeckId), LIMITS.seen) : [];
  }

  state.legacyV1 = isRecord(raw.legacyV1) ? cloneJson(raw.legacyV1) : null;
  return state;
}

function normalizeChapter(raw) {
  const artistDate = isRecord(raw.artistDate) ? raw.artistDate : {};
  const checkin = isRecord(raw.checkin) ? raw.checkin : {};
  return {
    startedOn: keyOrNull(raw.startedOn),
    finishedOn: keyOrNull(raw.finishedOn),
    read: raw.read === true,
    artistDate: {
      plan: textOrEmpty(artistDate.plan),
      ideaId: isDeckId(artistDate.ideaId) ? artistDate.ideaId : null,
      doneOn: keyOrNull(artistDate.doneOn),
      note: textOrEmpty(artistDate.note),
    },
    checkin: {
      doneOn: keyOrNull(checkin.doneOn),
      lineUp: textOrEmpty(checkin.lineUp),
      matters: textOrEmpty(checkin.matters),
    },
    legacy: isRecord(raw.legacy)
      ? { mornings: clampInt(toNumber(raw.legacy.mornings), 0, 7), artistDate: raw.legacy.artistDate === true }
      : null,
  };
}

// A day with no pages and no keep line holds nothing, so it isn't stored.
function normalizeDay(raw) {
  if (!isRecord(raw)) return null;
  const day = { pages: clampInt(toNumber(raw.pages), 0, 3), keep: textOrEmpty(raw.keep) };
  return day.pages === 0 && day.keep === '' ? null : day;
}

// ---------------------------------------------------------------------------
// Pages

/** Pages written on a day, 0 to 3. */
export function pagesOn(state, key) {
  assertKey(key);
  return state.days[key]?.pages ?? 0;
}

/**
 * Taps page slot 1..3 for a day. Tapping a filled slot clears it and the ones
 * above it (pages = slot - 1); tapping an empty slot fills up to it.
 * Future days are refused.
 */
export function tapPage(state, key, slot, today) {
  assertKey(key);
  assertKey(today);
  if (!Number.isInteger(slot) || slot < 1 || slot > 3) {
    throw new RangeError(`Page slot must be 1, 2 or 3: ${describe(slot)}`);
  }
  if (key > today) return state;
  return setPages(state, key, pagesOn(state, key) >= slot ? slot - 1 : slot, today);
}

/** Sets a day's pages, clamped to 0..3. Future days are refused. Setting 0 keeps any keep line. */
export function setPages(state, key, n, today) {
  assertKey(key);
  assertKey(today);
  if (typeof n !== 'number' || Number.isNaN(n)) throw new RangeError(`Pages must be a number: ${describe(n)}`);
  if (key > today) return state;
  const pages = clampInt(n, 0, 3);
  return editDay(state, key, (day) => {
    day.pages = pages;
  });
}

/** Sets the one line worth keeping for a day: trimmed, at most 280 characters. Empty clears it. */
export function setKeep(state, key, text) {
  assertKey(key);
  const keep = clipText(text, LIMITS.keep);
  return editDay(state, key, (day) => {
    day.keep = keep;
  });
}

/** The latest day before `key` with pages, or null. */
export function lastPagesBefore(state, key) {
  assertKey(key);
  let latest = null;
  for (const [day, entry] of Object.entries(state.days)) {
    if (entry.pages > 0 && day < key && (latest === null || day > latest)) latest = day;
  }
  return latest;
}

/**
 * The coming-back line. Null when today already has pages or the last pages
 * were under 3 days ago. Otherwise { gapDays, lastKey, bucket } with bucket
 * "days" (3 to 6), "week" (7 to 20), "weeks" (21+) or "never" (no pages on
 * any date before today; gapDays and lastKey are then null).
 */
export function reentry(state, today) {
  assertKey(today);
  if (pagesOn(state, today) > 0) return null;
  const lastKey = lastPagesBefore(state, today);
  if (lastKey === null) return { gapDays: null, lastKey: null, bucket: 'never' };
  const gapDays = daysBetween(lastKey, today);
  if (gapDays < 3) return null;
  const bucket = gapDays <= 6 ? 'days' : gapDays <= 20 ? 'week' : 'weeks';
  return { gapDays, lastKey, bucket };
}

/** Total pages in today's calendar month. */
export function monthPages(state, today) {
  const prefix = `${monthOf(today)}-`;
  let total = 0;
  for (const [key, day] of Object.entries(state.days)) {
    if (key.startsWith(prefix)) total += day.pages;
  }
  return total;
}

/** This week, Monday to Sunday: [{ key, pages, isToday, isFuture }]. */
export function weekRow(state, today) {
  return weekOf(today).map((key) => ({
    key,
    pages: pagesOn(state, key),
    isToday: key === today,
    isFuture: key > today,
  }));
}

/** Every keep line, newest first: [{ key, text }]. */
export function keptLines(state) {
  return Object.entries(state.days)
    .filter(([, day]) => day.keep.trim() !== '')
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([key, day]) => ({ key, text: day.keep }));
}

// ---------------------------------------------------------------------------
// Chapters

/** A copy of chapter `num`, with defaults if it hasn't been touched. Handy for rendering. */
export function chapterOf(state, num) {
  assertChapter(num);
  const stored = storedChapter(state, num);
  return stored ? structuredClone(stored) : newChapter();
}

/**
 * The current chapter: { num, startedOn, dayOfChapter, readyToMove, finishedOn }.
 * dayOfChapter counts the start day as day 1 (null if not started, never
 * below 1 even if the clock moved back). readyToMove from day 7, and never
 * for a chapter already finished (only the last one stays current after that).
 */
export function chapterInfo(state, today) {
  assertKey(today);
  const num = state.course.chapter;
  const chapter = storedChapter(state, num) ?? newChapter();
  const dayOfChapter = chapter.startedOn ? Math.max(1, daysBetween(chapter.startedOn, today) + 1) : null;
  return {
    num,
    startedOn: chapter.startedOn,
    dayOfChapter,
    readyToMove: dayOfChapter !== null && dayOfChapter >= READY_TO_MOVE_DAY && !chapter.finishedOn,
    finishedOn: chapter.finishedOn,
  };
}

/**
 * Makes `num` the current chapter, started today. Starting a chapter again
 * only moves its start date (and clears finishedOn); its artist date, read
 * tick, notes and check-in stay.
 */
export function startChapter(state, num, today) {
  assertChapter(num);
  assertKey(today);
  return editChapter(state, num, (chapter, draft) => {
    chapter.startedOn = today;
    chapter.finishedOn = null;
    draft.course.chapter = num;
  });
}

/**
 * Closes the current chapter with its check-in (answers trimmed, optional)
 * and starts the next one today. After chapter 12 the course stays on 12,
 * marked finished.
 */
export function finishChapter(state, today, answers) {
  assertKey(today);
  const { lineUp = '', matters = '' } = isRecord(answers) ? answers : {};
  const num = state.course.chapter;
  const finished = editChapter(state, num, (chapter) => {
    chapter.checkin = {
      doneOn: today,
      lineUp: clipText(lineUp, LIMITS.answer),
      matters: clipText(matters, LIMITS.answer),
    };
    chapter.finishedOn = today;
  });
  return num < CHAPTER_COUNT ? startChapter(finished, num + 1, today) : finished;
}

/**
 * { mornings, pages, artistDateDone } for a chapter.
 * Mornings are days with pages during the chapter's run, plus v1 mornings.
 * The run goes from startedOn to finishedOn, or to today while the chapter
 * is current. A chapter left unfinished (another one was started from the
 * Book) stops counting on the day that next chapter started.
 */
export function chapterStats(state, num, today) {
  assertChapter(num);
  assertKey(today);
  const chapter = storedChapter(state, num) ?? newChapter();
  let mornings = 0;
  let pages = 0;
  if (chapter.startedOn) {
    const end = runEnd(state, num, chapter, today);
    for (const [key, day] of Object.entries(state.days)) {
      if (day.pages > 0 && key >= chapter.startedOn && key <= end) {
        mornings += 1;
        pages += day.pages;
      }
    }
  }
  if (chapter.legacy) mornings += chapter.legacy.mornings;
  return { mornings, pages, artistDateDone: isArtistDateDone(chapter) };
}

/** Ticks or unticks "read the chapter in the book". */
export function setRead(state, num, read) {
  return editChapter(state, num, (chapter) => {
    chapter.read = Boolean(read);
  });
}

/**
 * "current", "done" or "upcoming". Done means finished through the check-in,
 * or an earlier chapter than the current one that has anything in it (v1
 * weeks land here). `today` is accepted for symmetry and not needed.
 */
export function chapterStatus(state, num, _today) {
  assertChapter(num);
  const current = state.course.chapter;
  const chapter = storedChapter(state, num);
  if (chapter?.finishedOn) return 'done';
  if (num === current) return 'current';
  if (num < current && isTouched(chapter)) return 'done';
  return 'upcoming';
}

function storedChapter(state, num) {
  return state.chapters[String(num)] ?? null;
}

function assertChapter(num) {
  if (!Number.isInteger(num) || num < 1 || num > CHAPTER_COUNT) {
    throw new RangeError(`Chapter must be a whole number from 1 to ${CHAPTER_COUNT}: ${describe(num)}`);
  }
}

function runEnd(state, num, chapter, today) {
  if (chapter.finishedOn) return chapter.finishedOn;
  if (num === state.course.chapter) return today;
  let end = today;
  for (const [key, other] of Object.entries(state.chapters)) {
    const next = other.startedOn;
    if (key !== String(num) && next && next >= chapter.startedOn && next < end) end = next;
  }
  return end;
}

function isTouched(chapter) {
  if (!chapter) return false;
  const { artistDate, checkin } = chapter;
  return Boolean(
    chapter.startedOn ||
      chapter.finishedOn ||
      chapter.read ||
      chapter.legacy ||
      artistDate.plan ||
      artistDate.ideaId !== null ||
      artistDate.doneOn ||
      artistDate.note.trim() ||
      checkin.doneOn ||
      checkin.lineUp ||
      checkin.matters,
  );
}

// ---------------------------------------------------------------------------
// Artist date (one per chapter)
//
// A v1 week's artist date (legacy.artistDate) counts as done without a date.
// Unmarking or planning a new one clears it like it clears doneOn.

/** Plans the chapter's artist date: plan trimmed to 200 characters, optional deck idea id. Clears done. */
export function planArtistDate(state, num, plan, ideaId = null) {
  const text = clipText(plan, LIMITS.plan);
  return editChapter(state, num, (chapter) => {
    chapter.artistDate.plan = text;
    chapter.artistDate.ideaId = isDeckId(ideaId) ? ideaId : null;
    chapter.artistDate.doneOn = null;
    if (chapter.legacy) chapter.legacy.artistDate = false;
  });
}

/** Removes the plan and idea. A done artist date stays done. */
export function clearArtistPlan(state, num) {
  return editChapter(state, num, (chapter) => {
    chapter.artistDate.plan = '';
    chapter.artistDate.ideaId = null;
  });
}

/**
 * Marks the artist date done today. Normally there is a plan by now; without
 * one it is still marked done (it happened) and the plan stays empty.
 */
export function markArtistDate(state, num, today) {
  assertKey(today);
  return editChapter(state, num, (chapter) => {
    chapter.artistDate.doneOn = today;
  });
}

/** Takes the done mark back off. */
export function unmarkArtistDate(state, num) {
  return editChapter(state, num, (chapter) => {
    chapter.artistDate.doneOn = null;
    if (chapter.legacy) chapter.legacy.artistDate = false;
  });
}

/**
 * Sets the note about the artist date, at most 600 characters. Not trimmed,
 * so saving on every keystroke doesn't eat the space just typed.
 */
export function setArtistNote(state, num, text) {
  const note = capText(text, LIMITS.note);
  return editChapter(state, num, (chapter) => {
    chapter.artistDate.note = note;
  });
}

/** "unplanned", "planned" or "done". */
export function artistDateState(state, num) {
  assertChapter(num);
  const chapter = storedChapter(state, num) ?? newChapter();
  if (isArtistDateDone(chapter)) return 'done';
  if (chapter.artistDate.plan || chapter.artistDate.ideaId !== null) return 'planned';
  return 'unplanned';
}

function isArtistDateDone(chapter) {
  return Boolean(chapter.artistDate.doneOn || chapter.legacy?.artistDate);
}

// ---------------------------------------------------------------------------
// Decks (starter lines and artist date ideas)

/**
 * Picks a deck item whose id is not among the last min(20, deck.length - 1)
 * seen ids. Items are objects with an `id` (bare strings work too).
 * Deterministic for a given `rand`. Null for an empty deck.
 */
export function pickNext(deck, seenIds, rand = Math.random) {
  if (!Array.isArray(deck) || deck.length === 0) return null;
  const windowSize = Math.min(LIMITS.seen, deck.length - 1);
  const seen = Array.isArray(seenIds) ? seenIds : [];
  const recent = new Set(windowSize > 0 ? seen.slice(-windowSize) : []);
  let pool = deck.filter((item) => !recent.has(idOf(item)));
  if (pool.length === 0) pool = deck; // only possible when the deck repeats an id
  const r = Number(rand());
  const index = Math.floor((Number.isFinite(r) ? r : 0) * pool.length);
  return pool[Math.min(pool.length - 1, Math.max(0, index))];
}

/** Records that an id was shown. kind is "starters" or "ideas"; keeps the 20 most recent distinct ids. */
export function markSeen(state, kind, id) {
  if (!DECK_KINDS.includes(kind)) throw new RangeError(`Deck kind must be "starters" or "ideas": ${describe(kind)}`);
  if (!isDeckId(id)) throw new RangeError(`Not a deck id: ${describe(id)}`);
  return change(state, (draft) => {
    draft.seen[kind] = recentUnique([...draft.seen[kind], id], LIMITS.seen);
  });
}

function idOf(item) {
  return item !== null && typeof item === 'object' ? item.id : item;
}

function isDeckId(value) {
  return (typeof value === 'string' && value !== '') || Number.isFinite(value);
}

// The newest `cap` distinct ids, oldest first. A repeated id counts at its latest position.
function recentUnique(ids, cap) {
  const out = [];
  for (let i = ids.length - 1; i >= 0 && out.length < cap; i -= 1) {
    if (!out.includes(ids[i])) out.push(ids[i]);
  }
  return out.reverse();
}

// ---------------------------------------------------------------------------
// Settings and backup

const SETTING_CHECKS = Object.freeze({
  theme: (value) => THEMES.includes(value),
  minutes: (value) => TIMER_MINUTES.includes(value),
  bell: (value) => typeof value === 'boolean',
  rain: (value) => typeof value === 'boolean',
  accent: isAccentSetting,
});

function isAccentSetting(value) {
  return typeof value === 'string' && ACCENT_PATTERN.test(value);
}

/**
 * Sets one setting. Unknown keys and invalid values are refused (state unchanged).
 * theme: system | light | dark. minutes: 20 | 25 | 30. bell, rain: booleans.
 * accent: "chapter" or a lowercase accent key like "ultramarine".
 */
export function setSetting(state, key, value) {
  if (!Object.hasOwn(SETTING_CHECKS, key) || !SETTING_CHECKS[key](value)) return state;
  return change(state, (draft) => {
    draft.settings[key] = value;
  });
}

/** The backup file's text: { app, version, exportedAt, state } as readable JSON. */
export function exportBackup(state, nowIso) {
  const backup = {
    app: APP_ID,
    version: DATA_VERSION,
    exportedAt: isIsoString(nowIso) ? nowIso : null,
    state,
  };
  return JSON.stringify(backup, null, 2);
}

const IMPORT_ERRORS = Object.freeze({
  empty: 'That file is empty.',
  unreadable: "That file couldn't be read. Choose a backup file saved from this app.",
  unknown: "That file isn't a backup from this app.",
  wrongApp: 'That backup is from a different app.',
  newer: 'That backup comes from a newer version of this app. Update the app and try again.',
  damaged: 'That backup is incomplete, so nothing was restored.',
});

/**
 * Reads a backup file's text. Accepts this app's backup, a bare v2 state, or
 * a v1 export (the old app saved its raw state). Never throws.
 * Returns { ok, state, error, code, migrated }: on failure state is null,
 * error is a plain sentence and code one of empty, unreadable, unknown,
 * wrongApp, newer, damaged.
 */
export function importBackup(text, today, nowIso) {
  try {
    if (typeof text !== 'string') return importFailure('unreadable');
    if (text.trim() === '') return importFailure('empty');

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return importFailure('unreadable');
    }
    if (!isRecord(data)) return importFailure('unknown');

    if ('app' in data) {
      if (data.app !== APP_ID) return importFailure('wrongApp');
      if (isNewerVersion(data.version) || isNewerVersion(data.state?.version)) return importFailure('newer');
      if (!isV2State(data.state)) return importFailure('damaged');
      return importSuccess(normalizeState(data.state, nowIso), false);
    }

    if (isNewerVersion(data.version)) return importFailure('newer');
    if (isV2State(data)) return importSuccess(normalizeState(data, nowIso), false);
    if (isV1State(data)) return importSuccess(migrateV1(data, today, nowIso), true);
    return importFailure('unknown');
  } catch {
    return importFailure('unknown');
  }
}

function isNewerVersion(version) {
  return typeof version === 'number' && version > DATA_VERSION;
}

function importSuccess(state, migrated) {
  return { ok: true, state, error: null, code: null, migrated };
}

function importFailure(code) {
  return { ok: false, state: null, error: IMPORT_ERRORS[code], code, migrated: false };
}

// ---------------------------------------------------------------------------
// Timer (pure helpers; the UI owns the interval)
//
// Wall-clock based: the UI passes Date.now(), so a phone that sleeps through
// the session still ends on time. A timer is { endsAt, minutes, pausedLeft }:
// running means endsAt is set and pausedLeft is null; paused is the reverse.

/** A running timer. Minutes that aren't a positive number fall back to the default 25. */
export function timerStart(minutes, nowMs) {
  assertMs(nowMs);
  const length = Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_SETTINGS.minutes;
  return { endsAt: nowMs + length * MINUTE_MS, minutes: length, pausedLeft: null };
}

/** Milliseconds left, never negative and never more than the timer's length (the clock may be set back). */
export function timerLeft(timer, nowMs) {
  assertMs(nowMs);
  if (!timer) return 0;
  const left = isPaused(timer) ? timer.pausedLeft : timer.endsAt - nowMs;
  if (!Number.isFinite(left)) return 0;
  const full = timer.minutes * MINUTE_MS;
  return Math.max(0, Number.isFinite(full) ? Math.min(full, left) : left);
}

/** Freezes the time left. Pausing a paused timer changes nothing. */
export function timerPause(timer, nowMs) {
  assertMs(nowMs);
  if (!timer || isPaused(timer)) return timer;
  return { ...timer, endsAt: null, pausedLeft: timerLeft(timer, nowMs) };
}

/** Runs on from the frozen time left. Resuming a running timer changes nothing. */
export function timerResume(timer, nowMs) {
  assertMs(nowMs);
  if (!timer || !isPaused(timer)) return timer;
  return { ...timer, endsAt: nowMs + timer.pausedLeft, pausedLeft: null };
}

function isPaused(timer) {
  return typeof timer.pausedLeft === 'number';
}

function assertMs(nowMs) {
  if (!Number.isFinite(nowMs)) throw new RangeError(`Not a time in milliseconds: ${describe(nowMs)}`);
}

// ---------------------------------------------------------------------------
// Copy-on-write helpers

// Runs `edit` on a deep copy of the state. Hands back the original object
// when the edit changed nothing.
function change(state, edit) {
  const draft = structuredClone(state);
  edit(draft);
  return JSON.stringify(draft) === JSON.stringify(state) ? state : draft;
}

// Edits one chapter, creating it on first touch. A chapter that would still
// be blank isn't stored: `chapters` only holds chapters that were touched.
function editChapter(state, num, edit) {
  assertChapter(num);
  const key = String(num);
  return change(state, (draft) => {
    const existed = Object.hasOwn(draft.chapters, key);
    const chapter = existed ? draft.chapters[key] : newChapter();
    edit(chapter, draft);
    if (existed || JSON.stringify(chapter) !== JSON.stringify(newChapter())) draft.chapters[key] = chapter;
  });
}

// Edits one day. A day left with no pages and no keep line is removed.
function editDay(state, key, edit) {
  return change(state, (draft) => {
    const day = draft.days[key] ?? { pages: 0, keep: '' };
    edit(day);
    if (day.pages === 0 && day.keep === '') delete draft.days[key];
    else draft.days[key] = day;
  });
}

// ---------------------------------------------------------------------------
// Small value helpers

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isObjectLike(value) {
  return value !== null && typeof value === 'object';
}

function isIsoString(value) {
  return typeof value === 'string' && ISO_PATTERN.test(value) && !Number.isNaN(Date.parse(value));
}

function keyOrNull(value) {
  return isDateKey(value) ? value : null;
}

function textOrEmpty(value) {
  return typeof value === 'string' ? value : '';
}

function toNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return Number.NaN;
}

function toChapterNumber(value) {
  const n = toNumber(value);
  return Number.isInteger(n) && n >= 1 && n <= CHAPTER_COUNT ? n : null;
}

function clampInt(n, min, max) {
  if (Number.isNaN(n)) return min;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

// Trimmed, then cut to `max` code points so an emoji is never split in half.
function clipText(value, max) {
  return capText(textFrom(value).trim(), max).trimEnd();
}

function capText(value, max) {
  const text = textFrom(value);
  const chars = Array.from(text);
  return chars.length <= max ? text : chars.slice(0, max).join('');
}

function textFrom(value) {
  return value === null || value === undefined ? '' : String(value);
}

function cloneJson(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}
