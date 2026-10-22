// Unit tests for public/core.js.
//
//   node --test test/core.test.mjs
//
// Every test is written to pass in any time zone. On top of that, the last
// block re-runs this whole file in child processes with TZ set to
// Europe/Amsterdam, America/Los_Angeles and Pacific/Auckland, so one run
// covers all three.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  APP_ID,
  LIMITS,
  STORAGE_KEY,
  UNREAD_KEY,
  V1_STORAGE_KEY,
  addDays,
  artistDateState,
  chapterInfo,
  chapterOf,
  chapterStats,
  chapterStatus,
  clearArtistPlan,
  dateKey,
  daysBetween,
  emptyState,
  exportBackup,
  finishChapter,
  importBackup,
  isDateKey,
  keptLines,
  lastPagesBefore,
  load,
  loadSaved,
  markArtistDate,
  markSeen,
  migrateV1,
  monthOf,
  monthPages,
  pagesOn,
  parseKey,
  pickNext,
  planArtistDate,
  reentry,
  serialize,
  setArtistNote,
  setKeep,
  setPages,
  setRead,
  setSetting,
  startChapter,
  tapPage,
  timerLeft,
  timerPause,
  timerResume,
  timerStart,
  unmarkArtistDate,
  unreadGuard,
  weekOf,
  weekRow,
} from '../public/core.js';

const THIS_FILE = fileURLToPath(import.meta.url);
const CORE_FILE = fileURLToPath(new URL('../public/core.js', import.meta.url));

const TODAY = '2026-10-22'; // a Thursday
const NOW = '2026-10-22T06:40:00.000Z';
const FAR_FUTURE = '2099-12-31';

// The zones the whole suite is re-run in, with their 2026 DST days.
const ZONES = {
  'Europe/Amsterdam': { longDay: '2026-10-25', shortDay: '2026-03-29', utcTrap: [[2026, 9, 22, 0, 30], '2026-10-21'] },
  'America/Los_Angeles': { longDay: '2026-11-01', shortDay: '2026-03-08', utcTrap: [[2026, 9, 22, 23, 30], '2026-10-23'] },
  'Pacific/Auckland': { longDay: '2026-04-05', shortDay: '2026-09-27', utcTrap: [[2026, 9, 22, 0, 30], '2026-10-21'] },
};
// More zones for the round-trip check: odd offsets, 30-minute DST, the date line.
const EXTRA_ZONES = [
  'UTC',
  'Asia/Kolkata',
  'Asia/Kathmandu',
  'America/St_Johns',
  'Australia/Lord_Howe',
  'Pacific/Chatham',
  'Pacific/Kiritimati',
  'Pacific/Pago_Pago',
];

// ---------------------------------------------------------------------------
// Helpers

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

// Inputs are frozen, so any function that writes to its input throws.
const fresh = () => deepFreeze(emptyState(TODAY, NOW));

// A state with pages on the given days, e.g. withPages({ '2026-10-20': 2 }).
function withPages(pagesByDay, base = emptyState(TODAY, NOW)) {
  let state = base;
  for (const [key, n] of Object.entries(pagesByDay)) state = setPages(state, key, n, FAR_FUTURE);
  return deepFreeze(state);
}

const BLANK_CHAPTER = deepFreeze({
  startedOn: null,
  finishedOn: null,
  read: false,
  artistDate: { plan: '', ideaId: null, doneOn: null, note: '' },
  checkin: { doneOn: null, lineUp: '', matters: '' },
  legacy: null,
});

// A v1 week the way the old app stored it.
function v1Week({ ticks = 0, artistDate = false, note = '' } = {}) {
  return { days: Array.from({ length: 7 }, (_, i) => i < ticks), artistDate, artistDateNote: note };
}

// A v1 state the way the old app saved it after its first load: all 12 weeks present.
function v1State(weeks = {}) {
  const state = { weeks: {}, openWeeks: [1], quoteIndex: 4, theme: 'dark' };
  for (let n = 1; n <= 12; n += 1) state.weeks[n] = weeks[n] ?? v1Week();
  return state;
}

// Small seeded PRNG so random tests are repeatable.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function withTimeZone(zone, fn) {
  const before = process.env.TZ;
  process.env.TZ = zone;
  try {
    fn();
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
}

function localMidnight(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

function hoursInDay(key) {
  return (localMidnight(addDays(key, 1)) - localMidnight(key)) / 3_600_000;
}

// A state that uses every part of the data shape, built through the API.
function richState() {
  let s = migrateV1(
    v1State({ 1: v1Week({ ticks: 7, artistDate: true, note: 'Plant nursery' }), 2: v1Week({ ticks: 3 }) }),
    TODAY,
    NOW,
  );
  s = startChapter(s, 2, '2026-09-01');
  s = setPages(s, '2026-09-01', 3, TODAY);
  s = setKeep(s, '2026-09-01', 'The first page was the hardest.');
  s = setRead(s, 2, true);
  s = planArtistDate(s, 2, 'Walk along the canal', 'canal-walk');
  s = markArtistDate(s, 2, '2026-09-05');
  s = setArtistNote(s, 2, 'Saw herons.');
  s = finishChapter(s, '2026-09-08', { lineUp: 'Short pages count', matters: 'Mornings' });
  s = setPages(s, '2026-09-09', 2, TODAY);
  s = setPages(s, '2026-10-21', 1, TODAY);
  s = setKeep(s, '2026-10-20', 'A line on a day with no pages.');
  s = setSetting(s, 'theme', 'dark');
  s = setSetting(s, 'minutes', 30);
  s = setSetting(s, 'rain', true);
  s = setSetting(s, 'accent', 'cobalt');
  s = markSeen(s, 'starters', 's-03');
  s = markSeen(s, 'ideas', 'canal-walk');
  return deepFreeze(s);
}

// Everything a state coming out of load() or importBackup() must satisfy.
function assertValidState(state) {
  assert.deepEqual(Object.keys(state).sort(), [
    'chapters',
    'course',
    'createdAt',
    'days',
    'legacyV1',
    'seen',
    'settings',
    'version',
  ]);
  assert.equal(state.version, 2);
  assert.ok(state.createdAt === null || typeof state.createdAt === 'string');
  assert.ok(Number.isInteger(state.course.chapter) && state.course.chapter >= 1 && state.course.chapter <= 12);
  assert.equal(Object.getPrototypeOf(state.chapters), Object.prototype);
  assert.equal(Object.getPrototypeOf(state.days), Object.prototype);
  for (const [key, ch] of Object.entries(state.chapters)) {
    assert.match(key, /^(?:[1-9]|1[0-2])$/);
    assert.deepEqual(Object.keys(ch).sort(), ['artistDate', 'checkin', 'finishedOn', 'legacy', 'read', 'startedOn']);
    for (const k of [ch.startedOn, ch.finishedOn, ch.artistDate.doneOn, ch.checkin.doneOn]) {
      assert.ok(k === null || isDateKey(k), `bad date in chapter ${key}`);
    }
    assert.equal(typeof ch.read, 'boolean');
    for (const text of [ch.artistDate.plan, ch.artistDate.note, ch.checkin.lineUp, ch.checkin.matters]) {
      assert.equal(typeof text, 'string');
    }
    const id = ch.artistDate.ideaId;
    assert.ok(id === null || (typeof id === 'string' && id !== '') || Number.isFinite(id));
    if (ch.legacy !== null) {
      assert.ok(Number.isInteger(ch.legacy.mornings) && ch.legacy.mornings >= 0 && ch.legacy.mornings <= 7);
      assert.equal(typeof ch.legacy.artistDate, 'boolean');
    }
  }
  for (const [key, day] of Object.entries(state.days)) {
    assert.ok(isDateKey(key), `bad day key ${key}`);
    assert.ok(Number.isInteger(day.pages) && day.pages >= 0 && day.pages <= 3);
    assert.equal(typeof day.keep, 'string');
    assert.ok(day.pages > 0 || day.keep !== '', 'empty days are not stored');
  }
  assert.ok(['system', 'light', 'dark'].includes(state.settings.theme));
  assert.ok([20, 25, 30].includes(state.settings.minutes));
  assert.equal(typeof state.settings.bell, 'boolean');
  assert.equal(typeof state.settings.rain, 'boolean');
  assert.match(state.settings.accent, /^[a-z][a-z0-9-]{0,23}$/);
  assert.deepEqual(Object.keys(state.settings).sort(), ['accent', 'bell', 'minutes', 'rain', 'theme']);
  for (const kind of ['starters', 'ideas']) {
    assert.ok(Array.isArray(state.seen[kind]));
    assert.ok(state.seen[kind].length <= 20);
    assert.equal(new Set(state.seen[kind]).size, state.seen[kind].length);
  }
  assert.ok(state.legacyV1 === null || (typeof state.legacyV1 === 'object' && !Array.isArray(state.legacyV1)));
  // Stored state is plain JSON data.
  assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
}

// Random JSON-ish junk, biased towards the real field names so deep paths get hit.
const JUNK_KEYS = [
  'version', 'createdAt', 'course', 'chapter', 'chapters', 'days', 'settings', 'seen', 'legacyV1',
  'weeks', 'artistDate', 'artistDateNote', 'pages', 'keep', 'startedOn', 'finishedOn', 'read',
  'checkin', 'legacy', 'mornings', 'plan', 'ideaId', 'doneOn', 'note', 'lineUp', 'matters',
  'theme', 'minutes', 'bell', 'rain', 'accent', 'starters', 'ideas', 'app', 'state',
  '1', '3', '12', '13', '0', '2026-10-21', '2026-10-22', '2026-02-30', '__proto__', 'constructor', 'toString',
];
const JUNK_LEAVES = [
  null, true, false, 0, 1, 2, 3, 4, 7, 12, 13, -1, 2.5, Number.POSITIVE_INFINITY, '', ' ', 'x', '2',
  '2026-10-22', '2026-02-30', 'system', 'dark', 20, 25, 30, NOW, APP_ID,
];

function junk(rand, depth = 0) {
  const r = rand();
  if (depth >= 4 || r < 0.35) return JUNK_LEAVES[Math.floor(rand() * JUNK_LEAVES.length)];
  if (r < 0.5) return Array.from({ length: Math.floor(rand() * 9) }, () => junk(rand, depth + 1));
  const obj = {};
  const count = Math.floor(rand() * 7);
  for (let i = 0; i < count; i += 1) obj[JUNK_KEYS[Math.floor(rand() * JUNK_KEYS.length)]] = junk(rand, depth + 1);
  return obj;
}

function junkState(rand) {
  const base = junk(rand, 1);
  const obj = base !== null && typeof base === 'object' && !Array.isArray(base) ? base : {};
  const r = rand();
  if (r < 0.4) obj.version = 2;
  else if (r < 0.7) obj.weeks = junk(rand, 1);
  return obj;
}

function junkText(rand) {
  const chars = Array.from('{}[]":,0123456789abcdefnulltrue -\\\n🌿');
  return Array.from({ length: Math.floor(rand() * 40) }, () => chars[Math.floor(rand() * chars.length)]).join('');
}

// ---------------------------------------------------------------------------

test('this run uses the time zone it was given', () => {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  assert.ok(zone);
  if (process.env.TZ) assert.equal(zone, process.env.TZ);
});

test('storage keys', () => {
  assert.equal(STORAGE_KEY, 'awc.v2');
  assert.equal(V1_STORAGE_KEY, 'artists_way_tracker_v1');
});

describe('dates', () => {
  test('dateKey reads the local calendar day on both sides of midnight', () => {
    assert.equal(dateKey(new Date(2026, 9, 22, 0, 0, 0, 0)), '2026-10-22');
    assert.equal(dateKey(new Date(2026, 9, 22, 0, 30)), '2026-10-22');
    assert.equal(dateKey(new Date(2026, 9, 22, 12, 0)), '2026-10-22');
    assert.equal(dateKey(new Date(2026, 9, 22, 23, 59, 59, 999)), '2026-10-22');
    assert.equal(dateKey(new Date(2026, 9, 21, 23, 59, 59, 999)), '2026-10-21');
    assert.equal(dateKey(new Date(2026, 9, 23, 0, 0, 0, 0)), '2026-10-23');
  });

  test('dateKey across month and year ends and on a leap day', () => {
    assert.equal(dateKey(new Date(2026, 9, 31, 23, 30)), '2026-10-31');
    assert.equal(dateKey(new Date(2026, 10, 1, 0, 30)), '2026-11-01');
    assert.equal(dateKey(new Date(2026, 11, 31, 23, 59)), '2026-12-31');
    assert.equal(dateKey(new Date(2027, 0, 1, 0, 1)), '2027-01-01');
    assert.equal(dateKey(new Date(2024, 1, 29, 8)), '2024-02-29');
  });

  test('dateKey takes a timestamp too, and pads month and day', () => {
    assert.equal(dateKey(new Date(2026, 0, 5, 9).getTime()), '2026-01-05');
    assert.equal(dateKey(new Date(2026, 8, 9, 9)), '2026-09-09');
  });

  test('dateKey refuses things that are not dates', () => {
    for (const bad of [new Date(Number.NaN), Number.NaN, '2026-10-22', null, undefined, {}]) {
      assert.throws(() => dateKey(bad), RangeError);
    }
  });

  test('isDateKey accepts real calendar days only', () => {
    for (const good of ['2026-10-22', '2024-02-29', '2000-02-29', '2026-12-31', '2026-01-01', '0001-01-01']) {
      assert.equal(isDateKey(good), true, good);
    }
    const bad = [
      '2026-02-29', '1900-02-29', '2026-02-30', '2026-04-31', '2026-13-01', '2026-00-10', '2026-10-00',
      '2026-10-32', '26-10-22', '2026-1-5', '2026/10/22', ' 2026-10-22', '2026-10-22 ', '2026-10-22T00:00',
      '', null, undefined, 20261022, new Date(2026, 9, 22), ['2026-10-22'],
    ];
    for (const value of bad) assert.equal(isDateKey(value), false, String(value));
  });

  test('parseKey gives local noon of that day', () => {
    const d = parseKey('2026-10-25');
    assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()], [2026, 9, 25, 12, 0]);
    assert.equal(parseKey('0050-06-01').getFullYear(), 50);
    assert.equal(dateKey(parseKey('0050-06-01')), '0050-06-01');
  });

  test('parseKey refuses malformed keys', () => {
    for (const bad of ['2026-02-30', '2026-13-01', '26-10-22', '', null, undefined, 20261022]) {
      assert.throws(() => parseKey(bad), RangeError);
    }
  });

  test('every day from 2024 to 2028 round-trips and steps like the local calendar', () => {
    for (let key = '2024-01-01'; key <= '2028-12-31'; key = addDays(key, 1)) {
      const noon = parseKey(key);
      assert.equal(noon.getHours(), 12, key);
      assert.equal(dateKey(noon), key);
      const nextNoon = new Date(noon.getFullYear(), noon.getMonth(), noon.getDate() + 1, 12);
      assert.equal(addDays(key, 1), dateKey(nextNoon));
    }
  });

  test('addDays across month ends, year ends, leap days and the DST change', () => {
    assert.equal(addDays('2026-10-31', 1), '2026-11-01');
    assert.equal(addDays('2026-11-01', -1), '2026-10-31');
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2027-01-01', -1), '2026-12-31');
    assert.equal(addDays('2024-02-28', 1), '2024-02-29');
    assert.equal(addDays('2026-02-28', 1), '2026-03-01');
    assert.equal(addDays('2026-10-22', 0), '2026-10-22');
    assert.equal(addDays('2026-10-22', 365), '2027-10-22');
    assert.equal(addDays('2024-01-01', 366), '2025-01-01');
    assert.equal(addDays('2026-10-24', 2), '2026-10-26');
    assert.equal(addDays('2026-03-28', 2), '2026-03-30');
  });

  test('addDays wants a whole number of days', () => {
    for (const bad of [1.5, Number.NaN, '1', null, undefined]) {
      assert.throws(() => addDays('2026-10-22', bad), RangeError);
    }
  });

  test('daysBetween counts calendar days across the Amsterdam DST changes', () => {
    // Sunday 25 Oct 2026 has 25 hours in Amsterdam, Sunday 29 Mar 2026 has 23.
    assert.equal(daysBetween('2026-10-24', '2026-10-25'), 1);
    assert.equal(daysBetween('2026-10-25', '2026-10-26'), 1);
    assert.equal(daysBetween('2026-10-24', '2026-10-26'), 2);
    assert.equal(daysBetween('2026-10-19', '2026-11-01'), 13);
    assert.equal(daysBetween('2026-10-01', '2026-11-01'), 31);
    assert.equal(daysBetween('2026-03-28', '2026-03-29'), 1);
    assert.equal(daysBetween('2026-03-29', '2026-03-30'), 1);
    assert.equal(daysBetween('2026-03-28', '2026-03-30'), 2);
    assert.equal(daysBetween('2026-03-01', '2026-04-01'), 31);
  });

  test('daysBetween across the US and New Zealand DST changes', () => {
    assert.equal(daysBetween('2026-03-07', '2026-03-09'), 2); // Los Angeles springs forward on 8 Mar
    assert.equal(daysBetween('2026-10-31', '2026-11-02'), 2); // and falls back on 1 Nov
    assert.equal(daysBetween('2026-04-04', '2026-04-06'), 2); // Auckland falls back on 5 Apr
    assert.equal(daysBetween('2026-09-26', '2026-09-28'), 2); // and springs forward on 27 Sep
  });

  test('daysBetween across month and year ends, and backwards', () => {
    assert.equal(daysBetween('2026-10-31', '2026-11-01'), 1);
    assert.equal(daysBetween('2026-12-31', '2027-01-01'), 1);
    assert.equal(daysBetween('2026-01-01', '2027-01-01'), 365);
    assert.equal(daysBetween('2024-01-01', '2025-01-01'), 366);
    assert.equal(daysBetween('2024-02-28', '2024-03-01'), 2);
    assert.equal(daysBetween('2026-10-22', '2026-10-22'), 0);
    assert.equal(daysBetween('2026-10-26', '2026-10-24'), -2);
    assert.equal(daysBetween('2027-01-01', '2026-12-31'), -1);
  });

  test('daysBetween undoes addDays', () => {
    for (const n of [-400, -31, -7, -1, 0, 1, 6, 7, 30, 59, 365, 1000]) {
      assert.equal(daysBetween('2026-10-22', addDays('2026-10-22', n)), n);
    }
  });

  test('daysBetween refuses malformed keys', () => {
    assert.throws(() => daysBetween('2026-10-22', 'tomorrow'), RangeError);
    assert.throws(() => daysBetween(null, '2026-10-22'), RangeError);
  });

  test('weekOf runs Monday to Sunday over the Amsterdam DST weeks', () => {
    const octoberChange = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'];
    assert.deepEqual(weekOf('2026-10-25'), octoberChange);
    assert.deepEqual(weekOf('2026-10-19'), octoberChange);
    assert.deepEqual(weekOf('2026-10-26'), [
      '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01',
    ]);
    assert.deepEqual(weekOf('2026-03-29'), [
      '2026-03-23', '2026-03-24', '2026-03-25', '2026-03-26', '2026-03-27', '2026-03-28', '2026-03-29',
    ]);
    assert.deepEqual(weekOf('2026-03-30'), [
      '2026-03-30', '2026-03-31', '2026-04-01', '2026-04-02', '2026-04-03', '2026-04-04', '2026-04-05',
    ]);
  });

  test('weekOf across month and year ends and a leap day', () => {
    assert.deepEqual(weekOf('2026-10-31'), [
      '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01',
    ]);
    const yearEnd = ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03'];
    assert.deepEqual(weekOf('2026-12-31'), yearEnd);
    assert.deepEqual(weekOf('2027-01-01'), yearEnd);
    assert.deepEqual(weekOf('2027-01-03'), yearEnd);
    assert.deepEqual(weekOf('2024-02-29'), [
      '2024-02-26', '2024-02-27', '2024-02-28', '2024-02-29', '2024-03-01', '2024-03-02', '2024-03-03',
    ]);
  });

  test('every day of 2026 sits in a 7-day week that starts on a Monday', () => {
    for (let key = '2026-01-01'; key <= '2027-01-31'; key = addDays(key, 1)) {
      const week = weekOf(key);
      assert.equal(week.length, 7);
      assert.ok(week.includes(key));
      assert.equal(parseKey(week[0]).getDay(), 1, `week of ${key} starts on a Monday`);
      for (let i = 1; i < 7; i += 1) assert.equal(daysBetween(week[i - 1], week[i]), 1);
      assert.deepEqual(weekOf(week[6]), week);
    }
  });

  test('monthOf', () => {
    assert.equal(monthOf('2026-10-22'), '2026-10');
    assert.equal(monthOf('2027-01-01'), '2027-01');
    assert.throws(() => monthOf('2026-10'), RangeError);
  });
});

describe('local time in specific zones (TZ switched inside this process)', () => {
  for (const [zone, days] of Object.entries(ZONES)) {
    test(`${zone}: the DST days keep one date key from midnight to midnight`, () => {
      withTimeZone(zone, () => {
        assert.equal(hoursInDay(days.longDay), 25);
        assert.equal(hoursInDay(days.shortDay), 23);
        for (const key of [days.longDay, days.shortDay]) {
          const start = localMidnight(key);
          const end = localMidnight(addDays(key, 1));
          for (let t = start; t < end; t += 15 * 60_000) assert.equal(dateKey(t), key);
          assert.equal(dateKey(end - 1), key);
          assert.equal(dateKey(end), addDays(key, 1));
          assert.equal(dateKey(start - 1), addDays(key, -1));
          assert.equal(parseKey(key).getHours(), 12);
        }
      });
    });

    test(`${zone}: dateKey stays local where toISOString slips a day`, () => {
      withTimeZone(zone, () => {
        const [args, utcDay] = days.utcTrap;
        const date = new Date(...args);
        assert.equal(date.toISOString().slice(0, 10), utcDay); // the trap the spec warns about
        assert.equal(dateKey(date), '2026-10-22');
      });
    });

    test(`${zone}: a chapter's day count runs straight through the DST change`, () => {
      withTimeZone(zone, () => {
        for (const change of [days.longDay, days.shortDay]) {
          const startedOn = addDays(change, -3);
          const [y, m, d] = addDays(change, 3).split('-').map(Number);
          const today = dateKey(new Date(y, m - 1, d, 0, 30)); // just after midnight
          const state = startChapter(fresh(), 2, startedOn);
          assert.deepEqual(chapterInfo(state, today), {
            num: 2,
            startedOn,
            dayOfChapter: 7,
            readyToMove: true,
            finishedOn: null,
          });
          // Every change day here is a Sunday, so it closes its Monday-to-Sunday week.
          assert.equal(parseKey(change).getDay(), 0);
          assert.equal(weekOf(change)[6], change);
          assert.equal(weekOf(addDays(change, 1))[0], addDays(change, 1));
        }
      });
    });
  }

  for (const zone of [...Object.keys(ZONES), ...EXTRA_ZONES]) {
    test(`${zone}: parseKey is noon and round-trips for every day of 2025 to 2027`, () => {
      withTimeZone(zone, () => {
        for (let key = '2025-01-01'; key <= '2027-12-31'; key = addDays(key, 1)) {
          const noon = parseKey(key);
          assert.equal(noon.getHours(), 12, `${zone} ${key}`);
          assert.equal(dateKey(noon), key);
          assert.equal(dateKey(localMidnight(key)), key);
        }
      });
    });
  }
});

describe('emptyState', () => {
  test('is a fresh v2 state on chapter 1, not started', () => {
    assert.deepEqual(emptyState(TODAY, NOW), {
      version: 2,
      createdAt: NOW,
      course: { chapter: 1 },
      chapters: {},
      days: {},
      settings: { theme: 'system', minutes: 25, bell: true, rain: false, accent: 'chapter' },
      seen: { starters: [], ideas: [] },
      legacyV1: null,
    });
    assert.deepEqual(chapterInfo(fresh(), TODAY), {
      num: 1,
      startedOn: null,
      dayOfChapter: null,
      readyToMove: false,
      finishedOn: null,
    });
  });

  test('createdAt is null without a valid ISO time', () => {
    assert.equal(emptyState(TODAY).createdAt, null);
    assert.equal(emptyState(TODAY, 'yesterday').createdAt, null);
    assert.equal(emptyState(TODAY, 1760000000000).createdAt, null);
  });

  test('each call returns its own objects', () => {
    const a = emptyState(TODAY, NOW);
    const b = emptyState(TODAY, NOW);
    assert.notEqual(a, b);
    assert.notEqual(a.settings, b.settings);
    assert.notEqual(a.seen.starters, b.seen.starters);
  });
});

describe('pages', () => {
  test('pagesOn is 0 for a day with nothing', () => {
    assert.equal(pagesOn(fresh(), TODAY), 0);
    assert.equal(pagesOn(withPages({ [TODAY]: 2 }), TODAY), 2);
  });

  test('tapPage: a filled slot clears down to slot - 1, an empty slot fills up to it', () => {
    // Rows: pages before the tap. Columns: what tapping slot 1, 2, 3 leaves.
    const expected = { 0: [1, 2, 3], 1: [0, 2, 3], 2: [0, 1, 3], 3: [0, 1, 2] };
    for (const [start, row] of Object.entries(expected)) {
      const before = withPages({ [TODAY]: Number(start) });
      row.forEach((after, i) => {
        const slot = i + 1;
        assert.equal(pagesOn(tapPage(before, TODAY, slot, TODAY), TODAY), after, `${start} pages, tap slot ${slot}`);
      });
    }
  });

  test('three taps write a full morning, and tapping slot 1 clears it', () => {
    let s = fresh();
    for (const slot of [1, 2, 3]) s = tapPage(s, TODAY, slot, TODAY);
    assert.equal(pagesOn(s, TODAY), 3);
    s = tapPage(s, TODAY, 1, TODAY);
    assert.equal(pagesOn(s, TODAY), 0);
    assert.equal(TODAY in s.days, false);
  });

  test('tapPage refuses future days and leaves the state as it was', () => {
    const s = withPages({ [TODAY]: 1 });
    for (const slot of [1, 2, 3]) {
      assert.equal(tapPage(s, '2026-10-23', slot, TODAY), s);
      assert.equal(tapPage(s, '2027-01-01', slot, TODAY), s);
    }
  });

  test('tapPage backfills past days and works on today', () => {
    assert.equal(pagesOn(tapPage(fresh(), '2026-10-01', 2, TODAY), '2026-10-01'), 2);
    assert.equal(pagesOn(tapPage(fresh(), '2025-12-31', 3, TODAY), '2025-12-31'), 3);
    assert.equal(pagesOn(tapPage(fresh(), TODAY, 1, TODAY), TODAY), 1);
  });

  test('tapPage wants slot 1, 2 or 3 and real date keys', () => {
    for (const slot of [0, 4, 1.5, '1', null, undefined]) {
      assert.throws(() => tapPage(fresh(), TODAY, slot, TODAY), RangeError);
    }
    assert.throws(() => tapPage(fresh(), 'today', 1, TODAY), RangeError);
    assert.throws(() => tapPage(fresh(), TODAY, 1, undefined), RangeError);
  });

  test('setPages clamps to 0..3', () => {
    const cases = [[0, 0], [1, 1], [3, 3], [4, 3], [99, 3], [-1, 0], [2.9, 2],
      [Number.POSITIVE_INFINITY, 3], [Number.NEGATIVE_INFINITY, 0]];
    for (const [n, expected] of cases) {
      assert.equal(pagesOn(setPages(fresh(), TODAY, n, TODAY), TODAY), expected, `n = ${n}`);
    }
  });

  test('setPages refuses future days', () => {
    const s = fresh();
    assert.equal(setPages(s, '2026-10-23', 2, TODAY), s);
    assert.equal(setPages(s, '2027-01-01', 1, TODAY), s);
  });

  test('setPages wants a number', () => {
    for (const bad of ['2', null, undefined, Number.NaN, true]) {
      assert.throws(() => setPages(fresh(), TODAY, bad, TODAY), RangeError);
    }
  });

  test('setting 0 keeps the keep line', () => {
    let s = setKeep(withPages({ [TODAY]: 3 }), TODAY, 'A line.');
    s = setPages(s, TODAY, 0, TODAY);
    assert.deepEqual(s.days[TODAY], { pages: 0, keep: 'A line.' });
    assert.deepEqual(keptLines(s), [{ key: TODAY, text: 'A line.' }]);
  });

  test('setting 0 on a day without a keep line removes the day', () => {
    const s = setPages(withPages({ [TODAY]: 2 }), TODAY, 0, TODAY);
    assert.deepEqual(s.days, {});
  });

  test('setting the same pages again returns the same state', () => {
    const s = withPages({ [TODAY]: 2 });
    assert.equal(setPages(s, TODAY, 2, TODAY), s);
    assert.equal(setPages(fresh(), TODAY, 0, TODAY).days[TODAY], undefined);
  });

  test('setKeep trims and leaves the pages alone', () => {
    const s = setKeep(withPages({ [TODAY]: 2 }), TODAY, '   Keep this one.  ');
    assert.deepEqual(s.days[TODAY], { pages: 2, keep: 'Keep this one.' });
  });

  test('setKeep stops at 280 characters without splitting an emoji', () => {
    assert.equal(setKeep(fresh(), TODAY, 'x'.repeat(300)).days[TODAY].keep.length, 280);
    assert.equal(setKeep(fresh(), TODAY, '🌿'.repeat(300)).days[TODAY].keep, '🌿'.repeat(280));
    assert.equal(setKeep(fresh(), TODAY, `${'a'.repeat(279)} b`).days[TODAY].keep, 'a'.repeat(279));
    assert.equal(setKeep(fresh(), TODAY, 'y'.repeat(280)).days[TODAY].keep, 'y'.repeat(280));
  });

  test('an empty keep line on a day without pages removes the day', () => {
    const s = setKeep(fresh(), TODAY, 'something');
    assert.deepEqual(s.days[TODAY], { pages: 0, keep: 'something' });
    assert.equal(TODAY in setKeep(s, TODAY, '   ').days, false);
    assert.equal(TODAY in setKeep(s, TODAY, null).days, false);
  });

  test('setKeep with the same text returns the same state', () => {
    const s = deepFreeze(setKeep(fresh(), TODAY, 'same'));
    assert.equal(setKeep(s, TODAY, '  same '), s);
  });

  test('lastPagesBefore finds the latest earlier day with pages', () => {
    let s = withPages({ '2026-10-01': 2, '2026-10-15': 1, '2026-10-22': 3, '2026-10-25': 1 });
    s = setKeep(s, '2026-10-18', 'a keep line is not pages');
    assert.equal(lastPagesBefore(s, '2026-10-22'), '2026-10-15');
    assert.equal(lastPagesBefore(s, '2026-10-16'), '2026-10-15');
    assert.equal(lastPagesBefore(s, '2026-10-15'), '2026-10-01');
    assert.equal(lastPagesBefore(s, '2026-10-01'), null);
    assert.equal(lastPagesBefore(s, '2026-10-30'), '2026-10-25');
    assert.equal(lastPagesBefore(fresh(), TODAY), null);
  });

  describe('reentry', () => {
    const lastPagesDaysAgo = (gap) => withPages({ [addDays(TODAY, -gap)]: 1 });

    test('null for a gap of 1 or 2 days', () => {
      assert.equal(reentry(lastPagesDaysAgo(1), TODAY), null);
      assert.equal(reentry(lastPagesDaysAgo(2), TODAY), null);
    });

    test('buckets at their edges', () => {
      const cases = [
        [3, 'days', '2026-10-19'],
        [6, 'days', '2026-10-16'],
        [7, 'week', '2026-10-15'],
        [20, 'week', '2026-10-02'],
        [21, 'weeks', '2026-10-01'],
        [400, 'weeks', '2025-09-17'],
      ];
      for (const [gap, bucket, lastKey] of cases) {
        assert.deepEqual(reentry(lastPagesDaysAgo(gap), TODAY), { gapDays: gap, lastKey, bucket }, `gap ${gap}`);
      }
    });

    test('"never" when there are no pages on any earlier date', () => {
      assert.deepEqual(reentry(fresh(), TODAY), { gapDays: null, lastKey: null, bucket: 'never' });
      assert.deepEqual(reentry(withPages({ '2026-10-25': 2 }), TODAY), { gapDays: null, lastKey: null, bucket: 'never' });
    });

    test('null once today has pages, however long the gap was', () => {
      assert.equal(reentry(withPages({ '2026-01-01': 2, [TODAY]: 1 }), TODAY), null);
      assert.equal(reentry(withPages({ [TODAY]: 1 }), TODAY), null);
    });

    test('keep lines alone are not pages', () => {
      assert.equal(reentry(setKeep(fresh(), '2026-10-21', 'only a line'), TODAY).bucket, 'never');
      const s = setKeep(lastPagesDaysAgo(30), '2026-10-21', 'only a line');
      assert.deepEqual(reentry(s, TODAY), { gapDays: 30, lastKey: '2026-09-22', bucket: 'weeks' });
      assert.equal(reentry(setKeep(fresh(), TODAY, 'a line today'), TODAY).bucket, 'never');
    });

    test('counts calendar days over the DST change and a year end', () => {
      assert.deepEqual(reentry(withPages({ '2026-10-23': 1 }), '2026-10-26'), {
        gapDays: 3, lastKey: '2026-10-23', bucket: 'days',
      });
      assert.deepEqual(reentry(withPages({ '2026-03-27': 1 }), '2026-03-30'), {
        gapDays: 3, lastKey: '2026-03-27', bucket: 'days',
      });
      assert.equal(reentry(withPages({ '2026-12-30': 1 }), '2027-01-01'), null);
      assert.equal(reentry(withPages({ '2026-12-26': 1 }), '2027-01-02').bucket, 'week');
    });
  });

  test('monthPages totals the pages of today\'s calendar month', () => {
    const s = withPages({
      '2026-09-30': 3, '2026-10-01': 2, '2026-10-22': 1, '2026-10-31': 3,
      '2026-11-01': 2, '2026-12-31': 1, '2027-01-01': 2,
    });
    assert.equal(monthPages(s, '2026-10-22'), 6);
    assert.equal(monthPages(s, '2026-10-01'), 6);
    assert.equal(monthPages(s, '2026-10-31'), 6);
    assert.equal(monthPages(s, '2026-11-15'), 2);
    assert.equal(monthPages(s, '2026-09-01'), 3);
    assert.equal(monthPages(s, '2026-12-31'), 1);
    assert.equal(monthPages(s, '2027-01-01'), 2);
    assert.equal(monthPages(s, '2027-10-22'), 0);
    assert.equal(monthPages(fresh(), TODAY), 0);
  });

  test('weekRow lays out this week with today and the future marked', () => {
    const s = withPages({ '2026-10-18': 3, '2026-10-19': 1, '2026-10-21': 3, '2026-10-22': 2, '2026-10-26': 1 });
    assert.deepEqual(weekRow(s, TODAY), [
      { key: '2026-10-19', pages: 1, isToday: false, isFuture: false },
      { key: '2026-10-20', pages: 0, isToday: false, isFuture: false },
      { key: '2026-10-21', pages: 3, isToday: false, isFuture: false },
      { key: '2026-10-22', pages: 2, isToday: true, isFuture: false },
      { key: '2026-10-23', pages: 0, isToday: false, isFuture: true },
      { key: '2026-10-24', pages: 0, isToday: false, isFuture: true },
      { key: '2026-10-25', pages: 0, isToday: false, isFuture: true },
    ]);
  });

  test('weekRow on a Sunday has no future days, on a Monday six', () => {
    const s = withPages({ '2026-10-26': 1 });
    const sunday = weekRow(s, '2026-10-25');
    assert.equal(sunday.filter((d) => d.isFuture).length, 0);
    assert.equal(sunday[6].isToday, true);
    const monday = weekRow(s, '2026-10-26');
    assert.deepEqual(monday[0], { key: '2026-10-26', pages: 1, isToday: true, isFuture: false });
    assert.equal(monday.filter((d) => d.isFuture).length, 6);
    assert.equal(monday.filter((d) => d.isToday).length, 1);
  });

  test('weekRow across a year end', () => {
    assert.deepEqual(weekRow(fresh(), '2027-01-01').map((d) => [d.key, d.isFuture]), [
      ['2026-12-28', false], ['2026-12-29', false], ['2026-12-30', false], ['2026-12-31', false],
      ['2027-01-01', false], ['2027-01-02', true], ['2027-01-03', true],
    ]);
  });

  test('keptLines lists every keep line, newest first', () => {
    let s = withPages({ '2026-10-01': 1, '2026-10-05': 2 });
    s = setKeep(s, '2026-10-01', 'Oldest');
    s = setKeep(s, '2026-10-22', 'Newest, on a day with no pages');
    s = setKeep(s, '2026-10-05', 'Middle');
    assert.deepEqual(keptLines(s), [
      { key: '2026-10-22', text: 'Newest, on a day with no pages' },
      { key: '2026-10-05', text: 'Middle' },
      { key: '2026-10-01', text: 'Oldest' },
    ]);
    assert.deepEqual(keptLines(fresh()), []);
  });

  test('keptLines skips blank lines that came in from stored data', () => {
    const v2Raw = JSON.stringify({
      version: 2,
      days: { '2026-10-02': { pages: 1, keep: '   ' }, '2026-10-03': { pages: 1, keep: 'Real' } },
    });
    assert.deepEqual(keptLines(load({ v2Raw, today: TODAY, nowIso: NOW }).state), [{ key: '2026-10-03', text: 'Real' }]);
  });
});

describe('chapters', () => {
  test('chapterOf gives defaults for an untouched chapter, and a copy otherwise', () => {
    assert.deepEqual(chapterOf(fresh(), 5), BLANK_CHAPTER);
    const s = startChapter(fresh(), 5, TODAY);
    const copy = chapterOf(s, 5);
    copy.read = true;
    assert.equal(s.chapters['5'].read, false);
    assert.throws(() => chapterOf(s, 13), RangeError);
  });

  test('chapterInfo before the chapter is started', () => {
    assert.deepEqual(chapterInfo(fresh(), TODAY), {
      num: 1, startedOn: null, dayOfChapter: null, readyToMove: false, finishedOn: null,
    });
  });

  test('dayOfChapter counts the start day as day 1, readyToMove from day 7', () => {
    const s = startChapter(fresh(), 4, '2026-10-19');
    const cases = [
      ['2026-10-19', 1, false],
      ['2026-10-24', 6, false],
      ['2026-10-25', 7, true],
      ['2026-10-26', 8, true],
      ['2026-11-30', 43, true],
    ];
    for (const [today, day, ready] of cases) {
      assert.deepEqual(chapterInfo(s, today), {
        num: 4, startedOn: '2026-10-19', dayOfChapter: day, readyToMove: ready, finishedOn: null,
      }, today);
    }
  });

  test('dayOfChapter across the DST changes and a year end', () => {
    assert.equal(chapterInfo(startChapter(fresh(), 1, '2026-10-20'), '2026-10-26').dayOfChapter, 7);
    assert.equal(chapterInfo(startChapter(fresh(), 1, '2026-03-24'), '2026-03-30').dayOfChapter, 7);
    assert.equal(chapterInfo(startChapter(fresh(), 1, '2026-12-28'), '2027-01-03').dayOfChapter, 7);
  });

  test('dayOfChapter never drops below 1 if the clock moved back', () => {
    assert.equal(chapterInfo(startChapter(fresh(), 1, '2026-10-25'), TODAY).dayOfChapter, 1);
  });

  test('startChapter makes the chapter current and starts it today', () => {
    const s = startChapter(fresh(), 4, TODAY);
    assert.equal(s.course.chapter, 4);
    assert.deepEqual(chapterOf(s, 4), { ...BLANK_CHAPTER, startedOn: TODAY });
    assert.deepEqual(Object.keys(s.chapters), ['4']);
    assert.equal(chapterStatus(s, 4, TODAY), 'current');
  });

  test('restarting a chapter moves only its start date: artist date, read and notes stay', () => {
    let s = startChapter(fresh(), 4, '2026-10-01');
    s = setRead(s, 4, true);
    s = planArtistDate(s, 4, 'Bookshop', 'bookshop');
    s = markArtistDate(s, 4, '2026-10-03');
    s = setArtistNote(s, 4, 'Found a good one.');
    s = deepFreeze(s);
    const before = chapterOf(s, 4);
    const restarted = startChapter(s, 4, TODAY);
    assert.deepEqual(chapterOf(restarted, 4), { ...before, startedOn: TODAY });
    assert.equal(restarted.course.chapter, 4);
  });

  test('restarting a finished chapter clears finishedOn and keeps its check-in', () => {
    let s = startChapter(fresh(), 4, '2026-10-01');
    s = deepFreeze(finishChapter(s, '2026-10-08', { lineUp: 'x', matters: 'y' }));
    const restarted = startChapter(s, 4, TODAY);
    const four = chapterOf(restarted, 4);
    assert.equal(restarted.course.chapter, 4);
    assert.equal(four.startedOn, TODAY);
    assert.equal(four.finishedOn, null);
    assert.deepEqual(four.checkin, { doneOn: '2026-10-08', lineUp: 'x', matters: 'y' });
    assert.equal(chapterStatus(restarted, 4, TODAY), 'current');
  });

  test('restarting keeps v1 legacy counts', () => {
    const s = migrateV1(v1State({ 3: v1Week({ ticks: 4, note: 'Old note' }) }), TODAY, NOW);
    const started = startChapter(s, 3, TODAY);
    assert.deepEqual(chapterOf(started, 3).legacy, { mornings: 4, artistDate: false });
    assert.equal(chapterOf(started, 3).artistDate.note, 'Old note');
  });

  test('starting the same chapter on the same day returns the same state', () => {
    const s = deepFreeze(startChapter(fresh(), 4, TODAY));
    assert.equal(startChapter(s, 4, TODAY), s);
  });

  test('startChapter wants a chapter number 1..12 and a date key', () => {
    for (const bad of [0, 13, -1, 4.5, '4', null, undefined]) {
      assert.throws(() => startChapter(fresh(), bad, TODAY), RangeError);
    }
    assert.throws(() => startChapter(fresh(), 4, 'today'), RangeError);
  });

  test('finishChapter on 11 records the check-in and starts 12 today', () => {
    const s = deepFreeze(startChapter(fresh(), 11, '2026-10-12'));
    const next = finishChapter(s, '2026-10-20', { lineUp: '  Less judging.  ', matters: 'The walks' });
    const eleven = chapterOf(next, 11);
    assert.equal(next.course.chapter, 12);
    assert.deepEqual(eleven.checkin, { doneOn: '2026-10-20', lineUp: 'Less judging.', matters: 'The walks' });
    assert.equal(eleven.startedOn, '2026-10-12');
    assert.equal(eleven.finishedOn, '2026-10-20');
    assert.deepEqual(chapterOf(next, 12), { ...BLANK_CHAPTER, startedOn: '2026-10-20' });
    assert.equal(chapterStatus(next, 11, '2026-10-20'), 'done');
    assert.equal(chapterStatus(next, 12, '2026-10-20'), 'current');
    assert.deepEqual(chapterInfo(next, '2026-10-20'), {
      num: 12, startedOn: '2026-10-20', dayOfChapter: 1, readyToMove: false, finishedOn: null,
    });
  });

  test('finishChapter on 12 stays on 12, marked finished', () => {
    const s = deepFreeze(startChapter(fresh(), 12, '2026-10-12'));
    const next = finishChapter(s, '2026-10-20', { lineUp: 'More faith', matters: 'The pages' });
    const twelve = chapterOf(next, 12);
    assert.equal(next.course.chapter, 12);
    assert.deepEqual(Object.keys(next.chapters), ['12']);
    assert.equal(twelve.startedOn, '2026-10-12');
    assert.equal(twelve.finishedOn, '2026-10-20');
    assert.deepEqual(twelve.checkin, { doneOn: '2026-10-20', lineUp: 'More faith', matters: 'The pages' });
    assert.equal(chapterStatus(next, 12, '2026-10-20'), 'done');
    assert.deepEqual(chapterInfo(next, '2026-10-25'), {
      num: 12, startedOn: '2026-10-12', dayOfChapter: 14, readyToMove: false, finishedOn: '2026-10-20',
    });
  });

  test('finishChapter answers are optional, trimmed and capped', () => {
    const plain = finishChapter(startChapter(fresh(), 1, '2026-10-01'), '2026-10-08');
    assert.deepEqual(chapterOf(plain, 1).checkin, { doneOn: '2026-10-08', lineUp: '', matters: '' });
    const long = finishChapter(startChapter(fresh(), 1, '2026-10-01'), '2026-10-08', {
      lineUp: 'l'.repeat(700),
      matters: null,
    });
    assert.equal(chapterOf(long, 1).checkin.lineUp.length, LIMITS.answer);
    assert.equal(chapterOf(long, 1).checkin.matters, '');
  });

  test('finishing keeps what the next chapter already holds', () => {
    let s = startChapter(fresh(), 2, '2026-10-01');
    s = setRead(s, 3, true);
    s = planArtistDate(s, 3, 'Read ahead and planned');
    s = finishChapter(s, '2026-10-08');
    assert.equal(chapterOf(s, 3).read, true);
    assert.equal(chapterOf(s, 3).artistDate.plan, 'Read ahead and planned');
    assert.equal(chapterOf(s, 3).startedOn, '2026-10-08');
  });

  test('finishChapter wants a date key', () => {
    assert.throws(() => finishChapter(fresh(), 'tomorrow'), RangeError);
  });

  test('chapterStats counts mornings and pages from start to finish, both days included', () => {
    let s = startChapter(fresh(), 3, '2026-10-01');
    s = withPages({ '2026-09-30': 3, '2026-10-01': 3, '2026-10-03': 1, '2026-10-08': 2, '2026-10-09': 3 }, s);
    s = setKeep(s, '2026-10-05', 'a keep line without pages');
    s = finishChapter(s, '2026-10-08');
    assert.deepEqual(chapterStats(s, 3, TODAY), { mornings: 3, pages: 6, artistDateDone: false });
    // Chapter 4 started the day 3 finished, so that day counts for both.
    assert.deepEqual(chapterStats(s, 4, TODAY), { mornings: 2, pages: 5, artistDateDone: false });
  });

  test('the current chapter counts up to today and not past it', () => {
    let s = startChapter(fresh(), 2, '2026-10-20');
    s = withPages({ '2026-10-19': 3, '2026-10-20': 1, '2026-10-22': 2, '2026-10-23': 3 }, s);
    assert.deepEqual(chapterStats(s, 2, TODAY), { mornings: 2, pages: 3, artistDateDone: false });
    assert.deepEqual(chapterStats(s, 2, '2026-10-23'), { mornings: 3, pages: 6, artistDateDone: false });
  });

  test('chapterStats adds v1 mornings, and a v1 artist date counts as done', () => {
    const s = migrateV1(v1State({ 1: v1Week({ ticks: 4, artistDate: true }) }), TODAY, NOW);
    assert.deepEqual(chapterStats(s, 1, TODAY), { mornings: 4, pages: 0, artistDateDone: true });
    // Picking the week up adds dated mornings on top.
    const picked = withPages({ '2026-10-20': 3, '2026-10-21': 2 }, startChapter(s, 1, '2026-10-20'));
    assert.deepEqual(chapterStats(picked, 1, TODAY), { mornings: 6, pages: 5, artistDateDone: true });
  });

  test('artistDateDone follows the artist date', () => {
    const s = startChapter(fresh(), 2, '2026-10-20');
    assert.equal(chapterStats(s, 2, TODAY).artistDateDone, false);
    assert.equal(chapterStats(markArtistDate(s, 2, TODAY), 2, TODAY).artistDateDone, true);
  });

  test('an untouched chapter has nothing to count', () => {
    assert.deepEqual(chapterStats(withPages({ [TODAY]: 3 }), 5, TODAY), { mornings: 0, pages: 0, artistDateDone: false });
  });

  test('a chapter left unfinished stops counting when the next one starts', () => {
    let s = startChapter(fresh(), 4, '2026-10-01');
    s = startChapter(s, 7, '2026-10-05');
    const days = {};
    for (let key = '2026-10-01'; key <= '2026-10-10'; key = addDays(key, 1)) days[key] = 1;
    s = withPages(days, s);
    assert.equal(chapterStats(s, 4, '2026-10-10').mornings, 5); // 1st to 5th
    assert.equal(chapterStats(s, 7, '2026-10-10').mornings, 6); // 5th to 10th
  });

  test('setRead ticks and unticks, and a no-op stores nothing', () => {
    const s = fresh();
    const read = setRead(s, 3, true);
    assert.equal(chapterOf(read, 3).read, true);
    assert.equal(chapterOf(setRead(read, 3, false), 3).read, false);
    assert.equal(setRead(s, 3, false), s);
    assert.throws(() => setRead(s, 0, true), RangeError);
  });

  test('chapterStatus on a fresh start: 1 current, the rest upcoming', () => {
    const s = fresh();
    assert.equal(chapterStatus(s, 1, TODAY), 'current');
    for (let n = 2; n <= 12; n += 1) assert.equal(chapterStatus(s, n, TODAY), 'upcoming');
  });

  test('chapterStatus: done through the check-in, even ahead of the current chapter', () => {
    let s = startChapter(fresh(), 6, '2026-10-01');
    s = finishChapter(s, '2026-10-08'); // 6 done, 7 current
    s = startChapter(s, 2, '2026-10-10'); // went back to 2
    assert.equal(chapterStatus(s, 2, TODAY), 'current');
    assert.equal(chapterStatus(s, 6, TODAY), 'done');
    assert.equal(chapterStatus(s, 7, TODAY), 'upcoming');
  });

  test('chapterStatus: an earlier chapter is done only when it was touched', () => {
    const s = migrateV1(v1State({ 2: v1Week({ ticks: 3 }), 5: v1Week({ ticks: 1 }) }), TODAY, NOW);
    assert.equal(s.course.chapter, 5);
    assert.equal(chapterStatus(s, 1, TODAY), 'upcoming');
    assert.equal(chapterStatus(s, 2, TODAY), 'done');
    assert.equal(chapterStatus(s, 3, TODAY), 'upcoming');
    assert.equal(chapterStatus(s, 5, TODAY), 'current');
    assert.equal(chapterStatus(s, 6, TODAY), 'upcoming');
    // Ticking "read" on an earlier chapter counts as touching it.
    assert.equal(chapterStatus(setRead(s, 1, true), 1, TODAY), 'done');
    // A blank note doesn't.
    assert.equal(chapterStatus(setArtistNote(s, 3, '   '), 3, TODAY), 'upcoming');
  });

  test('chapterStatus wants a chapter number', () => {
    assert.throws(() => chapterStatus(fresh(), 0, TODAY), RangeError);
    assert.throws(() => chapterStatus(fresh(), '1', TODAY), RangeError);
  });
});

describe('artist date', () => {
  test('moves unplanned, planned, done and back again', () => {
    let s = fresh();
    assert.equal(artistDateState(s, 1), 'unplanned');

    s = planArtistDate(s, 1, '  Walk the canal  ', 'canal');
    assert.equal(artistDateState(s, 1), 'planned');
    assert.deepEqual(chapterOf(s, 1).artistDate, { plan: 'Walk the canal', ideaId: 'canal', doneOn: null, note: '' });

    s = markArtistDate(s, 1, TODAY);
    assert.equal(artistDateState(s, 1), 'done');
    assert.deepEqual(chapterOf(s, 1).artistDate, { plan: 'Walk the canal', ideaId: 'canal', doneOn: TODAY, note: '' });

    s = unmarkArtistDate(s, 1);
    assert.equal(artistDateState(s, 1), 'planned');

    s = clearArtistPlan(s, 1);
    assert.equal(artistDateState(s, 1), 'unplanned');
    assert.deepEqual(chapterOf(s, 1).artistDate, BLANK_CHAPTER.artistDate);
  });

  test('planning again clears done', () => {
    let s = markArtistDate(planArtistDate(fresh(), 1, 'Museum'), 1, TODAY);
    s = planArtistDate(s, 1, 'Second outing', 'thrift');
    assert.equal(artistDateState(s, 1), 'planned');
    assert.equal(chapterOf(s, 1).artistDate.doneOn, null);
  });

  test('marking done without a plan still marks it, and the plan stays empty', () => {
    const s = markArtistDate(fresh(), 2, TODAY);
    assert.equal(artistDateState(s, 2), 'done');
    assert.deepEqual(chapterOf(s, 2).artistDate, { plan: '', ideaId: null, doneOn: TODAY, note: '' });
  });

  test('clearing the plan of a done artist date leaves it done', () => {
    const s = clearArtistPlan(markArtistDate(planArtistDate(fresh(), 1, 'Museum'), 1, TODAY), 1);
    assert.equal(artistDateState(s, 1), 'done');
    assert.equal(chapterOf(s, 1).artistDate.doneOn, TODAY);
  });

  test('plan is trimmed and capped at 200 characters, and a bad idea id becomes null', () => {
    const long = planArtistDate(fresh(), 2, 'p'.repeat(250), { id: 'x' });
    assert.equal(chapterOf(long, 2).artistDate.plan.length, LIMITS.plan);
    assert.equal(chapterOf(long, 2).artistDate.ideaId, null);
    const own = planArtistDate(fresh(), 2, 'My own idea');
    assert.equal(chapterOf(own, 2).artistDate.ideaId, null);
    assert.equal(artistDateState(own, 2), 'planned');
    assert.equal(artistDateState(planArtistDate(fresh(), 2, '', 'museum'), 2), 'planned');
  });

  test('the note keeps spaces while typing and stops at 600 characters', () => {
    let s = setArtistNote(fresh(), 3, 'Went to ');
    assert.equal(chapterOf(s, 3).artistDate.note, 'Went to ');
    assert.equal(artistDateState(s, 3), 'unplanned');
    s = setArtistNote(s, 3, 'n'.repeat(700));
    assert.equal(chapterOf(s, 3).artistDate.note.length, LIMITS.note);
  });

  test('each chapter has its own artist date', () => {
    const s = markArtistDate(planArtistDate(fresh(), 2, 'Gallery'), 2, TODAY);
    assert.equal(artistDateState(s, 2), 'done');
    assert.equal(artistDateState(s, 3), 'unplanned');
    assert.deepEqual(Object.keys(s.chapters), ['2']);
  });

  test('a v1 artist date counts as done, without a made-up date, and can be taken back', () => {
    const s = migrateV1(v1State({ 3: v1Week({ ticks: 2, artistDate: true }) }), TODAY, NOW);
    assert.equal(artistDateState(s, 3), 'done');
    assert.equal(chapterOf(s, 3).artistDate.doneOn, null);

    const undone = unmarkArtistDate(s, 3);
    assert.equal(artistDateState(undone, 3), 'unplanned');
    assert.equal(chapterStats(undone, 3, TODAY).artistDateDone, false);
    assert.deepEqual(chapterOf(undone, 3).legacy, { mornings: 2, artistDate: false });

    const replanned = planArtistDate(s, 3, 'Gallery');
    assert.equal(artistDateState(replanned, 3), 'planned');
    assert.equal(artistDateState(markArtistDate(replanned, 3, TODAY), 3), 'done');
  });

  test('artist date functions want a chapter number', () => {
    for (const call of [
      (s) => planArtistDate(s, 13, 'x'),
      (s) => clearArtistPlan(s, 0),
      (s) => markArtistDate(s, 1.5, TODAY),
      (s) => unmarkArtistDate(s, null),
      (s) => setArtistNote(s, '2', 'x'),
      (s) => artistDateState(s, 99),
    ]) {
      assert.throws(() => call(fresh()), RangeError);
    }
    assert.throws(() => markArtistDate(fresh(), 1, 'today'), RangeError);
  });
});

describe('decks', () => {
  const deck = (n) => Array.from({ length: n }, (_, i) => ({ id: `d${i}`, text: `Line ${i}` }));

  test('an empty deck gives null', () => {
    assert.equal(pickNext([], []), null);
    assert.equal(pickNext(undefined, []), null);
  });

  test('a one-card deck always gives that card, seen or not', () => {
    const one = deck(1);
    assert.equal(pickNext(one, ['d0'], () => 0.5), one[0]);
    assert.equal(pickNext(one, [], () => 0.5), one[0]);
  });

  test('never repeats within the last min(20, deck size - 1) picks', () => {
    for (const size of [2, 3, 5, 8, 20, 21, 22, 40]) {
      const cards = deck(size);
      const rand = mulberry32(size);
      const windowSize = Math.min(20, size - 1);
      let state = emptyState(TODAY, NOW);
      const history = [];
      for (let i = 0; i < 1200; i += 1) {
        const card = pickNext(cards, state.seen.starters, rand);
        assert.ok(!history.slice(-windowSize).includes(card.id), `deck of ${size}, pick ${i} repeated ${card.id}`);
        history.push(card.id);
        state = markSeen(state, 'starters', card.id);
      }
      assert.equal(new Set(history).size, size, `deck of ${size}: every card comes up`);
    }
  });

  test('deterministic for a seeded rand', () => {
    const cards = deck(30);
    const run = (seed) => {
      const rand = mulberry32(seed);
      let seen = [];
      const ids = [];
      for (let i = 0; i < 60; i += 1) {
        const card = pickNext(cards, seen, rand);
        ids.push(card.id);
        seen = [...seen, card.id].slice(-20);
      }
      return ids;
    };
    assert.deepEqual(run(42), run(42));
    assert.notDeepEqual(run(42), run(7));
  });

  test('only the last window of seen ids counts', () => {
    const cards = deck(3); // window of 2
    assert.equal(pickNext(cards, ['d0', 'd1', 'd2'], () => 0).id, 'd0');
    assert.equal(pickNext(cards, ['d2', 'd0'], () => 0.99).id, 'd1');
  });

  test('ids no longer in the deck are ignored', () => {
    const cards = deck(3);
    assert.equal(pickNext(cards, ['gone-1', 'gone-2'], () => 0).id, 'd0');
  });

  test('odd rand values still land on a card', () => {
    const cards = deck(4);
    assert.equal(pickNext(cards, [], () => 0).id, 'd0');
    assert.equal(pickNext(cards, [], () => 0.9999999).id, 'd3');
    assert.equal(pickNext(cards, [], () => 1).id, 'd3');
    assert.equal(pickNext(cards, [], () => -1).id, 'd0');
    assert.equal(pickNext(cards, [], () => Number.NaN).id, 'd0');
  });

  test('bare string cards and a missing seen list work', () => {
    assert.equal(pickNext(['a', 'b', 'c'], ['a', 'b'], () => 0), 'c');
    assert.ok(['a', 'b'].includes(pickNext(['a', 'b'], undefined, () => 0.5)));
  });

  test('pickNext with the default rand gives a card from the deck', () => {
    const cards = deck(5);
    assert.ok(cards.includes(pickNext(cards, [])));
  });

  test('markSeen keeps the 20 most recent distinct ids, oldest first', () => {
    let s = fresh();
    for (let i = 0; i < 25; i += 1) s = markSeen(s, 'ideas', `i${i}`);
    assert.deepEqual(s.seen.ideas, Array.from({ length: 20 }, (_, i) => `i${i + 5}`));
    s = markSeen(s, 'ideas', 'i10'); // seen again: moves to the end
    assert.equal(s.seen.ideas.length, 20);
    assert.equal(s.seen.ideas.at(-1), 'i10');
    assert.equal(s.seen.ideas.filter((id) => id === 'i10').length, 1);
    assert.deepEqual(s.seen.starters, []);
  });

  test('markSeen of the latest id again returns the same state', () => {
    const s = deepFreeze(markSeen(fresh(), 'starters', 's1'));
    assert.equal(markSeen(s, 'starters', 's1'), s);
  });

  test('markSeen wants a known kind and a real id', () => {
    assert.throws(() => markSeen(fresh(), 'quotes', 'x'), RangeError);
    for (const bad of ['', null, undefined, {}, Number.NaN]) {
      assert.throws(() => markSeen(fresh(), 'ideas', bad), RangeError);
    }
  });
});

describe('settings', () => {
  test('valid values are stored', () => {
    let s = fresh();
    for (const theme of ['dark', 'light', 'system']) {
      s = setSetting(s, 'theme', theme);
      assert.equal(s.settings.theme, theme);
    }
    for (const minutes of [20, 30, 25]) {
      s = setSetting(s, 'minutes', minutes);
      assert.equal(s.settings.minutes, minutes);
    }
    s = setSetting(s, 'bell', false);
    s = setSetting(s, 'rain', true);
    s = setSetting(s, 'accent', 'cobalt');
    assert.equal(s.settings.accent, 'cobalt');
    s = setSetting(s, 'accent', 'chapter');
    assert.deepEqual(s.settings, { theme: 'system', minutes: 25, bell: false, rain: true, accent: 'chapter' });
  });

  test('accent is "chapter" or a lowercase key', () => {
    const s = fresh();
    for (const key of ['chapter', 'ultramarine', 'cadmium-yellow', 'a', 'x1', 'a'.repeat(24)]) {
      assert.equal(setSetting(s, 'accent', key).settings.accent, key, key);
    }
    for (const bad of ['', 'Ultramarine', 'cobalt blue', '-cobalt', '1st', 'a'.repeat(25), 'café', null, 3, true, {}]) {
      assert.equal(setSetting(s, 'accent', bad), s, `accent = ${String(bad)}`);
    }
  });

  test('invalid values and unknown keys are refused', () => {
    const s = fresh();
    const bad = [
      ['theme', 'blue'], ['theme', 'Dark'], ['theme', null], ['minutes', 15], ['minutes', 25.5],
      ['minutes', '25'], ['minutes', 0], ['bell', 'false'], ['bell', 0], ['rain', 1], ['rain', null],
      ['volume', 3], ['__proto__', {}], ['toString', 'x'], ['accent', 'Red'], ['accent', ''],
    ];
    for (const [key, value] of bad) assert.equal(setSetting(s, key, value), s, `${key} = ${String(value)}`);
  });

  test('setting the value it already has returns the same state', () => {
    const s = fresh();
    assert.equal(setSetting(s, 'theme', 'system'), s);
  });
});

describe('migration from v1', () => {
  test('an empty v1 state migrates to chapter 1 with nothing invented', () => {
    for (const v1 of [v1State(), { weeks: {} }, { weeks: {}, openWeeks: [], quoteIndex: 0, theme: 'light' }]) {
      const state = migrateV1(deepFreeze(structuredClone(v1)), TODAY, NOW);
      assert.equal(state.course.chapter, 1);
      assert.deepEqual(state.chapters, {});
      assert.deepEqual(state.days, {});
      assert.deepEqual(state.legacyV1, v1);
      assert.equal(state.createdAt, NOW);
      assert.equal(chapterInfo(state, TODAY).startedOn, null);
      assertValidState(state);
    }
  });

  test('partway through week 3: chapter 3 waits to be picked up, 1 and 2 count as done', () => {
    const v1 = v1State({
      1: v1Week({ ticks: 7, artistDate: true, note: 'Plant nursery' }),
      2: v1Week({ ticks: 7, artistDate: true }),
      3: v1Week({ ticks: 4, note: 'Went to the market' }),
    });
    const state = migrateV1(deepFreeze(structuredClone(v1)), TODAY, NOW);
    assert.equal(state.course.chapter, 3);
    assert.deepEqual(Object.keys(state.chapters).sort(), ['1', '2', '3']);
    assert.deepEqual(state.chapters['1'], {
      ...BLANK_CHAPTER,
      artistDate: { ...BLANK_CHAPTER.artistDate, note: 'Plant nursery' },
      legacy: { mornings: 7, artistDate: true },
    });
    assert.deepEqual(state.chapters['3'].legacy, { mornings: 4, artistDate: false });
    assert.equal(state.chapters['3'].artistDate.note, 'Went to the market');
    assert.equal(state.chapters['3'].startedOn, null);
    assert.equal(state.chapters['1'].finishedOn, null);
    assert.deepEqual(
      [1, 2, 3, 4].map((n) => chapterStatus(state, n, TODAY)),
      ['done', 'done', 'current', 'upcoming'],
    );
    assert.deepEqual(chapterStats(state, 1, TODAY), { mornings: 7, pages: 0, artistDateDone: true });
    assert.deepEqual(chapterStats(state, 3, TODAY), { mornings: 4, pages: 0, artistDateDone: false });
    assert.deepEqual(state.days, {});
    assert.deepEqual(state.legacyV1, v1);
    assertValidState(state);
  });

  test('weeks 1 to 5 complete: suggests week 6', () => {
    const weeks = {};
    for (let n = 1; n <= 5; n += 1) weeks[n] = v1Week({ ticks: 7, artistDate: true });
    const state = migrateV1(v1State(weeks), TODAY, NOW);
    assert.equal(state.course.chapter, 6);
    assert.deepEqual(Object.keys(state.chapters).sort(), ['1', '2', '3', '4', '5']);
    assert.equal(chapterStatus(state, 6, TODAY), 'current');
    for (let n = 1; n <= 5; n += 1) assert.equal(chapterStatus(state, n, TODAY), 'done');
    assert.equal(chapterInfo(state, TODAY).startedOn, null);
  });

  test('all 12 weeks complete: stays on 12', () => {
    const weeks = {};
    for (let n = 1; n <= 12; n += 1) weeks[n] = v1Week({ ticks: 7, artistDate: true });
    const state = migrateV1(v1State(weeks), TODAY, NOW);
    assert.equal(state.course.chapter, 12);
    assert.equal(Object.keys(state.chapters).length, 12);
    assert.equal(chapterStatus(state, 12, TODAY), 'current');
    assert.equal(chapterStatus(state, 11, TODAY), 'done');
  });

  test('the highest week with a tick decides, gaps and all', () => {
    assert.equal(migrateV1(v1State({ 2: v1Week({ ticks: 3 }), 7: v1Week({ ticks: 1 }) }), TODAY, NOW).course.chapter, 7);
    assert.equal(migrateV1(v1State({ 1: v1Week({ ticks: 2 }), 2: v1Week({ ticks: 7, artistDate: true }) }), TODAY, NOW).course.chapter, 3);
    // All seven mornings without the artist date is not complete.
    assert.equal(migrateV1(v1State({ 4: v1Week({ ticks: 7 }) }), TODAY, NOW).course.chapter, 4);
  });

  test('an artist date alone counts as a tick for the suggestion', () => {
    const state = migrateV1(v1State({ 4: v1Week({ artistDate: true }) }), TODAY, NOW);
    assert.equal(state.course.chapter, 4);
    assert.deepEqual(state.chapters['4'].legacy, { mornings: 0, artistDate: true });
  });

  test('notes only: chapter 1, with the noted weeks kept', () => {
    const state = migrateV1(
      v1State({ 2: v1Week({ note: 'An idea for later' }), 9: v1Week({ note: '   ' }) }),
      TODAY,
      NOW,
    );
    assert.equal(state.course.chapter, 1);
    assert.deepEqual(Object.keys(state.chapters), ['2']);
    assert.deepEqual(state.chapters['2'].legacy, { mornings: 0, artistDate: false });
    assert.equal(state.chapters['2'].artistDate.note, 'An idea for later');
    assert.equal(chapterStatus(state, 2, TODAY), 'upcoming');
  });

  test('malformed weeks and days arrays are read as far as they make sense', () => {
    const v1 = {
      weeks: {
        1: { days: 'not an array', artistDate: false, artistDateNote: '' },
        2: { days: [true, true], artistDate: false, artistDateNote: 'short array' },
        3: { days: [true, true, true, true, true, true, true, true, true], artistDate: false },
        4: { days: [1, 'true', true, null, {}, true, false], artistDate: 'yes', artistDateNote: 42 },
        5: { artistDate: true },
        6: null,
        7: 'garbage',
        8: [true, true],
      },
      theme: 'dark',
    };
    const state = migrateV1(deepFreeze(structuredClone(v1)), TODAY, NOW);
    assert.deepEqual(Object.keys(state.chapters).sort(), ['2', '3', '4', '5']);
    assert.deepEqual(state.chapters['2'].legacy, { mornings: 2, artistDate: false });
    assert.deepEqual(state.chapters['3'].legacy, { mornings: 7, artistDate: false }); // first 7 only
    assert.deepEqual(state.chapters['4'].legacy, { mornings: 2, artistDate: false }); // only real `true`s
    assert.equal(state.chapters['4'].artistDate.note, '');
    assert.deepEqual(state.chapters['5'].legacy, { mornings: 0, artistDate: true });
    assert.equal(state.course.chapter, 5);
    assert.deepEqual(state.legacyV1, v1);
    assertValidState(state);
  });

  test('a long v1 note is carried over whole', () => {
    // v1's "use this idea" button appended ideas to the note, so notes can run long.
    const note = 'Visit a plant nursery. · '.repeat(40).trim();
    const state = migrateV1(v1State({ 1: v1Week({ ticks: 1, note }) }), TODAY, NOW);
    assert.equal(state.chapters['1'].artistDate.note, note);
    assert.ok(note.length > LIMITS.note);
  });

  test('settings start fresh and v1 UI state stays only in legacyV1', () => {
    const v1 = v1State({ 1: v1Week({ ticks: 2 }) });
    const state = migrateV1(v1, TODAY, NOW);
    assert.deepEqual(state.settings, { theme: 'system', minutes: 25, bell: true, rain: false, accent: 'chapter' });
    assert.equal(state.legacyV1.theme, 'dark');
    assert.deepEqual(state.legacyV1.openWeeks, [1]);
    assert.notEqual(state.legacyV1, v1);
  });

  test('migrateV1 does not choke on garbage', () => {
    for (const bad of [null, undefined, 42, 'x', [], {}, { weeks: null }, { weeks: 5 }, { weeks: [] }]) {
      const state = migrateV1(bad, TODAY, NOW);
      assert.equal(state.course.chapter, 1);
      assert.deepEqual(state.chapters, {});
      assertValidState(state);
    }
  });
});

describe('load', () => {
  test('garbage in, a fresh state out, never a throw', () => {
    const garbage = [
      undefined, null, '', ' ', 'not json', '{', 'null', 'true', '42', '"text"', '[]', '[1,2]', '{}',
      '{"version":"2"}', '{"version":3}', '{"weeks":null}', '{"weeks":5}', '{"__proto__":{"version":2}}',
      42, true, [], {}, { version: '2' },
    ];
    const expected = emptyState(TODAY, NOW);
    for (const v2Raw of garbage) {
      for (const v1Raw of garbage) {
        const result = load({ v2Raw, v1Raw, today: TODAY, nowIso: NOW });
        assert.deepEqual(result, { state: expected, migrated: false, needsPickUp: true, source: 'empty' });
      }
    }
  });

  test('odd arguments still give a fresh state', () => {
    for (const options of [undefined, null, 42, 'x', [], {}, { v2Raw: 7, nowIso: {} }]) {
      const result = load(options);
      assertValidState(result.state);
      assert.equal(result.source, 'empty');
      assert.equal(result.migrated, false);
    }
  });

  test('v1 only: migrated, waiting for the pick-up step', () => {
    const v1 = v1State({ 1: v1Week({ ticks: 7, artistDate: true }), 2: v1Week({ ticks: 2 }) });
    const result = load({ v2Raw: null, v1Raw: JSON.stringify(v1), today: TODAY, nowIso: NOW });
    assert.equal(result.migrated, true);
    assert.equal(result.needsPickUp, true);
    assert.equal(result.source, 'v1');
    assert.deepEqual(result.state, migrateV1(v1, TODAY, NOW));
    assert.equal(result.state.course.chapter, 2);
    assert.deepEqual(result.state.legacyV1, v1);
  });

  test('after the pick-up the saved v2 loads with no pick-up step', () => {
    const v1Raw = JSON.stringify(v1State({ 2: v1Week({ ticks: 2 }) }));
    const first = load({ v2Raw: null, v1Raw, today: TODAY, nowIso: NOW });
    const picked = startChapter(first.state, first.state.course.chapter, TODAY);
    const second = load({ v2Raw: serialize(picked), v1Raw, today: TODAY, nowIso: NOW });
    assert.deepEqual(second, { state: picked, migrated: false, needsPickUp: false, source: 'v2' });
  });

  test('v2 only: loads as stored', () => {
    const state = richState();
    const result = load({ v2Raw: serialize(state), v1Raw: null, today: TODAY, nowIso: NOW });
    assert.deepEqual(result, { state, migrated: false, needsPickUp: false, source: 'v2' });
  });

  test('both present: v2 wins', () => {
    const v2 = startChapter(emptyState(TODAY, NOW), 9, '2026-10-20');
    const v1Raw = JSON.stringify(v1State({ 3: v1Week({ ticks: 5 }) }));
    const result = load({ v2Raw: serialize(v2), v1Raw, today: TODAY, nowIso: NOW });
    assert.equal(result.source, 'v2');
    assert.equal(result.migrated, false);
    assert.deepEqual(result.state, v2);
    assert.equal(result.state.legacyV1, null);
  });

  test('an unreadable v2 next to a readable v1 falls back to migrating v1', () => {
    const v1Raw = JSON.stringify(v1State({ 3: v1Week({ ticks: 5 }) }));
    const result = load({ v2Raw: '{"version":2,', v1Raw, today: TODAY, nowIso: NOW });
    assert.equal(result.source, 'v1');
    assert.equal(result.migrated, true);
    assert.equal(result.state.course.chapter, 3);
  });

  test('already parsed objects are accepted too', () => {
    const v1 = v1State({ 4: v1Week({ ticks: 1 }) });
    assert.equal(load({ v1Raw: v1, today: TODAY, nowIso: NOW }).state.course.chapter, 4);
    const v2 = richState();
    assert.deepEqual(load({ v2Raw: v2, today: TODAY, nowIso: NOW }).state, v2);
  });

  test('normalizes every field of a stored v2 state', () => {
    const stored = {
      version: 2,
      createdAt: 'yesterday',
      course: { chapter: 13 },
      chapters: {
        4: { startedOn: '2026-10-19', read: 'yes', artistDate: { plan: 'Walk', doneOn: '2026-02-30', ideaId: { x: 1 } } },
        0: { startedOn: '2026-10-01' },
        13: {},
        '04': {},
        x: {},
        7: 'garbage',
        9: { legacy: { mornings: 12, artistDate: 'yes' }, checkin: { doneOn: '2026-10-08', lineUp: 3 } },
      },
      days: {
        '2026-10-13': { pages: 3, keep: 'kept' },
        '2026-10-14': { pages: 5 },
        '2026-10-15': { pages: -2, keep: 'still here' },
        '2026-10-16': { pages: '2' },
        '2026-10-17': { pages: 2.9 },
        '2026-10-18': { pages: 'many' },
        '2026-10-19': { pages: 0, keep: '' },
        '2026-02-30': { pages: 1 },
        yesterday: { pages: 1 },
        '2026-10-1': { pages: 1 },
        '2026-10-20': 3,
        '2026-10-21': { pages: 1, keep: 42 },
      },
      settings: { theme: 'blue', minutes: 45, bell: 'yes', rain: true, accent: 'Not A Key' },
      seen: { starters: ['a', 'b', 'a', '', null, 7], ideas: 'nope' },
      legacyV1: 'not an object',
      extra: 'dropped',
    };
    const { state, source } = load({ v2Raw: JSON.stringify(stored), today: TODAY, nowIso: NOW });
    assert.equal(source, 'v2');
    assert.equal(state.createdAt, NOW);
    assert.equal(state.course.chapter, 1);
    assert.deepEqual(state.chapters, {
      4: { ...BLANK_CHAPTER, startedOn: '2026-10-19', artistDate: { plan: 'Walk', ideaId: null, doneOn: null, note: '' } },
      9: {
        ...BLANK_CHAPTER,
        checkin: { doneOn: '2026-10-08', lineUp: '', matters: '' },
        legacy: { mornings: 7, artistDate: false },
      },
    });
    assert.deepEqual(state.days, {
      '2026-10-13': { pages: 3, keep: 'kept' },
      '2026-10-14': { pages: 3, keep: '' },
      '2026-10-15': { pages: 0, keep: 'still here' },
      '2026-10-16': { pages: 2, keep: '' },
      '2026-10-17': { pages: 2, keep: '' },
      '2026-10-21': { pages: 1, keep: '' },
    });
    assert.deepEqual(state.settings, { theme: 'system', minutes: 25, bell: true, rain: true, accent: 'chapter' });
    assert.deepEqual(state.seen, { starters: ['b', 'a', 7], ideas: [] });
    assert.equal(state.legacyV1, null);
    assertValidState(state);
  });

  test('a chapter number outside 1..12 becomes 1', () => {
    for (const chapter of [0, 13, -1, 4.5, 'x', null, true, [], {}]) {
      const v2Raw = JSON.stringify({ version: 2, course: { chapter } });
      assert.equal(load({ v2Raw, today: TODAY, nowIso: NOW }).state.course.chapter, 1, String(chapter));
    }
    assert.equal(load({ v2Raw: '{"version":2,"course":{"chapter":12}}' }).state.course.chapter, 12);
    assert.equal(load({ v2Raw: '{"version":2,"course":{"chapter":"7"}}' }).state.course.chapter, 7);
    assert.equal(load({ v2Raw: '{"version":2,"course":7}' }).state.course.chapter, 1);
  });

  test('missing fields are filled in', () => {
    const { state } = load({ v2Raw: '{"version":2,"chapters":{"3":{}}}', today: TODAY, nowIso: NOW });
    assert.deepEqual(state, { ...emptyState(TODAY, NOW), chapters: { 3: BLANK_CHAPTER } });
  });

  test('seen lists are cut to the 20 most recent', () => {
    const starters = Array.from({ length: 25 }, (_, i) => `s${i}`);
    const { state } = load({ v2Raw: JSON.stringify({ version: 2, seen: { starters } }) });
    assert.deepEqual(state.seen.starters, starters.slice(5));
  });

  test('stored text is never cut on load', () => {
    const long = 'k'.repeat(1000);
    const v2Raw = JSON.stringify({ version: 2, days: { [TODAY]: { pages: 1, keep: long } } });
    assert.equal(load({ v2Raw }).state.days[TODAY].keep, long);
  });

  test('own "__proto__" keys in stored JSON are dropped, not obeyed', () => {
    const v2Raw = '{"version":2,"days":{"__proto__":{"pages":3}},"chapters":{"__proto__":{"read":true}},'
      + '"settings":{"__proto__":{"theme":"dark"}},"__proto__":{"course":{"chapter":5}}}';
    const { state } = load({ v2Raw, today: TODAY, nowIso: NOW });
    assert.deepEqual(state, emptyState(TODAY, NOW));
    assertValidState(state);
  });

  test('loading is idempotent: what load gives, load gives back', () => {
    const messy = '{"version":2,"days":{"2026-10-14":{"pages":9,"keep":" x "}},"seen":{"ideas":["a","a","b"]}}';
    const once = load({ v2Raw: messy, today: TODAY, nowIso: NOW }).state;
    const twice = load({ v2Raw: serialize(once), today: TODAY, nowIso: NOW }).state;
    assert.deepEqual(twice, once);
  });

  test('random junk never throws and always gives a valid state', () => {
    const rand = mulberry32(2026);
    for (let i = 0; i < 400; i += 1) {
      const v2 = junkState(rand);
      const v1 = junkState(rand);
      const inputs = [
        { v2Raw: JSON.stringify(v2) ?? null, v1Raw: JSON.stringify(v1) ?? null },
        { v2Raw: v2, v1Raw: v1 },
        { v2Raw: null, v1Raw: JSON.stringify(v1) ?? null },
      ];
      for (const input of inputs) {
        const result = load({ ...input, today: TODAY, nowIso: NOW });
        assertValidState(result.state);
        assert.equal(typeof result.migrated, 'boolean');
        assert.equal(typeof result.needsPickUp, 'boolean');
      }
    }
  });
});

describe('start-up guard: stored data this version cannot read', () => {
  // A stand-in for localStorage: a plain map of key to text.
  const storage = (items = {}) => (key) => (Object.hasOwn(items, key) ? items[key] : null);
  const v3 = JSON.stringify({ version: 3, course: { chapter: 6 }, days: { [TODAY]: { pages: 3 } } });

  test('the key names', () => {
    assert.equal(STORAGE_KEY, 'awc.v2');
    assert.equal(UNREAD_KEY, 'awc.v2.unread');
  });

  test('a readable v2 needs no copy', () => {
    const v2Raw = serialize(fresh());
    const { source } = load({ v2Raw, today: TODAY, nowIso: NOW });
    assert.equal(source, 'v2');
    assert.deepEqual(unreadGuard(v2Raw, source, storage()), { copyTo: null, blocked: false });
  });

  test('nothing stored, or only whitespace, needs no copy', () => {
    for (const v2Raw of [null, undefined, '', '   ']) {
      const { source } = load({ v2Raw, today: TODAY, nowIso: NOW });
      assert.deepEqual(unreadGuard(v2Raw, source, storage()), { copyTo: null, blocked: false }, String(v2Raw));
    }
  });

  test('a newer data version is copied aside before anything is written', () => {
    const { source, state } = load({ v2Raw: v3, today: TODAY, nowIso: NOW });
    assert.equal(source, 'empty');
    assert.equal(state.course.chapter, 1, 'load itself falls back to a fresh state');
    assert.deepEqual(unreadGuard(v3, source, storage()), { copyTo: UNREAD_KEY, blocked: false });
  });

  test('also when the old app\'s data is migrated instead', () => {
    const v1Raw = JSON.stringify(v1State({ 2: v1Week({ ticks: 3 }) }));
    const { source } = load({ v2Raw: v3, v1Raw, today: TODAY, nowIso: NOW });
    assert.equal(source, 'v1');
    assert.equal(unreadGuard(v3, source, storage()).copyTo, UNREAD_KEY);
  });

  test('damaged text is kept too', () => {
    for (const v2Raw of ['{"version":2,', 'not json', '[]', '42', '{"version":"2"}', JSON.stringify(v1State())]) {
      const { source } = load({ v2Raw, today: TODAY, nowIso: NOW });
      assert.notEqual(source, 'v2', v2Raw);
      assert.equal(unreadGuard(v2Raw, source, storage()).copyTo, UNREAD_KEY, v2Raw);
    }
  });

  test('an earlier copy of the same text is reused, a different one is never overwritten', () => {
    const { source } = load({ v2Raw: v3, today: TODAY, nowIso: NOW });
    assert.equal(unreadGuard(v3, source, storage({ [UNREAD_KEY]: v3 })).copyTo, UNREAD_KEY);
    assert.equal(unreadGuard(v3, source, storage({ [UNREAD_KEY]: 'older' })).copyTo, `${UNREAD_KEY}.2`);
    assert.equal(
      unreadGuard(v3, source, storage({ [UNREAD_KEY]: 'older', [`${UNREAD_KEY}.2`]: 'other' })).copyTo,
      `${UNREAD_KEY}.3`,
    );
  });

  test('with every slot taken by other text, nothing may be written', () => {
    const { source } = load({ v2Raw: v3, today: TODAY, nowIso: NOW });
    const full = {};
    for (let slot = 1; slot <= 20; slot += 1) full[slot === 1 ? UNREAD_KEY : `${UNREAD_KEY}.${slot}`] = `copy ${slot}`;
    assert.deepEqual(unreadGuard(v3, source, storage(full)), { copyTo: null, blocked: true });
  });
});

describe("another tab's save", () => {
  test('a readable v2 comes back normalized', () => {
    const saved = setPages(fresh(), TODAY, 2, TODAY);
    const state = loadSaved(serialize(saved), NOW);
    assert.deepEqual(state, saved);
    assertValidState(state);
  });

  test('anything else is left alone', () => {
    for (const raw of [null, undefined, 42, '', 'nope', '{"version":3}', JSON.stringify(v1State()), '{"version":2,']) {
      assert.equal(loadSaved(raw, NOW), null, String(raw));
    }
  });
});

describe('serialize', () => {
  test('gives JSON that loads back to the same state', () => {
    const state = richState();
    const text = serialize(state);
    assert.equal(typeof text, 'string');
    assert.deepEqual(JSON.parse(text), state);
    assert.deepEqual(load({ v2Raw: text, today: TODAY, nowIso: NOW }).state, state);
  });
});

describe('backup', () => {
  test('exportBackup wraps the state with the app name, version and time', () => {
    const state = richState();
    const parsed = JSON.parse(exportBackup(state, NOW));
    assert.deepEqual(Object.keys(parsed), ['app', 'version', 'exportedAt', 'state']);
    assert.equal(parsed.app, 'artists-way-companion');
    assert.equal(parsed.app, APP_ID);
    assert.equal(parsed.version, 2);
    assert.equal(parsed.exportedAt, NOW);
    assert.deepEqual(parsed.state, state);
  });

  test('export then import gives the same state back', () => {
    for (const state of [fresh(), richState()]) {
      const result = importBackup(exportBackup(state, NOW), TODAY, NOW);
      assert.deepEqual(result, { ok: true, state, error: null, code: null, migrated: false });
    }
  });

  test('a bare v2 state imports too', () => {
    const state = richState();
    const result = importBackup(serialize(state), TODAY, NOW);
    assert.equal(result.ok, true);
    assert.deepEqual(result.state, state);
  });

  test('a v1 export file imports and migrates', () => {
    const v1 = v1State({
      1: v1Week({ ticks: 7, artistDate: true, note: 'Plant nursery' }),
      2: v1Week({ ticks: 5 }),
    });
    const text = JSON.stringify(v1, null, 2); // exactly what v1's "export" button saved
    const result = importBackup(text, TODAY, NOW);
    assert.equal(result.ok, true);
    assert.equal(result.migrated, true);
    assert.equal(result.error, null);
    assert.equal(result.state.course.chapter, 2);
    assert.deepEqual(result.state, migrateV1(v1, TODAY, NOW));
    assert.deepEqual(result.state.legacyV1, v1);
  });

  test('plain-English errors for an empty file, garbage and another app', () => {
    assert.deepEqual(importBackup('', TODAY, NOW), {
      ok: false, state: null, error: 'That file is empty.', code: 'empty', migrated: false,
    });
    assert.equal(
      importBackup('this is not a backup', TODAY, NOW).error,
      "That file couldn't be read. Choose a backup file saved from this app.",
    );
    assert.equal(
      importBackup('{"app":"some-other-app","version":1,"state":{}}', TODAY, NOW).error,
      'That backup is from a different app.',
    );
  });

  test('every kind of bad file is refused with a code and a calm message', () => {
    const cases = [
      ['', 'empty'], ['   \n\t', 'empty'],
      ['not json', 'unreadable'], ['{"app":', 'unreadable'], [null, 'unreadable'], [undefined, 'unreadable'], [42, 'unreadable'],
      ['[]', 'unknown'], ['42', 'unknown'], ['"text"', 'unknown'], ['null', 'unknown'], ['{}', 'unknown'],
      ['{"foo":1}', 'unknown'], ['{"weeks":"x"}', 'unknown'], ['{"version":"2"}', 'unknown'],
      ['{"app":"some-other-app","version":1,"state":{}}', 'wrongApp'], ['{"app":null}', 'wrongApp'],
      ['{"app":"artists-way-companion","version":2}', 'damaged'],
      ['{"app":"artists-way-companion","version":2,"state":{"days":{}}}', 'damaged'],
      ['{"app":"artists-way-companion","version":2,"state":[]}', 'damaged'],
      ['{"app":"artists-way-companion","version":3,"state":{"version":3}}', 'newer'],
      ['{"app":"artists-way-companion","version":2,"state":{"version":3}}', 'newer'],
      ['{"version":3,"course":{"chapter":2}}', 'newer'],
    ];
    for (const [text, code] of cases) {
      const result = importBackup(text, TODAY, NOW);
      assert.equal(result.ok, false, String(text));
      assert.equal(result.state, null);
      assert.equal(result.code, code, String(text));
      assert.equal(typeof result.error, 'string');
      assert.ok(result.error.length > 10);
      assert.doesNotMatch(result.error, /[!\u2014]/); // no exclamation marks or em dashes
    }
  });

  test('random junk never throws', () => {
    const rand = mulberry32(99);
    for (let i = 0; i < 400; i += 1) {
      const value = junkState(rand);
      const texts = [
        JSON.stringify(value),
        JSON.stringify({ app: APP_ID, version: 2, state: value }),
        junkText(rand),
      ];
      for (const text of texts) {
        const result = importBackup(text, TODAY, NOW);
        if (result.ok) {
          assertValidState(result.state);
          assert.equal(result.error, null);
        } else {
          assert.equal(result.state, null);
          assert.equal(typeof result.error, 'string');
        }
      }
    }
  });
});

describe('timer', () => {
  const T0 = 1_760_000_000_000;
  const MIN = 60_000;

  test('timerStart', () => {
    assert.deepEqual(timerStart(25, T0), { endsAt: T0 + 25 * MIN, minutes: 25, pausedLeft: null });
    assert.deepEqual(timerStart(20, T0), { endsAt: T0 + 20 * MIN, minutes: 20, pausedLeft: null });
  });

  test('timerLeft counts down and never goes below zero', () => {
    const t = timerStart(20, T0);
    assert.equal(timerLeft(t, T0), 20 * MIN);
    assert.equal(timerLeft(t, T0 + 5 * MIN), 15 * MIN);
    assert.equal(timerLeft(t, T0 + 20 * MIN - 1), 1);
    assert.equal(timerLeft(t, T0 + 20 * MIN), 0);
    assert.equal(timerLeft(t, T0 + 90 * MIN), 0);
  });

  test('timerLeft is never more than the full length when the clock is set back', () => {
    assert.equal(timerLeft(timerStart(25, T0), T0 - 60 * MIN), 25 * MIN);
  });

  test('pause freezes the time left and resume runs on from there', () => {
    let t = timerStart(25, T0);
    t = timerPause(t, T0 + 10 * MIN);
    assert.deepEqual(t, { endsAt: null, minutes: 25, pausedLeft: 15 * MIN });
    assert.equal(timerLeft(t, T0 + 10 * MIN), 15 * MIN);
    assert.equal(timerLeft(t, T0 + 60 * MIN), 15 * MIN); // time passing while paused changes nothing
    t = timerResume(t, T0 + 60 * MIN);
    assert.deepEqual(t, { endsAt: T0 + 75 * MIN, minutes: 25, pausedLeft: null });
    assert.equal(timerLeft(t, T0 + 70 * MIN), 5 * MIN);
    t = timerPause(t, T0 + 72 * MIN);
    assert.equal(timerLeft(t, T0 + 100 * MIN), 3 * MIN);
    t = timerResume(t, T0 + 100 * MIN);
    assert.equal(timerLeft(t, T0 + 102 * MIN), 1 * MIN);
    assert.equal(timerLeft(t, T0 + 103 * MIN), 0);
  });

  test('pausing a paused timer or resuming a running one changes nothing', () => {
    const running = deepFreeze(timerStart(30, T0));
    assert.equal(timerResume(running, T0 + MIN), running);
    const paused = deepFreeze(timerPause(running, T0 + MIN));
    assert.equal(timerPause(paused, T0 + 2 * MIN), paused);
    assert.equal(running.pausedLeft, null);
  });

  test('a timer paused after it ran out stays at zero', () => {
    const t = timerPause(timerStart(20, T0), T0 + 25 * MIN);
    assert.equal(t.pausedLeft, 0);
    assert.equal(timerLeft(timerResume(t, T0 + 30 * MIN), T0 + 30 * MIN), 0);
  });

  test('odd minutes fall back to 25 and a missing timer has nothing left', () => {
    for (const minutes of [undefined, null, 0, -5, Number.NaN, '25']) {
      assert.equal(timerStart(minutes, T0).minutes, 25);
    }
    assert.equal(timerLeft(null, T0), 0);
    assert.equal(timerPause(null, T0), null);
    assert.equal(timerResume(null, T0), null);
  });

  test('a time in milliseconds is required', () => {
    for (const bad of [undefined, null, '1760000000000', Number.NaN]) {
      assert.throws(() => timerStart(25, bad), RangeError);
      assert.throws(() => timerLeft(timerStart(25, T0), bad), RangeError);
    }
  });
});

describe('purity', () => {
  test('state-changing functions never touch their input', () => {
    const state = richState(); // deep-frozen: any write throws
    const snapshot = structuredClone(state);
    const calls = [
      (s) => tapPage(s, TODAY, 2, TODAY),
      (s) => setPages(s, '2026-10-01', 3, TODAY),
      (s) => setPages(s, '2026-09-09', 0, TODAY),
      (s) => setKeep(s, TODAY, 'new line'),
      (s) => setKeep(s, '2026-10-20', ''),
      (s) => startChapter(s, 5, TODAY),
      (s) => startChapter(s, 3, TODAY),
      (s) => finishChapter(s, TODAY, { lineUp: 'a', matters: 'b' }),
      (s) => setRead(s, 3, true),
      (s) => planArtistDate(s, 3, 'Museum', 'museum'),
      (s) => clearArtistPlan(s, 2),
      (s) => markArtistDate(s, 3, TODAY),
      (s) => unmarkArtistDate(s, 1),
      (s) => setArtistNote(s, 3, 'note'),
      (s) => markSeen(s, 'ideas', 'museum'),
      (s) => setSetting(s, 'bell', false),
    ];
    for (const call of calls) {
      const next = call(state);
      assert.notEqual(next, state);
      assert.deepEqual(state, snapshot);
    }
  });

  test('readers return fresh arrays and objects', () => {
    const state = richState();
    const row = weekRow(state, TODAY);
    row[0].pages = 99;
    assert.notEqual(weekRow(state, TODAY)[0].pages, 99);
    const lines = keptLines(state);
    lines.pop();
    assert.equal(keptLines(state).length, lines.length + 1);
  });

  test('core.js runs with the clock switched off', () => {
    const RealDate = globalThis.Date;
    class ClocklessDate extends RealDate {
      constructor(...args) {
        if (args.length === 0) throw new Error('core.js read the clock with new Date()');
        super(...args);
      }

      static now() {
        throw new Error('core.js read the clock with Date.now()');
      }
    }
    globalThis.Date = ClocklessDate;
    try {
      const s = richState();
      dateKey(new Date(2026, 9, 22, 8));
      parseKey(TODAY);
      weekOf(TODAY);
      daysBetween('2026-10-01', TODAY);
      load({ v2Raw: serialize(s), v1Raw: null, today: TODAY, nowIso: NOW });
      load({ v2Raw: null, v1Raw: JSON.stringify(v1State({ 1: v1Week({ ticks: 3 }) })), today: TODAY, nowIso: NOW });
      importBackup(exportBackup(s, NOW), TODAY, NOW);
      reentry(s, TODAY);
      monthPages(s, TODAY);
      weekRow(s, TODAY);
      chapterInfo(s, TODAY);
      chapterStats(s, 2, TODAY);
      pickNext([{ id: 'a' }, { id: 'b' }], ['a'], () => 0.5);
      timerLeft(timerPause(timerStart(25, 1_000), 2_000), 3_000);
    } finally {
      globalThis.Date = RealDate;
    }
  });

  test('core.js has no DOM, storage or imports', () => {
    const code = readFileSync(CORE_FILE, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(code, /\b(?:window|document|localStorage|sessionStorage|navigator|indexedDB)\b/);
    assert.doesNotMatch(code, /^\s*import\b/m);
    assert.doesNotMatch(code, /Date\.now\(|new Date\(\s*\)|performance\.now\(/);
  });
});

describe('whole suite in other time zones', {
  skip: process.env.AWC_TZ_CHILD === '1' ? 'already inside a time zone run' : false,
}, () => {
  for (const zone of Object.keys(ZONES)) {
    test(`passes with TZ=${zone}`, () => {
      const env = { ...process.env, TZ: zone, AWC_TZ_CHILD: '1' };
      delete env.NODE_TEST_CONTEXT; // let the child run as its own test runner
      const run = spawnSync(process.execPath, ['--test', '--test-reporter=spec', THIS_FILE], {
        env,
        encoding: 'utf8',
        timeout: 120_000,
      });
      assert.equal(run.status, 0, `failed with TZ=${zone}\n${run.stdout}\n${run.stderr}`);
      assert.match(run.stdout, /fail 0/);
    });
  }
});
