// End-to-end tests at phone size (390x844, touch), with Playwright and node:test,
// on Chromium and WebKit.
//
//   npm run e2e                                    both engines, exits non-zero when a test fails
//   E2E_BROWSERS=chromium npm run e2e              one engine: chromium, webkit, or both comma-separated
//   node --test-name-pattern="backfill" test/e2e.mjs        only the tests whose name matches
//   HEADED=1 SLOWMO=250 E2E_BROWSERS=chromium npm run e2e   watch it run
//
// Starts test/server.mjs on a free port and gives every open() its own fresh
// browser context: empty storage, no service worker yet. The app's clock moves
// with ?today= (localhost only); the timer and midnight tests use page.clock.
// Every test fails when the page logs a console error or throws. Screenshots
// land in test-results/<engine>/ (gitignored).
//
// Tests talk to the app through its data-test hooks and what a person sees:
// text from content.js, roles and labels, aria-pressed. Not pixel positions or
// exact styling, apart from the few checks that are about layout on purpose
// (the re-entry line fading in place, the one filled button on Today).
//
// Known bugs: a test that reproduces an open bug carries `todo: 'BUG-nn ...'`.
// It still runs and reports, but doesn't fail the run. Remove the todo once
// the bug is fixed and the test passes.
//
// If Playwright says a browser is missing: npx playwright install chromium webkit

import { describe, test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';
import { ACCENTS, CHAPTER_ACCENTS } from '../public/accents.js';
import { CHAPTERS, CHECKIN, COPY, DONE_LINES, IDEAS, PICKUP, REENTRY, STARTERS } from '../public/content.js';
import { addDays, exportBackup } from '../public/core.js';
import { APP_VERSION } from '../public/ui/store.js';
import { startServer } from './server.mjs';

const require = createRequire(import.meta.url);

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PUBLIC = join(ROOT, 'public');
const RESULTS = join(ROOT, 'test-results');

const APP_NAME = "Artist's Way";
const KEY_V2 = 'awc.v2';
const KEY_V1 = 'artists_way_tracker_v1';
const KEY_TIMER = 'awc.timer';
const KEY_DRAFTS = 'awc.drafts';
const KEY_UNREAD = 'awc.v2.unread';

// An iPhone-sized phone: 390x844 CSS px at 3x, touch, British English.
const PHONE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  locale: 'en-GB',
  timezoneId: 'Europe/London',
};

const LAUNCHERS = { chromium, webkit };
const ENGINES = (process.env.E2E_BROWSERS || 'chromium,webkit')
  .split(',')
  .map((name) => name.trim().toLowerCase())
  .filter(Boolean);
for (const name of ENGINES) {
  if (!LAUNCHERS[name]) throw new Error(`E2E_BROWSERS: unknown engine "${name}". Use chromium, webkit, or both.`);
}

// The day most tests run on: a Thursday. Its week runs Monday 19 to Sunday 25 October.
const TODAY = '2026-10-22';
const D = (n) => addDays(TODAY, n);
// 07:00 on that day in London, for tests that drive the clock themselves.
const T0 = Date.parse('2026-10-22T07:00:00+01:00');
const MIN = 60_000;

// ---------------------------------------------------------------------------
// WebKit on macOS 14
//
// Playwright 1.62.1 runs WebKit build 2251 on macOS 14 (newer builds need
// macOS 15). Every new page gets Page.overrideSetting("PushAPIEnabled"), a
// setting that build doesn't know, so newPage() stalls and then fails with
// "Unknown setting: PushAPIEnabled". This lets an unknown setting through as
// a no-op; a build that knows the setting never reaches it. It touches
// Playwright internals, so it does nothing if they've moved. Drop it once
// this Mac runs macOS 15 or Playwright stops sending the setting to 2251.

function allowUnknownWebKitSettings() {
  try {
    const { server } = require('playwright-core/lib/coreBundle');
    const proto = server?.Browser?.prototype;
    if (!proto || proto.__e2eSettingsShim) return;
    const newContext = proto.newContext;
    proto.newContext = function (...args) {
      const session = this._connection?.browserSession;
      const sessionProto = this._wkPages instanceof Map && session ? Object.getPrototypeOf(session) : null;
      if (sessionProto && typeof sessionProto.send === 'function' && !sessionProto.__e2eSettingsShim) {
        const send = sessionProto.send;
        sessionProto.send = function (method, params) {
          const sent = send.call(this, method, params);
          if (method !== 'Page.overrideSetting') return sent;
          return sent.catch((error) => {
            if (/Unknown setting/i.test(String(error?.message))) return {};
            throw error;
          });
        };
        sessionProto.__e2eSettingsShim = true;
      }
      return newContext.apply(this, args);
    };
    proto.__e2eSettingsShim = true;
  } catch {
    // Playwright's internals moved: run without the shim.
  }
}

// ---------------------------------------------------------------------------
// Harness

let server;
let base;
let browser = null;
let engine = null; // the engine running now
let defining = null; // the engine whose tests are being declared
let current = null;
const contexts = new Set();
const opened = [];
const problems = new WeakMap();
const requestLogs = new WeakMap();

before(async () => {
  server = await startServer(0, '127.0.0.1');
  // localhost, not 127.0.0.1: ?today= is honoured on localhost.
  base = `http://localhost:${server.address().port}`;
});

after(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

/** Absolute URL on the test server. today ('YYYY-MM-DD') becomes ?today=. */
function url(path = '/', today) {
  const target = new URL(path, base);
  if (today) target.searchParams.set('today', today);
  return target.href;
}

// Runs in the page before any of its scripts, on every load of the tab.
function pageSetup({ origin, items, spy, audio, wakeLock, failWrites }) {
  if (location.origin !== origin) return;
  // Seed storage once per tab, so a reload keeps whatever the app saved.
  if (items && !sessionStorage.getItem('e2e.seeded')) {
    sessionStorage.setItem('e2e.seeded', '1');
    for (const [key, value] of Object.entries(items)) localStorage.setItem(key, value);
  }
  // window.__writes: every localStorage key this page writes ("-key" for a removal).
  if (spy && !window.__writes) {
    const writes = [];
    Object.defineProperty(window, '__writes', { value: writes });
    const { setItem, removeItem } = Storage.prototype;
    Storage.prototype.setItem = function (key, value) {
      if (this === window.localStorage) writes.push(String(key));
      return setItem.call(this, key, value);
    };
    Storage.prototype.removeItem = function (key) {
      if (this === window.localStorage) writes.push(`-${key}`);
      return removeItem.call(this, key);
    };
  }
  // localStorage.setItem throws for these keys, like a full or locked storage.
  if (failWrites?.length && !window.__failing) {
    Object.defineProperty(window, '__failing', { value: true });
    const { setItem } = Storage.prototype;
    Storage.prototype.setItem = function (key, value) {
      if (this === window.localStorage && failWrites.includes(String(key))) {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      }
      return setItem.call(this, key, value);
    };
  }
  // window.__wake: a stand-in screen wake lock that logs "request:screen" and "release".
  if (wakeLock && !window.__wake) {
    const log = [];
    const locks = [];
    Object.defineProperty(window, '__wake', { value: log });
    Object.defineProperty(window, '__wakeLocks', { value: locks });
    const fake = {
      async request(type) {
        log.push(`request:${type}`);
        const lock = new EventTarget();
        lock.type = type;
        lock.released = false;
        lock.release = async () => {
          if (lock.released) return;
          lock.released = true;
          log.push('release');
          lock.dispatchEvent(new Event('release'));
        };
        locks.push(lock);
        return lock;
      },
    };
    Object.defineProperty(Navigator.prototype, 'wakeLock', { configurable: true, get: () => fake });
  }
  // window.__audio: audio contexts made, oscillators (the bell) and buffer sources (rain).
  if (audio && !window.__audio) {
    const counts = { contexts: 0, oscillators: 0, sources: 0 };
    Object.defineProperty(window, '__audio', { value: counts });
    const Context = window.AudioContext || window.webkitAudioContext;
    if (Context) {
      class Counted extends Context {
        constructor(...args) {
          super(...args);
          counts.contexts += 1;
        }
      }
      if (window.AudioContext) window.AudioContext = Counted;
      if (window.webkitAudioContext) window.webkitAudioContext = Counted;
      const { createOscillator, createBufferSource } = Context.prototype;
      Context.prototype.createOscillator = function (...args) {
        counts.oscillators += 1;
        return createOscillator.apply(this, args);
      };
      Context.prototype.createBufferSource = function (...args) {
        counts.sources += 1;
        return createBufferSource.apply(this, args);
      };
    }
  }
}

function asStored(value) {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * Opens the app on a fresh phone (new browser context) and waits for load.
 *   today      'YYYY-MM-DD', moves the app's date (localhost only); null or absent for the real date
 *   v1, v2     saved data for artists_way_tracker_v1 and awc.v2: an object (stored as JSON) or a raw string
 *   storage    more keys to seed, { key: object or string }
 *   theme      the phone's colour scheme, 'light' (default) or 'dark'
 *   motion     'reduce' (default, steady screenshots) or 'no-preference'
 *   clock      a time in ms: page.clock is installed and paused there, so time only moves when a test moves it
 *   sw         false blocks the service worker (needed for page.route)
 *   clipboard  grant clipboard access (Chromium; WebKit has no such permission)
 *   spy        record localStorage writes in window.__writes
 *   audio      count audio contexts, oscillators and buffer sources in window.__audio
 *   wakeLock   a stand-in navigator.wakeLock that logs to window.__wake
 *   failWrites localStorage keys whose writes throw (QuotaExceededError)
 *   path       defaults to '/'
 */
async function open({
  today,
  v1,
  v2,
  storage = {},
  theme = 'light',
  motion = 'reduce',
  clock = null,
  sw = true,
  clipboard = false,
  spy = false,
  audio = false,
  wakeLock = false,
  failWrites = [],
  path = '/',
} = {}) {
  const context = await browser.newContext({
    ...PHONE,
    colorScheme: theme,
    reducedMotion: motion,
    serviceWorkers: sw ? 'allow' : 'block',
  });
  contexts.add(context);
  if (clipboard && engine === 'chromium') {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(base).origin });
  }
  const page = await context.newPage();
  track(page);

  const items = {};
  if (v1 != null) items[KEY_V1] = asStored(v1);
  if (v2 != null) items[KEY_V2] = asStored(v2);
  for (const [key, value] of Object.entries(storage)) items[key] = asStored(value);
  await page.addInitScript(pageSetup, {
    origin: new URL(base).origin,
    items: Object.keys(items).length ? items : null,
    spy,
    audio,
    wakeLock,
    failWrites,
  });
  if (clock !== null) {
    await page.clock.install({ time: clock - MIN });
    await page.clock.pauseAt(clock);
  }

  current = page;
  const response = await page.goto(url(path, today));
  assert.ok(response?.ok(), `GET ${path} answered ${response?.status()}`);
  return page;
}

/** The app on TODAY (pass today: null for the real date). */
function app(options = {}) {
  return open({ today: TODAY, ...options });
}

/** A second tab in the same browser (same storage), not seeded. */
async function openTab(page, today = TODAY) {
  const tab = await page.context().newPage();
  track(tab);
  const response = await tab.goto(url('/', today));
  assert.ok(response?.ok());
  return tab;
}

function track(page) {
  opened.push(page);
  const list = [];
  problems.set(page, list);
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const { url: where, lineNumber } = message.location();
    list.push(`console: ${message.text()}${where ? ` (${where}:${lineNumber})` : ''}`);
  });
  page.on('pageerror', (error) => list.push(`pageerror: ${error.message}`));
  const requests = [];
  page.context().on('request', (request) => requests.push(request.url()));
  requestLogs.set(page, requests);
}

/** Console errors and uncaught page errors seen on this page so far. */
function errorsOf(page = current) {
  return problems.get(page) ?? [];
}

/** Every URL requested in this page's browser context so far (page and worker). */
function requestsOf(page = current) {
  return requestLogs.get(page) ?? [];
}

function expectNoErrors(page = current) {
  const list = errorsOf(page);
  assert.equal(list.length, 0, `errors on the page:\n  ${list.join('\n  ')}`);
}

/** A test that also fails on any console error or page error in any page it opened. */
function e2e(name, options, fn) {
  if (typeof options === 'function') [fn, options] = [options, {}];
  test(name, { timeout: 90_000, ...options }, async (t) => {
    await fn(t);
    for (const page of opened) expectNoErrors(page);
  });
}

/** The saved v2 state, parsed, or null when nothing is saved. */
async function readState(page = current) {
  const raw = await readKey(page, KEY_V2);
  return raw == null ? null : JSON.parse(raw);
}

async function readKey(page, key) {
  return page.evaluate((k) => localStorage.getItem(k), key);
}

async function readDrafts(page) {
  return JSON.parse((await readKey(page, KEY_DRAFTS)) ?? '{}');
}

/** Screenshot into test-results/<engine>/<name>.png. Returns the file path. */
async function shot(name, { page = current, fullPage = true } = {}) {
  const dir = join(RESULTS, engine ?? 'any');
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${name.replace(/[^\w.-]+/g, '-')}.png`);
  await page.screenshot({ path: file, fullPage });
  return file;
}

// ---------------------------------------------------------------------------
// Small helpers for the flows

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const squash = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

/** The element with data-test="name" inside scope (a page or a locator). */
const at = (scope, name) => scope.locator(`[data-test="${name}"]`);

/** Retries an assertion until it passes or `timeout` ms pass (Node's own clock, never the page's). */
async function eventually(check, timeout = 5000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    try {
      return await check();
    } catch (error) {
      if (Date.now() > deadline) throw error;
    }
    await sleep(40);
  }
}

async function textOf(locator) {
  return squash(await locator.textContent({ timeout: 5000 }));
}

async function seeText(locator, expected) {
  await eventually(async () => assert.equal(await textOf(locator), expected));
}

async function seeTextIn(locator, ...parts) {
  await eventually(async () => {
    const text = await textOf(locator);
    for (const part of parts) assert.ok(text.includes(part), `"${part}" not in:\n${text}`);
  });
}

async function seeVisible(locator, message) {
  await eventually(async () => assert.ok(await locator.isVisible(), message ?? `not visible: ${locator}`));
}

async function seeHidden(locator, message) {
  await eventually(async () => assert.ok(!(await locator.isVisible()), message ?? `still visible: ${locator}`));
}

async function seeNone(locator) {
  await eventually(async () => assert.equal(await locator.count(), 0, `still in the page: ${locator}`));
}

async function seePressed(locator, on) {
  await eventually(async () => assert.equal(await locator.getAttribute('aria-pressed'), String(on), `${locator} aria-pressed`));
}

async function htmlAttr(page, name) {
  return page.evaluate((attr) => document.documentElement.getAttribute(attr), name);
}

async function seeHtmlAttr(page, name, value) {
  await eventually(async () => assert.equal(await htmlAttr(page, name), value, `<html ${name}>`));
}

async function tap(scope, name) {
  await at(scope, name).tap();
}

async function seeToast(page, text) {
  await seeText(at(page, 'toast'), text);
  await seeVisible(at(page, 'toast'));
}

/** A point on the backdrop, above an open sheet. */
async function backdropPoint(page, sheetName) {
  const box = await at(page, sheetName).boundingBox();
  assert.ok(box && box.y >= 24, `no backdrop showing above ${sheetName} (sheet top at ${box?.y})`);
  return { x: 195, y: Math.round(box.y / 2) };
}

/** A finger tap on the backdrop above an open sheet. */
async function tapBackdrop(page, sheetName) {
  const { x, y } = await backdropPoint(page, sheetName);
  await page.touchscreen.tap(x, y);
}

/** A mouse click on the backdrop: the same close, without Playwright WebKit's tap-to-click rule (see the sheets tests). */
async function clickBackdrop(page, sheetName) {
  const { x, y } = await backdropPoint(page, sheetName);
  await page.mouse.click(x, y);
}

/** Makes the page think the app went to the background (or came back). */
async function setVisibility(page, state) {
  await page.evaluate((value) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => value === 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

/** "Thursday 22 October", written out here so the app's own formatting is checked. */
function longDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${COPY.weekdayNames[(weekday + 6) % 7]} ${d} ${COPY.monthNames[m - 1]}`;
}

/** Fills {name} placeholders the way content.js means them (arrays fill in order). */
function fill(template, values = {}) {
  const used = {};
  return String(template).replace(/\{(\w+)\}/g, (whole, name) => {
    if (!(name in values)) return whole;
    let value = values[name];
    if (Array.isArray(value)) {
      used[name] = (used[name] ?? -1) + 1;
      value = value[used[name]];
    }
    return String(value);
  });
}

const chapterLine = (n) => fill(COPY.chapterLine, { n, name: CHAPTERS[n - 1].short });
const dayOf = (day) => fill(COPY.chapterDay, { day });
const reentryLines = (bucket, n) => REENTRY[bucket].map((line) => fill(line, { n }));
const IDEA_TEXTS = IDEAS.map((idea) => idea.text);
const STARTER_TEXTS = STARTERS.map((starter) => starter.text);
const monthCount = (n, month = 'October') =>
  n === 0 ? COPY.monthEmpty : n === 1 ? fill(COPY.monthCountOne, { month }) : fill(COPY.monthCount, { n, month });

// The tap rule from the spec, written out on its own.
const tapRule = (pages, slot) => (pages >= slot ? slot - 1 : slot);

// ---------------------------------------------------------------------------
// Saved data to start from

function chapterData(fields = {}) {
  return {
    startedOn: null,
    finishedOn: null,
    read: false,
    legacy: null,
    ...fields,
    artistDate: { plan: '', ideaId: null, doneOn: null, note: '', ...fields.artistDate },
    checkin: { doneOn: null, lineUp: '', matters: '', ...fields.checkin },
  };
}

/** A complete v2 state. chapters: { num: fields }, days: { key: { pages, keep } }. */
function v2State({ chapter = 1, chapters = {}, days = {}, settings = {}, seen = {}, legacyV1 = null } = {}) {
  return {
    version: 2,
    createdAt: '2026-09-01T06:40:00.000Z',
    course: { chapter },
    chapters: Object.fromEntries(Object.entries(chapters).map(([num, fields]) => [String(num), chapterData(fields)])),
    days,
    settings: { theme: 'system', minutes: 25, bell: true, rain: false, accent: 'chapter', ...settings },
    seen: { starters: [], ideas: [], ...seen },
    legacyV1,
  };
}

/** On chapter `num`, started on `startedOn` (two days ago by default). `fields` adds to that chapter. */
function onChapter(num, { startedOn = D(-2), fields = {}, chapters = {}, ...rest } = {}) {
  return v2State({ ...rest, chapter: num, chapters: { ...chapters, [num]: { startedOn, ...fields } } });
}

/** { key: pages } to stored days. */
function pagesDays(map) {
  return Object.fromEntries(Object.entries(map).map(([key, pages]) => [key, { pages, keep: '' }]));
}

// The old app's save: all twelve weeks, days ticked without dates.
function v1Week(days = [], artistDate = false, artistDateNote = '') {
  return { days: Array.from({ length: 7 }, (_, i) => Boolean(days[i])), artistDate, artistDateNote };
}
const V1 = {
  weeks: {
    ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [String(i + 1), v1Week()])),
    1: v1Week([1, 1, 1, 1, 1, 1, 1], true, 'Walked the harbour with a sketchbook.'),
    2: v1Week([1, 1, 0, 1, 1, 0, 1], false, ''),
    3: v1Week([1, 0, 1], true, 'Botanical garden on a grey Sunday. · Take five euros to a flea market.'),
  },
  openWeeks: [3],
  quoteIndex: 7,
  theme: 'dark',
};

// ---------------------------------------------------------------------------
// Service worker helpers (from the smoke tests)

// Files in public/ that are deliberately not precached. Everything else in
// public/ must be in SHELL in public/sw.js, or it is missing offline.
const NOT_PRECACHED = new Set(['sw.js', 'fonts/OFL.txt']);

// VERSION and the SHELL list, read from the source of public/sw.js.
async function readWorker() {
  const source = await readFile(join(PUBLIC, 'sw.js'), 'utf8');
  const version = source.match(/const VERSION = '([^']+)'/)?.[1];
  const list = source.match(/const SHELL = \[([\s\S]*?)\];/)?.[1];
  const shell = list ? [...list.matchAll(/'([^']+)'/g)].map((match) => match[1]) : null;
  return { version, shell };
}

// Every file in public/, as paths relative to it ('fonts/fonts.css').
async function publicFiles(dir = PUBLIC, prefix = '') {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory()) files.push(...(await publicFiles(join(dir, entry.name), `${prefix}${entry.name}/`)));
    else files.push(`${prefix}${entry.name}`);
  }
  return files;
}

// Waits (up to 10 s) for an activated service worker for this page.
async function activeWorker(page) {
  const ready = page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    const worker = registration.active;
    if (worker.state !== 'activated') {
      await new Promise((resolve) =>
        worker.addEventListener('statechange', () => worker.state === 'activated' && resolve()),
      );
    }
    return { scope: registration.scope, script: worker.scriptURL };
  });
  const timeout = sleep(10_000).then(() => {
    throw new Error('no active service worker after 10 s (is sw.js registered? does every SHELL file exist?)');
  });
  return Promise.race([ready, timeout]);
}

/** The app, already controlled by its service worker (so an update can take over). */
async function controlledApp(options) {
  const page = await app({ ...options, sw: true });
  await activeWorker(page);
  await page.reload();
  await eventually(async () => assert.ok(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)), 'controlled'));
  await page.evaluate(() => {
    window.__sameDocument = true;
  });
  return page;
}

/** What a new worker taking over looks like to the page. */
async function fireUpdate(page) {
  await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new Event('controllerchange')));
}

async function sameDocument(page) {
  return page.evaluate(() => window.__sameDocument === true);
}

// Small helpers for the smoke tests.

function contentType(response) {
  return (response.headers()['content-type'] ?? '').split(';')[0].trim();
}

// Width, height and colour type from a PNG header (colour type 2 = RGB, no alpha).
function pngHeader(bytes) {
  if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colourType: bytes[25] };
}

function typeFromName(path) {
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.svg')) return 'image/svg+xml';
  return null;
}

// ---------------------------------------------------------------------------
// Flow helpers

/** Today's slots, status line, keep field and month count for n pages (prefix "w-" checks the writing screen's slots). */
async function seePages(page, n, { prefix = '', monthTotal = n } = {}) {
  await eventually(async () => {
    for (let k = 1; k <= 3; k += 1) {
      assert.equal(await at(page, `${prefix}page-slot-${k}`).getAttribute('aria-pressed'), String(k <= n), `${prefix}page-slot-${k} at ${n}`);
    }
  });
  await eventually(async () => assert.equal((await readState(page)).days[TODAY]?.pages ?? 0, n, 'saved pages'));
  if (prefix) return;
  if (n === 0) {
    await seeNone(at(page, 'pages-count'));
    await seeNone(at(page, 'done-line'));
  } else if (n < 3) {
    await seeText(at(page, 'pages-count'), fill(COPY.pagesPartial, { n }));
    await seeNone(at(page, 'done-line'));
  } else {
    await eventually(async () => assert.ok(DONE_LINES.includes(await textOf(at(page, 'done-line')))));
    await seeNone(at(page, 'pages-count'));
  }
  await (n === 3 ? seeHidden : seeVisible)(at(page, 'start-writing'));
  await seeText(at(page, 'month-count'), monthCount(monthTotal));
  await eventually(async () =>
    assert.equal(await at(page, `week-day-${TODAY}`).getAttribute('aria-label'), fill(COPY.dayAria, { date: longDate(TODAY), n })),
  );
}

/** Book row status from its class (current, done, upcoming). */
async function rowStatus(page, n) {
  const classes = ((await at(page, `book-row-${n}`).getAttribute('class')) ?? '').split(/\s+/);
  const found = ['current', 'done', 'upcoming'].filter((status) => classes.includes(status));
  return found.length === 1 ? found[0] : `unclear (${classes.join(' ')})`;
}

/** The data-accent that applies to an element: its own or its nearest ancestor's. */
async function accentOf(locator) {
  return locator.evaluate((el) => el.closest('[data-accent]')?.getAttribute('data-accent') ?? null);
}

/** Visible buttons with a filled background, and outlined ones, by data-test (or text). */
async function buttonFills(page) {
  return page.evaluate(() => {
    const rgba = (value) => {
      const parts = value.match(/[\d.]+/g)?.map(Number) ?? [];
      return parts.length >= 3 ? { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 } : null;
    };
    const paper = rgba(getComputedStyle(document.body).backgroundColor);
    const differs = (c) => c && c.a > 0.5 && (!paper || Math.abs(c.r - paper.r) + Math.abs(c.g - paper.g) + Math.abs(c.b - paper.b) > 30);
    const filled = [];
    const outlined = [];
    for (const button of document.querySelectorAll('button')) {
      const box = button.getBoundingClientRect();
      const style = getComputedStyle(button);
      if (!box.width || !box.height || style.visibility === 'hidden' || button.closest('[hidden], [aria-hidden="true"]')) continue;
      const name = button.getAttribute('data-test') ?? button.textContent.trim();
      if (differs(rgba(style.backgroundColor))) filled.push(name);
      else if ((style.boxShadow && style.boxShadow !== 'none') || parseFloat(style.borderTopWidth) > 0) outlined.push(name);
    }
    return { filled, outlined };
  });
}

// ---------------------------------------------------------------------------
// Engine-independent checks (run once)

test('smoke: the precache list in sw.js matches the files in public/', async () => {
  const { version, shell } = await readWorker();
  assert.ok(version, 'public/sw.js has a VERSION constant');
  assert.ok(shell?.length, 'public/sw.js has a SHELL list');
  const all = await publicFiles();
  const missing = all.filter((file) => !NOT_PRECACHED.has(file) && !shell.includes(file));
  const stale = shell.filter((file) => !all.includes(file));
  assert.deepEqual(missing, [], 'files in public/ that SHELL in public/sw.js leaves out: add them and bump VERSION');
  assert.deepEqual(stale, [], 'SHELL in public/sw.js names files that are not in public/: the install would fail');
});

// ---------------------------------------------------------------------------
// Every engine

/** A note (a todo or a skip reason) that applies on WebKit only. */
const onWebKit = (note) => (defining === 'webkit' ? note : undefined);

for (const name of ENGINES) {
  describe(name, () => {
    defining = name;
    before(async () => {
      engine = name;
      if (name === 'webkit') allowUnknownWebKitSettings();
      browser = await LAUNCHERS[name].launch({
        headless: !process.env.HEADED,
        slowMo: Number(process.env.SLOWMO) || 0,
      });
    });

    afterEach(async () => {
      for (const context of contexts) await context.close().catch(() => {});
      contexts.clear();
      opened.length = 0;
      current = null;
    });

    after(async () => {
      await browser?.close();
      browser = null;
    });

    smokeTests();
    startTests();
    reentryTests();
    pageTests();
    backfillTests();
    sheetTests();
    phoneTests();
    artistTests();
    checkinTests();
    bookTests();
    keptTests();
    settingsTests();
    backupTests();
    storageTests();
    writingTests();
    updateTests();
    dateTests();
  });
}

// ---------------------------------------------------------------------------
// Smoke

function smokeTests() {
  e2e('smoke: the app loads at phone size, with no errors and no third-party requests', async () => {
    const page = await open({ today: TODAY });
    await page.waitForLoadState('networkidle');

    assert.equal(await page.title(), APP_NAME);
    const viewport = await page.evaluate(() => ({ width: innerWidth, dpr: devicePixelRatio }));
    assert.deepEqual(viewport, { width: 390, dpr: 3 });

    const origin = new URL(base).origin;
    const foreign = requestsOf(page).filter((href) => /^https?:/.test(href) && new URL(href).origin !== origin);
    assert.deepEqual(foreign, [], 'requests that left the app');

    await shot('smoke-today');
  });

  e2e('smoke: the manifest and every icon are served with the right type', async () => {
    const page = await open();
    const http = page.context().request;

    const manifestHref = await page.getAttribute('link[rel="manifest"]', 'href');
    assert.ok(manifestHref, 'index.html links a manifest');
    const manifestUrl = new URL(manifestHref, page.url()).href;
    const manifestResponse = await http.get(manifestUrl);
    assert.equal(manifestResponse.status(), 200, manifestUrl);
    assert.match(contentType(manifestResponse), /^application\/(manifest\+)?json$/);
    const manifest = await manifestResponse.json();
    assert.equal(manifest.name, APP_NAME);
    assert.equal(manifest.short_name, APP_NAME);
    assert.equal(manifest.display, 'standalone');

    // Icons named by the manifest plus the ones index.html links (apple-touch-icon, favicon).
    const icons = new Map();
    for (const icon of manifest.icons) icons.set(new URL(icon.src, manifestUrl).href, icon);
    const links = await page.$$eval('link[rel~="icon"], link[rel="apple-touch-icon"]', (elements) =>
      elements.map((link) => ({ href: link.href, rel: link.rel, type: link.type })),
    );
    assert.ok(links.some((link) => link.rel === 'apple-touch-icon'), 'index.html links an apple-touch-icon');
    for (const link of links) if (!icons.has(link.href)) icons.set(link.href, { type: link.type || undefined, rel: link.rel });

    for (const [href, icon] of icons) {
      const response = await http.get(href);
      assert.equal(response.status(), 200, href);
      const expected = icon.type || typeFromName(new URL(href).pathname);
      assert.equal(contentType(response), expected, `content type of ${href}`);
      if (expected !== 'image/png') continue;
      const png = pngHeader(await response.body());
      assert.ok(png, `${href} is a PNG`);
      if (icon.sizes) assert.equal(`${png.width}x${png.height}`, icon.sizes, `size of ${href}`);
      if (icon.rel === 'apple-touch-icon') {
        assert.deepEqual([png.width, png.height], [180, 180], 'apple-touch-icon is 180x180');
        assert.equal(png.colourType, 2, 'apple-touch-icon has no alpha channel');
      }
    }
    assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable'), 'the manifest has a maskable icon');
  });

  e2e('smoke: the self-hosted fonts load', async () => {
    const fontResponses = [];
    const page = await open({ today: TODAY });
    const http = page.context().request;

    const cssUrl = url('/fonts/fonts.css');
    const cssResponse = await http.get(cssUrl);
    assert.equal(cssResponse.status(), 200);
    assert.equal(contentType(cssResponse), 'text/css');
    const css = await cssResponse.text();
    const files = [...css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map((match) => new URL(match[1], cssUrl).href);
    assert.ok(files.length >= 2, 'fonts.css names the woff2 files');
    for (const href of files) {
      const response = await http.get(href);
      assert.equal(response.status(), 200, href);
      assert.equal(contentType(response), 'font/woff2', href);
      assert.equal((await response.body()).subarray(0, 4).toString('latin1'), 'wOF2', `${href} is woff2`);
    }

    // The page itself pulls fonts.css in and the browser loads the faces from it.
    page.on('response', (response) => {
      if (response.url().endsWith('.woff2')) fontResponses.push(response.status());
    });
    await page.reload();
    const faces = await page.evaluate(async () => {
      await document.fonts.ready;
      const loaded = await document.fonts.load('700 20px "Schibsted Grotesk"', 'Aa');
      return {
        linked: [...document.styleSheets].some((sheet) => (sheet.href || '').endsWith('/fonts/fonts.css')),
        loaded: loaded.map((face) => face.status),
        weight: loaded[0]?.weight,
        family: getComputedStyle(document.body).fontFamily,
      };
    });
    assert.ok(faces.linked, 'the page links fonts/fonts.css');
    assert.ok(faces.loaded.length > 0 && faces.loaded.every((status) => status === 'loaded'), 'Schibsted Grotesk loaded');
    assert.equal(faces.weight, '400 900');
    assert.match(faces.family, /Schibsted Grotesk/, 'the body text uses Schibsted Grotesk');
    assert.ok(fontResponses.length > 0 && fontResponses.every((status) => status === 200), 'woff2 requests answered 200');
  });

  e2e('smoke: the service worker installs, controls the page after a reload and serves it offline', async () => {
    const { version, shell } = await readWorker();
    assert.ok(version && shell, 'public/sw.js has VERSION and SHELL');

    const page = await open({ today: TODAY });
    const worker = await activeWorker(page);
    assert.equal(new URL(worker.script).pathname, '/sw.js');
    assert.equal(worker.scope, `${new URL(base).origin}/`);

    await page.waitForLoadState('load');
    await page.reload();
    const controller = await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null);
    assert.ok(controller, 'a service worker controls the page after a reload');
    assert.equal(new URL(controller).pathname, '/sw.js');

    // One cache, named for this version, holding every SHELL file.
    const cacheEntries = await page.evaluate(async () => {
      const out = {};
      for (const cacheName of await caches.keys()) {
        const cache = await caches.open(cacheName);
        out[cacheName] = (await cache.keys()).map((request) => new URL(request.url).pathname);
      }
      return out;
    });
    assert.deepEqual(Object.keys(cacheEntries), [`artists-way-${version}`]);
    const cached = new Set(cacheEntries[`artists-way-${version}`]);
    assert.deepEqual(shell.filter((file) => !cached.has(`/${file}`)), [], 'SHELL files missing from the cache');

    // Offline: the page must come from the cache. Chromium goes offline and no request may
    // reach the server. Playwright's offline mode breaks every WebKit navigation, worker or
    // not ("WebKit encountered an internal error"), so on WebKit the server drops every
    // connection instead, which is what a phone without a network sees.
    let hits = 0;
    const countHit = () => hits++;
    const dropConnection = (request) => request.socket.destroy();
    const realOffline = engine !== 'webkit';
    if (realOffline) server.on('request', countHit);
    else server.prependListener('request', dropConnection);
    if (realOffline) await page.context().setOffline(true);
    try {
      await page.reload();
      await page.waitForLoadState('load');
      assert.equal(await page.title(), APP_NAME);
      if (realOffline) assert.equal(hits, 0, 'requests reached the server while offline');
      const offline = await page.evaluate(() => ({
        app: !!document.getElementById('app'),
        font: [...document.fonts].some((face) => face.family.replace(/"/g, '') === 'Schibsted Grotesk' && face.status === 'loaded'),
      }));
      assert.ok(offline.app, 'the app shell rendered offline');
      assert.ok(offline.font, 'the font loaded offline');
      await seeVisible(at(page, 'pickup'));
      await shot('smoke-offline');
    } finally {
      server.off('request', countHit);
      server.off('request', dropConnection);
      if (realOffline) await page.context().setOffline(false);
    }
  });
}

// ---------------------------------------------------------------------------
// Fresh install, v1 migration, pick-up and the week chooser

function startTests() {
  e2e('fresh install: the pick-up card offers week 1 today and nothing is invented', async () => {
    const page = await app();
    await seeVisible(at(page, 'pickup'));
    await seeTextIn(at(page, 'pickup'), PICKUP.freshTitle, PICKUP.freshLine);
    await seeText(at(page, 'pickup-start'), fill(PICKUP.start, { n: 1 }));
    await seeText(at(page, 'pickup-choose'), PICKUP.choose);
    await seeNone(at(page, 'chapter-line'));
    await seeHidden(at(page, 'reentry'));
    await seeText(at(page, 'month-count'), COPY.monthEmpty);
    assert.ok(IDEA_TEXTS.includes(await textOf(at(page, 'artist-idea'))), 'an idea from the deck');
    await seeText(page.getByRole('heading', { level: 1 }), longDate(TODAY));
    assert.equal(await page.getByText(/preview states/i).count(), 0, 'no mockup-only links');
    assert.equal(await htmlAttr(page, 'data-accent'), CHAPTER_ACCENTS[1]);
    assert.equal(await htmlAttr(page, 'data-theme'), null);

    // Boot saved a fresh v2 state straight away; nothing under the old key.
    const saved = await readState(page);
    assert.equal(saved.version, 2);
    assert.equal(saved.course.chapter, 1);
    assert.deepEqual(saved.chapters, {});
    assert.deepEqual(saved.days, {});
    assert.equal(saved.legacyV1, null);
    assert.deepEqual(saved.settings, { theme: 'system', minutes: 25, bell: true, rain: false, accent: 'chapter' });
    assert.equal(await readKey(page, KEY_V1), null);
    await shot('fresh-pickup');

    await tap(page, 'pickup-start');
    await seeNone(at(page, 'pickup'));
    await seeText(at(page, 'chapter-line'), chapterLine(1));
    await seeVisible(page.getByText(CHAPTERS[0].title, { exact: true }));
    await seeVisible(page.getByText(dayOf(1), { exact: true }));
    assert.equal((await readState(page)).chapters['1'].startedOn, TODAY);
    // No pages on any date yet: the "never" re-entry line.
    await seeVisible(at(page, 'reentry'));
    assert.ok(reentryLines('never').includes(await textOf(at(page, 'reentry'))));

    await tap(page, 'nav-kept');
    await seeVisible(at(page, 'kept-empty'));
    await tap(page, 'nav-book');
    assert.equal(await rowStatus(page, 1), 'current');
    for (let n = 2; n <= 12; n += 1) assert.equal(await rowStatus(page, n), 'upcoming', `row ${n}`);

    await page.reload();
    await seeText(at(page, 'chapter-line'), chapterLine(1));
    await seeNone(at(page, 'pickup'));
  });

  e2e('today: Start writing is the one filled button; Start week n today is outlined', async () => {
    for (const theme of ['light', 'dark']) {
      const page = await app({ theme });
      await seeVisible(at(page, 'pickup-start'));
      let fills = await buttonFills(page);
      assert.deepEqual(fills.filled, ['start-writing'], `${theme}, pick-up: filled buttons`);
      assert.ok(fills.outlined.includes('pickup-start'), `${theme}: Start week 1 today is outlined (${fills.outlined})`);

      await tap(page, 'pickup-start');
      await seeText(at(page, 'chapter-line'), chapterLine(1));
      fills = await buttonFills(page);
      assert.deepEqual(fills.filled, ['start-writing'], `${theme}, started: filled buttons`);
    }
  });

  e2e('v1 migration: old ticks land on their weeks and the v1 key is left alone', async () => {
    const page = await app({ v1: V1 });
    await seeVisible(at(page, 'pickup'));
    await seeTextIn(at(page, 'pickup'), fill(PICKUP.title, { n: 3 }), PICKUP.lineMoved);
    await seeText(at(page, 'pickup-start'), fill(PICKUP.start, { n: 3 }));
    await seeHtmlAttr(page, 'data-accent', CHAPTER_ACCENTS[3]);
    // v1's theme was UI state; it isn't carried over.
    assert.equal(await htmlAttr(page, 'data-theme'), null);

    const saved = await readState(page);
    assert.equal(saved.course.chapter, 3);
    assert.deepEqual(saved.days, {}, 'no pages invented on real dates');
    assert.deepEqual(saved.legacyV1, V1);
    assert.deepEqual(Object.keys(saved.chapters).sort(), ['1', '2', '3']);
    assert.deepEqual(saved.chapters['1'].legacy, { mornings: 7, artistDate: true });
    assert.deepEqual(saved.chapters['2'].legacy, { mornings: 5, artistDate: false });
    assert.deepEqual(saved.chapters['3'].legacy, { mornings: 2, artistDate: true });
    assert.equal(saved.chapters['1'].artistDate.note, V1.weeks[1].artistDateNote);
    assert.equal(saved.chapters['3'].startedOn, null);
    assert.equal(await readKey(page, KEY_V1), JSON.stringify(V1), 'the v1 key is untouched');

    await tap(page, 'nav-book');
    await seeVisible(page.getByText(COPY.migratedNote));
    assert.equal(await rowStatus(page, 1), 'done');
    assert.equal(await rowStatus(page, 2), 'done');
    assert.equal(await rowStatus(page, 3), 'current');
    for (let n = 4; n <= 12; n += 1) assert.equal(await rowStatus(page, n), 'upcoming', `row ${n}`);
    await seeTextIn(at(page, 'book-row-1'), fill(COPY.countMornings, { n: 7 }), COPY.artistDateDone);
    await seeTextIn(at(page, 'book-row-2'), fill(COPY.countMornings, { n: 5 }));
    assert.ok(!(await textOf(at(page, 'book-row-2'))).includes(COPY.artistDateDone));
    await seeTextIn(at(page, 'book-row-3'), COPY.statusCurrent, fill(COPY.countMornings, { n: 2 }));
    await shot('v1-book');

    await tap(page, 'book-row-1');
    await seeVisible(at(page, 'chapter-page'));
    await seeTextIn(at(page, 'chapter-page'), fill(COPY.legacyMornings, { n: 7 }), COPY.artistDateDone);
  });

  e2e('v1 migration: pick up at the suggested week, and the old data is never migrated twice', async () => {
    const page = await app({ v1: V1 });
    await tap(page, 'pickup-start');
    await seeText(at(page, 'chapter-line'), chapterLine(3));
    await seeVisible(page.getByText(dayOf(1), { exact: true }));
    const saved = await readState(page);
    assert.equal(saved.chapters['3'].startedOn, TODAY);
    assert.deepEqual(saved.chapters['3'].legacy, { mornings: 2, artistDate: true });

    await page.reload();
    await seeText(at(page, 'chapter-line'), chapterLine(3));
    await seeNone(at(page, 'pickup'));
    assert.deepEqual(await readState(page), saved, 'a reload reads v2, it does not migrate v1 again');
    assert.equal(await readKey(page, KEY_V1), JSON.stringify(V1));
  });

  e2e('v1 migration: the week chooser starts any week today', async () => {
    const page = await app({ v1: V1 });
    await tap(page, 'pickup-choose');
    const sheet = at(page, 'chooser-sheet');
    await seeVisible(sheet);
    assert.equal(await sheet.getAttribute('role'), 'dialog');
    await seeVisible(page.getByRole('dialog', { name: PICKUP.chooseTitle }));
    for (let n = 1; n <= 12; n += 1) {
      const tile = at(page, `week-choose-${n}`);
      assert.equal(await accentOf(tile), CHAPTER_ACCENTS[n], `tile ${n} colour`);
      assert.equal(await tile.getAttribute('aria-current'), n === 3 ? 'true' : null, `tile ${n} suggested`);
    }

    // Escape changes nothing.
    await page.keyboard.press('Escape');
    await seeNone(sheet);
    await seeVisible(at(page, 'pickup'));
    assert.equal((await readState(page)).chapters['3'].startedOn, null);

    await tap(page, 'pickup-choose');
    await tap(page, 'week-choose-5');
    await seeNone(sheet);
    await seeText(at(page, 'chapter-line'), chapterLine(5));
    await seeHtmlAttr(page, 'data-accent', CHAPTER_ACCENTS[5]);
    const saved = await readState(page);
    assert.equal(saved.course.chapter, 5);
    assert.equal(saved.chapters['5'].startedOn, TODAY);
    assert.equal(saved.chapters['3'].startedOn, null);

    await tap(page, 'nav-book');
    assert.equal(await rowStatus(page, 3), 'done', 'a touched week below the current one counts as done');
    assert.equal(await rowStatus(page, 4), 'upcoming', 'an untouched week stays upcoming');
    assert.equal(await rowStatus(page, 5), 'current');
  });

  e2e('v1 migration: an artist date ticked in the old app shows as done, without a date', async () => {
    const page = await app({ v1: V1 });
    await tap(page, 'pickup-start');
    const card = at(page, 'artist-card');
    await seeVisible(at(page, 'artist-note'));
    await seeTextIn(card, COPY.legacyArtistDate);
    assert.ok(!(await textOf(card)).includes(fill(COPY.artistDoneOn, { date: '' }).trim()), 'no done date is invented');
    assert.equal(await at(page, 'artist-note').inputValue(), V1.weeks[3].artistDateNote);
    await seeNone(at(page, 'artist-did'));

    await card.getByRole('button', { name: COPY.artistUndo }).tap();
    await seeVisible(at(page, 'artist-plan'));
    const saved = await readState(page);
    assert.equal(saved.chapters['3'].legacy.artistDate, false);
    assert.equal(saved.chapters['3'].artistDate.doneOn, null);
    assert.equal(saved.chapters['3'].artistDate.note, V1.weeks[3].artistDateNote, 'the note stays');
  });

  e2e('stored data: v2 wins over v1, and unreadable data never stops the app', async () => {
    // Both keys: v2 is read, v1 is left alone and not migrated.
    let page = await app({ v1: V1, v2: onChapter(6) });
    await seeText(at(page, 'chapter-line'), chapterLine(6));
    await seeNone(at(page, 'pickup'));
    assert.equal((await readState(page)).legacyV1, null);
    assert.equal(await readKey(page, KEY_V1), JSON.stringify(V1));

    // Garbage under v2 and nothing else: a fresh start.
    page = await app({ v2: '{"version": 2, "course": {' });
    await seeTextIn(at(page, 'pickup'), PICKUP.freshTitle);

    // Garbage under v2, a good v1: old data beats no data.
    page = await app({ v2: 'not json at all', v1: V1 });
    await seeTextIn(at(page, 'pickup'), fill(PICKUP.title, { n: 3 }), PICKUP.lineMoved);

    // Odd but valid v2: out-of-range numbers are clamped, bad dates dropped.
    const odd = onChapter(4, { days: { [D(-1)]: { pages: 9, keep: '' }, 'not-a-date': { pages: 2, keep: '' } } });
    page = await app({ v2: odd });
    await seeText(at(page, 'chapter-line'), chapterLine(4));
    await eventually(async () =>
      assert.equal(await at(page, `week-day-${D(-1)}`).getAttribute('aria-label'), fill(COPY.dayAria, { date: longDate(D(-1)), n: 3 })),
    );
  });
}

// ---------------------------------------------------------------------------
// Re-entry after a gap

function reentryTests() {
  const gaps = [
    { title: 'a 2-day gap says nothing', last: -2, bucket: null },
    { title: 'a 3-day gap', last: -3, bucket: 'days' },
    { title: 'a 9-day gap', last: -9, bucket: 'week' },
    { title: 'a 30-day gap', last: -30, bucket: 'weeks' },
    { title: 'no dated pages yet', last: null, bucket: 'never' },
  ];
  for (const gap of gaps) {
    e2e(`re-entry: ${gap.title}`, async () => {
      const days = gap.last === null ? {} : pagesDays({ [D(gap.last)]: 2, [D(gap.last - 1)]: 3 });
      const page = await app({ v2: onChapter(2, { startedOn: D(-40), days }) });
      await seeText(at(page, 'chapter-line'), chapterLine(2));
      const line = at(page, 'reentry');
      if (!gap.bucket) {
        await seeHidden(line);
        assert.equal(await line.getAttribute('aria-hidden'), 'true');
        return;
      }
      await seeVisible(line);
      assert.equal(await line.getAttribute('aria-hidden'), 'false');
      const shown = await textOf(line);
      const expected = reentryLines(gap.bucket, gap.last === null ? null : -gap.last);
      assert.ok(expected.includes(shown), `"${shown}" is one of:\n${expected.join('\n')}`);
      // The same line all day: a reload shows the same variant.
      await page.reload();
      await seeText(line, shown);
    });
  }

  e2e('re-entry: marking a page fades the line in place; it closes up once the screen is quiet and stays closed', async () => {
    const page = await app({ v2: onChapter(2, { startedOn: D(-20), days: pagesDays({ [D(-9)]: 3 }) }), clock: T0 });
    const line = at(page, 'reentry');
    const slot = at(page, 'page-slot-1');
    await seeVisible(line);
    const before = await slot.boundingBox();

    await slot.tap();
    await seeHidden(line);
    assert.equal(await line.getAttribute('aria-hidden'), 'true');
    const fading = await slot.boundingBox();
    assert.ok(Math.abs(fading.y - before.y) < 1, `the slots stay under the thumb (${before.y} -> ${fading.y})`);

    // Unmarking before it closes brings the line back where it was.
    await slot.tap();
    await seeVisible(line);
    assert.ok(Math.abs((await slot.boundingBox()).y - before.y) < 1);

    // Marked again and left alone, the space closes up.
    await slot.tap();
    await seeHidden(line);
    await page.clock.runFor(10_000);
    await eventually(async () => {
      const closed = await slot.boundingBox();
      assert.ok(closed.y < before.y - 10, `the space closed up (${before.y} -> ${closed.y})`);
    });

    // Closed for the rest of this visit, even if the page is unmarked.
    await slot.tap();
    await seePages(page, 0, { monthTotal: 3 });
    await page.clock.runFor(500);
    await seeHidden(line);

    // Next visit with no page today: the line is back. With a page: gone.
    await page.reload();
    await seeVisible(line);
    await slot.tap();
    await page.reload();
    await seeHidden(line);
  });
}

// ---------------------------------------------------------------------------
// Morning pages

function pageTests() {
  // Every (pages, slot) pair once: from 0, 1, 2 and 3 pages, a tap on slot 1, 2 and 3.
  const path = [1, 2, 3, 1, 2, 1, 3, 2, 3, 3, 2, 1];

  e2e('page slots: every tap from every count follows the tap rule', async () => {
    const page = await app({ v2: onChapter(4) });
    await seePages(page, 0);
    await seeTextIn(page.locator('body'), COPY.pagesHint);
    await seeHidden(at(page, 'keep-input'));

    const seen = new Set();
    let pages = 0;
    for (const slot of path) {
      const next = tapRule(pages, slot);
      seen.add(`${pages}:${slot}`);
      await at(page, `page-slot-${slot}`).tap();
      await seePages(page, next);
      if (next === 3) await seeVisible(at(page, 'keep-input'));
      pages = next;
    }
    assert.equal(seen.size, 12, 'all twelve (count, slot) pairs were tapped');
    assert.equal(pages, 0);
  });

  e2e('writing screen: its page slots follow the same rule, and Today shows the result', async () => {
    const page = await app({ v2: onChapter(4) });
    await tap(page, 'start-writing');
    await seeVisible(at(page, 'writing'));
    let pages = 0;
    for (const slot of [2, 2, 3, 1, 3]) {
      const next = tapRule(pages, slot);
      await at(page, `w-page-slot-${slot}`).tap();
      await seePages(page, next, { prefix: 'w-' });
      pages = next;
    }
    assert.equal(pages, 3);
    // The writing screen shows the same done line as Today.
    await seeTextIn(at(page, 'writing'), await textOf(at(page, 'done-line')));
    await tap(page, 'writing-done');
    await seeHidden(at(page, 'writing'));
    await seePages(page, 3);
  });

  e2e('keep line: shows after three pages, saves on Enter, and lands in Kept', async () => {
    const page = await app({ v2: onChapter(4) });
    await tap(page, 'page-slot-3');
    const keep = at(page, 'keep-input');
    await seeVisible(keep);
    await keep.fill('The light on the canal at seven.');
    await keep.press('Enter');
    await eventually(async () => assert.equal((await readState(page)).days[TODAY].keep, 'The light on the canal at seven.'));
    await seeVisible(page.getByText(COPY.keepSaved, { exact: true }));

    // Unmarking pages keeps the line (and its field).
    await tap(page, 'page-slot-1');
    await seePages(page, 0);
    await seeVisible(keep);
    assert.equal((await readState(page)).days[TODAY].keep, 'The light on the canal at seven.');

    await tap(page, 'nav-kept');
    await seeTextIn(at(page, 'kept-list'), 'The light on the canal at seven.', longDate(TODAY));
  });
}

// ---------------------------------------------------------------------------
// The week strip and backfill

function backfillTests() {
  e2e('backfill: a past day opens a sheet with 0 to 3, and the choice is saved', async () => {
    const page = await app({ v2: onChapter(4, { startedOn: D(-3) }) });
    const cell = at(page, `week-day-${D(-2)}`);
    assert.equal(await cell.evaluate((el) => el.tagName), 'BUTTON');
    assert.equal(await cell.getAttribute('aria-label'), fill(COPY.dayAria, { date: longDate(D(-2)), n: 0 }));

    await cell.tap();
    const sheet = at(page, 'backfill-sheet');
    await seeVisible(sheet);
    assert.equal(await sheet.getAttribute('role'), 'dialog');
    assert.equal(await sheet.getAttribute('aria-modal'), 'true');
    await seeVisible(page.getByRole('dialog', { name: fill(COPY.backfillTitle, { date: longDate(D(-2)) }) }));
    await seeTextIn(sheet, COPY.backfillSub);
    for (let v = 0; v <= 3; v += 1) await seePressed(at(page, `backfill-${v}`), v === 0);
    assert.ok(await at(page, 'nav-today').evaluate((el) => Boolean(el.closest('[inert]'))), 'the screen under a sheet is inert');

    await tap(page, 'backfill-2');
    await seeNone(sheet);
    assert.ok(!(await at(page, 'nav-today').evaluate((el) => Boolean(el.closest('[inert]')))));
    assert.deepEqual((await readState(page)).days[D(-2)], { pages: 2, keep: '' });
    await eventually(async () => assert.equal(await cell.getAttribute('aria-label'), fill(COPY.dayAria, { date: longDate(D(-2)), n: 2 })));
    await seeText(at(page, 'month-count'), monthCount(2));

    // Open again: 2 is marked. Escape and the close button both leave it as it was.
    await cell.tap();
    await seePressed(at(page, 'backfill-2'), true);
    await page.keyboard.press('Escape');
    await seeNone(sheet);
    await cell.tap();
    await sheet.getByRole('button', { name: COPY.close, exact: true }).tap();
    await seeNone(sheet);
    assert.deepEqual((await readState(page)).days[D(-2)], { pages: 2, keep: '' });

    // None takes the day out again.
    await cell.tap();
    await tap(page, 'backfill-0');
    await seeNone(sheet);
    assert.equal((await readState(page)).days[D(-2)], undefined);
    await seeText(at(page, 'month-count'), COPY.monthEmpty);
  });

  e2e("backfill: today's cell sets today's pages; future days are inert", async () => {
    const page = await app({ v2: onChapter(4, { startedOn: D(-3) }) });
    const todayCell = at(page, `week-day-${TODAY}`);
    assert.equal(await todayCell.getAttribute('aria-current'), 'date');
    await todayCell.tap();
    await seeVisible(page.getByRole('dialog', { name: COPY.backfillTitleToday }));
    await tap(page, 'backfill-3');
    await seePages(page, 3);

    for (const key of [D(1), D(2), D(3)]) {
      const cell = at(page, `week-day-${key}`);
      assert.notEqual(await cell.evaluate((el) => el.tagName), 'BUTTON', `${key} is not a button`);
      await cell.click({ force: true });
      await sleep(250);
      assert.equal(await at(page, 'backfill-sheet').count(), 0, `${key} opened nothing`);
    }
    const days = Object.keys((await readState(page)).days);
    assert.deepEqual(days, [TODAY], 'nothing saved on future dates');
  });

  e2e('backfill: a week across the month end counts only this month', async () => {
    const today = '2026-10-01'; // a Thursday; its week starts Monday 28 September
    const page = await app({ today, v2: onChapter(4, { startedOn: '2026-09-28' }) });
    await seeTextIn(page.locator('body'), fill(COPY.weekRange, { date: ['28 Sep', '4 Oct'] }));
    await at(page, 'week-day-2026-09-29').tap();
    await seeVisible(page.getByRole('dialog', { name: fill(COPY.backfillTitle, { date: 'Tuesday 29 September' }) }));
    await tap(page, 'backfill-3');
    await seeNone(at(page, 'backfill-sheet'));
    assert.equal((await readState(page)).days['2026-09-29'].pages, 3);
    await seeText(at(page, 'month-count'), COPY.monthEmpty);
    await tap(page, 'page-slot-1');
    await seeText(at(page, 'month-count'), monthCount(1));
  });
}

// ---------------------------------------------------------------------------
// Phone details: labels, sizes, live regions

/** Visible controls smaller than 44 wide or 48 tall, and fields under 16px text. */
async function smallControls(page) {
  return page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('button, input, textarea, select, a[href], [role="button"]')) {
      const box = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      // Skip what's hidden, and what's under an open sheet or the writing screen (inert).
      if (!box.width || !box.height || style.visibility === 'hidden' || el.closest('[hidden], [aria-hidden="true"], [inert]')) continue;
      if (el.type === 'file') continue; // sits invisibly inside its labelled button, which is measured instead
      const name = el.getAttribute('data-test') || el.getAttribute('aria-label') || el.textContent.trim().slice(0, 30) || el.tagName;
      const field = ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
      if (box.width < 44 || box.height < (field ? 44 : 48)) out.push(`${name} ${Math.round(box.width)}x${Math.round(box.height)}`);
    }
    for (const label of document.querySelectorAll('label.file-btn')) {
      const box = label.getBoundingClientRect();
      if (box.height && box.height < 48) out.push(`${label.textContent.trim()} ${Math.round(box.width)}x${Math.round(box.height)}`);
    }
    return out;
  });
}

function phoneTests() {
  e2e('phone details: fields are labelled, at least 16px, page counts are announced, no tap flash', async () => {
    const page = await app({ v2: onChapter(4, { startedOn: D(-7) }) });
    const fields = async () =>
      page.evaluate(() =>
        [...document.querySelectorAll('input, textarea')]
          .filter((el) => el.type !== 'file' && el.getClientRects().length && !el.closest('[hidden], [aria-hidden="true"]'))
          .map((el) => ({ test: el.dataset.test, size: parseFloat(getComputedStyle(el).fontSize) })),
      );
    const tested = new Set();
    const checkFields = async () => {
      for (const field of await fields()) {
        assert.ok(field.size >= 16, `${field.test} text is ${field.size}px (iOS zooms in under 16px)`);
        tested.add(field.test);
      }
    };

    await tap(page, 'artist-own-open');
    await seeVisible(page.getByRole('textbox', { name: COPY.ownPlan }));
    assert.equal(await page.getByRole('textbox', { name: COPY.ownPlan }).getAttribute('data-test'), 'artist-own-input');
    await checkFields();

    await tap(page, 'page-slot-3');
    assert.equal(await page.getByRole('textbox', { name: COPY.keepPrompt }).getAttribute('data-test'), 'keep-input');
    assert.equal(await at(page, 'page-slot-1').getAttribute('aria-label'), fill(COPY.pageSlot, { n: 1 }));
    await tap(page, 'page-slot-2');
    assert.equal(await at(page, 'pages-count').evaluate((el) => el.closest('[aria-live]')?.getAttribute('aria-live')), 'polite');
    await tap(page, 'page-slot-3');
    await tap(page, 'artist-plan');
    await tap(page, 'artist-did');
    assert.equal(await page.getByRole('textbox', { name: COPY.artistDoneAsk }).getAttribute('data-test'), 'artist-note');
    await checkFields();

    await tap(page, 'move-on');
    for (const q of CHECKIN.questions) {
      assert.equal(await page.getByRole('textbox', { name: q.q }).getAttribute('data-test'), `checkin-${q.id}`);
    }
    await checkFields();
    for (const name of ['keep-input', 'artist-own-input', 'artist-note', 'checkin-lineUp', 'checkin-matters']) {
      assert.ok(tested.has(name), `${name} was measured`);
    }

    const flash = await page.evaluate(() =>
      [...document.querySelectorAll('button')].map((el) => getComputedStyle(el).webkitTapHighlightColor).filter((c) => c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)),
    );
    assert.deepEqual(flash, [], 'buttons flash grey on tap in iOS Safari');
  });

  e2e(
    'phone details: every control is at least 48px tall (fields 44px) and 44px wide',
    {},
    async () => {
      const page = await app({
        v2: onChapter(4, { startedOn: D(-7), days: { [TODAY]: { pages: 3, keep: '' } }, fields: { artistDate: { plan: 'Gallery', doneOn: TODAY } } }),
      });
      const found = [];
      const look = async (where) => found.push(...(await smallControls(page)).map((item) => `${where}: ${item}`));
      await look('Today');
      await tap(page, 'move-on');
      await look('check-in');
      await page.keyboard.press('Escape');
      await tap(page, 'settings-open');
      await look('settings');
      await page.keyboard.press('Escape');
      await tap(page, 'page-slot-1');
      await tap(page, 'start-writing');
      await look('writing');
      await tap(page, 'writing-done');
      await tap(page, 'nav-book');
      await look('Book');
      await tap(page, 'book-row-6');
      await look('chapter page');
      assert.deepEqual([...new Set(found)], [], 'controls under the minimum size');
    },
  );

  e2e('saving: when storage refuses writes, one quiet notice and the app keeps working', async () => {
    const page = await app({ failWrites: [KEY_V2] });
    await seeToast(page, COPY.storageError);
    await tap(page, 'pickup-start');
    await seeText(at(page, 'chapter-line'), chapterLine(1));
    await tap(page, 'page-slot-2');
    await seeText(at(page, 'pages-count'), fill(COPY.pagesPartial, { n: 2 }));
    assert.equal(await readKey(page, KEY_V2), null);
  });
}

// ---------------------------------------------------------------------------
// Sheets

function sheetTests() {
  e2e(
    'sheets: a finger tap on the backdrop closes each sheet and changes nothing',
    {
      // Not an app bug: Playwright's WebKit (a desktop build) never turns a touch on a plain div
      // into a click when the only click listener is on document. Real Mobile Safari does: on an
      // iPhone 16 simulator (iOS 18.3) a tap on this backdrop closes the sheet. A click listener on
      // the scrim itself would make even this WebKit build close it.
      skip: onWebKit("Playwright WebKit doesn't turn a tap on a plain div into a click; iOS 18.3 Safari does (checked in the Simulator)"),
    },
    async () => {
      const page = await app({ v2: onChapter(4, { startedOn: D(-7) }) });
      const before = await readState(page);
      const sheets = [
        ['backfill-sheet', () => at(page, `week-day-${D(-1)}`).tap()],
        ['checkin-sheet', () => tap(page, 'move-on')],
        ['settings-sheet', () => tap(page, 'settings-open')],
      ];
      for (const [sheet, openIt] of sheets) {
        await openIt();
        await seeVisible(at(page, sheet));
        await tapBackdrop(page, sheet);
        await seeNone(at(page, sheet));
      }
      assert.deepEqual(await readState(page), before);

      const fresh = await app();
      await tap(fresh, 'pickup-choose');
      await seeVisible(at(fresh, 'chooser-sheet'));
      await tapBackdrop(fresh, 'chooser-sheet');
      await seeNone(at(fresh, 'chooser-sheet'));
      await seeVisible(at(fresh, 'pickup'));
    },
  );

  e2e('sheets: the close button and Escape close each sheet; a mouse click on the backdrop does too', async () => {
    const page = await app({ v2: onChapter(4, { startedOn: D(-7) }) });
    const sheets = [
      ['backfill-sheet', () => at(page, `week-day-${D(-1)}`).tap()],
      ['checkin-sheet', () => tap(page, 'move-on')],
      ['settings-sheet', () => tap(page, 'settings-open')],
    ];
    for (const [sheet, openIt] of sheets) {
      await openIt();
      assert.equal(await at(page, sheet).getAttribute('role'), 'dialog');
      assert.equal(await at(page, sheet).getAttribute('aria-modal'), 'true');
      await at(page, sheet).getByRole('button', { name: COPY.close, exact: true }).tap();
      await seeNone(at(page, sheet));
      await openIt();
      await page.keyboard.press('Escape');
      await seeNone(at(page, sheet));
      await openIt();
      await clickBackdrop(page, sheet);
      await seeNone(at(page, sheet));
    }
  });
}

// ---------------------------------------------------------------------------
// Artist date

function artistTests() {
  e2e('artist date: an idea that stays put, Another swaps it, Plan this one plans it', async () => {
    const page = await app({ v2: onChapter(4) });
    const idea = at(page, 'artist-idea');
    const first = await textOf(idea);
    assert.ok(IDEA_TEXTS.includes(first));
    await page.reload();
    await seeText(idea, first);

    await tap(page, 'artist-another');
    await eventually(async () => assert.notEqual(await textOf(idea), first));
    const second = await textOf(idea);
    assert.ok(IDEA_TEXTS.includes(second));
    const secondId = IDEAS.find((item) => item.text === second).id;
    assert.equal((await readState(page)).seen.ideas.at(-1), secondId);

    await tap(page, 'artist-plan');
    await seeVisible(at(page, 'artist-did'));
    await seeVisible(at(page, 'artist-change'));
    await seeNone(idea);
    await seeTextIn(at(page, 'artist-card'), COPY.artistPlanned, second);
    const saved = (await readState(page)).chapters['4'].artistDate;
    assert.equal(saved.plan, second);
    assert.equal(saved.ideaId, secondId);
    assert.equal(saved.doneOn, null);
  });

  e2e('artist date: Write your own sits behind a link, and a half-typed plan is kept as a draft', async () => {
    const page = await app({ v2: onChapter(4) });
    const input = at(page, 'artist-own-input');
    await seeHidden(input);
    await seeVisible(at(page, 'artist-own-open'));
    await tap(page, 'artist-own-open');
    await seeVisible(input);
    await seeNone(at(page, 'artist-own-open'));
    await eventually(async () => assert.equal(await page.evaluate(() => document.activeElement?.dataset.test), 'artist-own-input'));

    await input.fill('Sketch the canal bridges on Saturday');
    assert.equal((await readDrafts(page))['own-4'], 'Sketch the canal bridges on Saturday');
    await page.reload();
    await seeVisible(input);
    assert.equal(await input.inputValue(), 'Sketch the canal bridges on Saturday');

    // An empty Enter does nothing; a real one saves the plan and drops the draft.
    await input.fill('   ');
    await input.press('Enter');
    await seeVisible(at(page, 'artist-plan'));
    await input.fill('Sketch the canal bridges on Saturday');
    await input.press('Enter');
    await seeVisible(at(page, 'artist-did'));
    await seeTextIn(at(page, 'artist-card'), 'Sketch the canal bridges on Saturday');
    let saved = (await readState(page)).chapters['4'].artistDate;
    assert.equal(saved.plan, 'Sketch the canal bridges on Saturday');
    assert.equal(saved.ideaId, null);
    assert.equal((await readDrafts(page))['own-4'], undefined);

    // Change, start typing, Cancel: the plan stays and the draft goes.
    await tap(page, 'artist-change');
    await tap(page, 'artist-own-open');
    await input.fill('A plan I changed my mind about');
    assert.equal((await readDrafts(page))['own-4'], 'A plan I changed my mind about');
    await at(page, 'artist-card').getByRole('button', { name: COPY.cancel, exact: true }).tap();
    await seeVisible(at(page, 'artist-did'));
    await seeTextIn(at(page, 'artist-card'), 'Sketch the canal bridges on Saturday');
    assert.equal((await readDrafts(page))['own-4'], undefined);

    // The Save plan button works too, and text is shown as typed.
    await tap(page, 'artist-change');
    await tap(page, 'artist-own-open');
    await input.fill('<b>Print</b> & paste zine');
    await at(page, 'artist-card').getByRole('button', { name: COPY.planSave, exact: true }).tap();
    await seeVisible(at(page, 'artist-did'));
    await seeTextIn(at(page, 'artist-card'), '<b>Print</b> & paste zine');
    assert.equal(await at(page, 'artist-card').locator('b').count(), 0, 'typed markup is not rendered');
    saved = (await readState(page)).chapters['4'].artistDate;
    assert.equal(saved.plan, '<b>Print</b> & paste zine');
  });

  e2e('artist date: Did it, a note that sticks, and Not done yet', async () => {
    const page = await app({ v2: onChapter(4, { fields: { artistDate: { plan: 'Visit the print museum' } } }) });
    await tap(page, 'artist-did');
    const note = at(page, 'artist-note');
    await seeVisible(note);
    await seeTextIn(at(page, 'artist-card'), COPY.artistDoneAsk, 'Visit the print museum', fill(COPY.artistDoneOn, { date: longDate(TODAY) }));
    assert.equal((await readState(page)).chapters['4'].artistDate.doneOn, TODAY);

    await note.fill('Quiet, good light. Want to go back.');
    await note.blur();
    await eventually(async () => assert.equal((await readState(page)).chapters['4'].artistDate.note, 'Quiet, good light. Want to go back.'));
    await page.reload();
    await seeVisible(note);
    assert.equal(await note.inputValue(), 'Quiet, good light. Want to go back.');

    await at(page, 'artist-card').getByRole('button', { name: COPY.artistUndo }).tap();
    await seeVisible(at(page, 'artist-did'));
    await seeTextIn(at(page, 'artist-card'), 'Visit the print museum');
    const saved = (await readState(page)).chapters['4'].artistDate;
    assert.equal(saved.doneOn, null);
    assert.equal(saved.plan, 'Visit the print museum');
    assert.equal(saved.note, 'Quiet, good light. Want to go back.');
  });

  e2e('artist date: Change offers ideas again, Cancel keeps the plan', async () => {
    const page = await app({ v2: onChapter(4, { fields: { artistDate: { plan: 'Visit the print museum' } } }) });
    await tap(page, 'artist-change');
    await seeVisible(at(page, 'artist-idea'));
    await seeVisible(at(page, 'artist-plan'));
    await seeVisible(at(page, 'artist-another'));
    await seeNone(at(page, 'artist-did'));
    await at(page, 'artist-card').getByRole('button', { name: COPY.cancel, exact: true }).tap();
    await seeVisible(at(page, 'artist-did'));
    await seeTextIn(at(page, 'artist-card'), 'Visit the print museum');

    await tap(page, 'artist-change');
    await tap(page, 'artist-another');
    const idea = await textOf(at(page, 'artist-idea'));
    await tap(page, 'artist-plan');
    await seeVisible(at(page, 'artist-did'));
    await seeTextIn(at(page, 'artist-card'), idea);
    assert.equal((await readState(page)).chapters['4'].artistDate.plan, idea);
  });

  e2e("artist date: a chapter page plans its own chapter's date, Today keeps the current one", async () => {
    const page = await app({ v2: onChapter(4) });
    await tap(page, 'nav-book');
    await tap(page, 'book-row-6');
    await seeVisible(at(page, 'chapter-page'));
    await tap(at(page, 'chapter-page'), 'artist-plan');
    await seeVisible(at(page, 'artist-did'));
    const saved = await readState(page);
    assert.ok(saved.chapters['6'].artistDate.plan, 'chapter 6 has a plan');
    assert.equal(saved.chapters['4']?.artistDate.plan ?? '', '');
    await tap(page, 'nav-today');
    await seeVisible(at(page, 'artist-plan'));
  });
}

// ---------------------------------------------------------------------------
// Check-in and moving on

function checkinTests() {
  e2e('check-in: the move-on line shows from day 7 of a week, not before', async () => {
    let page = await app({ v2: onChapter(4, { startedOn: D(-5) }) });
    await seeVisible(page.getByText(dayOf(6), { exact: true }));
    await seeNone(at(page, 'move-on'));
    page = await app({ v2: onChapter(4, { startedOn: D(-6) }) });
    await seeText(at(page, 'move-on'), fill(COPY.moveLine, { day: 7, n: 4 }));
  });

  e2e('check-in: on day 8, answer and start week 5', async () => {
    const days = pagesDays({ [D(-7)]: 3, [D(-5)]: 2, [D(-1)]: 3 });
    const page = await app({ v2: onChapter(4, { startedOn: D(-7), days }) });
    await seeText(at(page, 'move-on'), fill(COPY.moveLine, { day: 8, n: 4 }));
    await tap(page, 'move-on');
    const sheet = at(page, 'checkin-sheet');
    await seeVisible(sheet);
    await seeVisible(page.getByRole('dialog', { name: fill(COPY.checkinTitle, { n: 4 }) }));
    const intro = fill(CHECKIN.intro, {
      pages: fill(COPY.countPages, { n: 8 }),
      mornings: fill(COPY.countMornings, { n: 3 }),
      artistDate: COPY.checkinArtistNone,
    });
    await seeTextIn(sheet, intro, COPY.checkinOptional, ...CHECKIN.questions.map((q) => q.q));
    await seeText(at(page, 'checkin-submit'), fill(COPY.checkinNext, { next: 5 }));
    await shot('checkin-sheet');

    await at(page, 'checkin-lineUp').fill('A friend sent the exact book I needed.');
    await at(page, 'checkin-matters').fill('I want to paint again.');
    await tap(page, 'checkin-submit');
    await seeNone(sheet);

    const saved = await readState(page);
    assert.equal(saved.course.chapter, 5);
    assert.equal(saved.chapters['4'].finishedOn, TODAY);
    assert.deepEqual(saved.chapters['4'].checkin, { doneOn: TODAY, lineUp: 'A friend sent the exact book I needed.', matters: 'I want to paint again.' });
    assert.equal(saved.chapters['5'].startedOn, TODAY);
    assert.equal(await readKey(page, KEY_DRAFTS), null, 'drafts are cleared once sent');

    await seeText(at(page, 'chapter-line'), chapterLine(5));
    await seeVisible(page.getByText(dayOf(1), { exact: true }));
    await seeNone(at(page, 'move-on'));
    await seeHtmlAttr(page, 'data-accent', CHAPTER_ACCENTS[5]);

    await tap(page, 'nav-book');
    assert.equal(await rowStatus(page, 4), 'done');
    assert.equal(await rowStatus(page, 5), 'current');
    await seeTextIn(at(page, 'book-row-4'), fill(COPY.countMornings, { n: 3 }));
    await tap(page, 'book-row-4');
    await seeTextIn(at(page, 'chapter-page'), COPY.checkinHeading, 'A friend sent the exact book I needed.', 'I want to paint again.');
  });

  e2e('check-in: answers are drafts that survive Not yet, a backdrop tap and a reload', async () => {
    const page = await app({ v2: onChapter(4, { startedOn: D(-7) }) });
    const sheet = at(page, 'checkin-sheet');
    await tap(page, 'move-on');
    await at(page, 'checkin-lineUp').fill('The bus was late and I found the shop.');
    await sheet.getByRole('button', { name: COPY.checkinNotYet, exact: true }).tap();
    await seeNone(sheet);
    assert.equal((await readState(page)).chapters['4'].finishedOn, null);

    await tap(page, 'move-on');
    assert.equal(await at(page, 'checkin-lineUp').inputValue(), 'The bus was late and I found the shop.');
    await at(page, 'checkin-matters').fill('Making time on Sundays.');
    await clickBackdrop(page, 'checkin-sheet');
    await seeNone(sheet);

    await page.reload();
    await tap(page, 'move-on');
    assert.equal(await at(page, 'checkin-lineUp').inputValue(), 'The bus was late and I found the shop.');
    assert.equal(await at(page, 'checkin-matters').inputValue(), 'Making time on Sundays.');
    const drafts = await readDrafts(page);
    assert.equal(drafts['checkin-4-lineUp'], 'The bus was late and I found the shop.');
    assert.equal(drafts['checkin-4-matters'], 'Making time on Sundays.');

    await tap(page, 'checkin-submit');
    await seeNone(sheet);
    const saved = await readState(page);
    assert.equal(saved.chapters['4'].checkin.lineUp, 'The bus was late and I found the shop.');
    assert.equal(saved.chapters['4'].checkin.matters, 'Making time on Sundays.');
    assert.equal(await readKey(page, KEY_DRAFTS), null);
  });

  e2e('check-in: the intro for an empty week and for old-app mornings; Not yet changes nothing', async () => {
    let page = await app({ v2: onChapter(4, { startedOn: D(-8) }) });
    await tap(page, 'move-on');
    await seeTextIn(at(page, 'checkin-sheet'), fill(COPY.checkinIntroEmpty, { artistDate: COPY.checkinArtistNone }));
    const before = await readState(page);
    await at(page, 'checkin-sheet').getByRole('button', { name: COPY.checkinNotYet, exact: true }).tap();
    await seeNone(at(page, 'checkin-sheet'));
    assert.deepEqual(await readState(page), before);

    page = await app({ v2: onChapter(3, { startedOn: D(-9), fields: { legacy: { mornings: 2, artistDate: true } } }) });
    await tap(page, 'move-on');
    await seeTextIn(
      at(page, 'checkin-sheet'),
      fill(COPY.checkinIntroMornings, { mornings: fill(COPY.countMornings, { n: 2 }), artistDate: COPY.checkinArtistDone }),
    );
  });

  e2e('check-in: finishing week 12 closes the course quietly', async () => {
    const page = await app({
      v2: onChapter(12, { startedOn: D(-8), fields: { artistDate: { plan: 'Night swim', doneOn: D(-2) } }, days: pagesDays({ [D(-3)]: 3 }) }),
    });
    await seeText(at(page, 'move-on'), fill(COPY.moveLineLast, { day: 9 }));
    await tap(page, 'move-on');
    await seeTextIn(at(page, 'checkin-sheet'), COPY.checkinArtistDone);
    await seeText(at(page, 'checkin-submit'), COPY.checkinFinishLast);
    await tap(page, 'checkin-submit');
    await seeNone(at(page, 'checkin-sheet'));

    await seeVisible(page.getByText(COPY.courseDone));
    await seeText(at(page, 'chapter-line'), chapterLine(12));
    await seeNone(page.getByText(/^Day \d+$/));
    await seeNone(at(page, 'move-on'));
    const saved = await readState(page);
    assert.equal(saved.course.chapter, 12);
    assert.equal(saved.chapters['12'].finishedOn, TODAY);
    assert.equal(saved.chapters['13'], undefined);
    await seeHtmlAttr(page, 'data-accent', CHAPTER_ACCENTS[12]);

    await tap(page, 'nav-book');
    assert.equal(await rowStatus(page, 12), 'done');
    await tap(page, 'book-row-12');
    await seeVisible(at(page, 'chapter-page'));
    await seeNone(at(page, 'chapter-start'));
    await seeNone(at(page, 'chapter-restart'));

    await page.reload();
    await seeVisible(page.getByText(COPY.courseDone));
  });
}

// ---------------------------------------------------------------------------
// Book

const BOOK_STATE = () =>
  v2State({
    chapter: 6,
    chapters: {
      1: { legacy: { mornings: 6, artistDate: true }, artistDate: { note: 'Harbour walk.' } },
      2: { startedOn: D(-40), finishedOn: D(-30), checkin: { doneOn: D(-30), matters: 'Less news in the morning.' } },
      4: { read: true },
      6: { startedOn: D(-3) },
      8: { artistDate: { plan: 'Visit the observatory' } },
    },
    days: pagesDays({ [D(-38)]: 3, [D(-35)]: 2, [D(-33)]: 3, [D(-2)]: 2, [D(-1)]: 3 }),
  });

function bookTests() {
  e2e('book: twelve rows, each in its own chapter colour, with the right status', async () => {
    const page = await app({ v2: BOOK_STATE() });
    await seeHtmlAttr(page, 'data-accent', CHAPTER_ACCENTS[6]);
    await tap(page, 'nav-book');
    await seeVisible(at(page, 'book-row-12'));

    const expected = { 1: 'done', 2: 'done', 3: 'upcoming', 4: 'done', 5: 'upcoming', 6: 'current', 7: 'upcoming', 8: 'upcoming' };
    const colours = new Set();
    for (let n = 1; n <= 12; n += 1) {
      const row = at(page, `book-row-${n}`);
      assert.equal(await accentOf(row), CHAPTER_ACCENTS[n], `row ${n} colour`);
      assert.equal(await rowStatus(page, n), expected[n] ?? 'upcoming', `row ${n} status`);
      assert.equal(await row.getAttribute('aria-current'), n === 6 ? 'step' : null, `row ${n} aria-current`);
      colours.add(await row.evaluate((el) => getComputedStyle(el.closest('[data-accent]')).getPropertyValue('--accent').trim()));
    }
    assert.equal(colours.size, 12, 'each row resolves its own --accent');

    await seeTextIn(at(page, 'book-row-1'), fill(COPY.countMornings, { n: 6 }), COPY.artistDateDone);
    await seeTextIn(at(page, 'book-row-2'), fill(COPY.countMornings, { n: 3 }));
    await seeTextIn(at(page, 'book-row-4'), COPY.statusDone);
    await seeTextIn(at(page, 'book-row-6'), fill(COPY.startedOnDay, { date: longDate(D(-3)), day: 4 }), fill(COPY.countMornings, { n: 2 }));
    // Rows still to come name their paint.
    await seeTextIn(at(page, 'book-row-3'), ACCENTS.find((a) => a.key === CHAPTER_ACCENTS[3]).name);
    assert.equal(await htmlAttr(page, 'data-accent'), CHAPTER_ACCENTS[6], 'the page keeps the current chapter colour');
    await shot('book');
  });

  e2e('book: a chapter page has its own colour, a read tick that saves, and a way back', async () => {
    const page = await app({ v2: BOOK_STATE() });
    await tap(page, 'nav-book');
    await tap(page, 'book-row-5');
    const chapterPage = at(page, 'chapter-page');
    await seeVisible(chapterPage);
    assert.equal(await accentOf(chapterPage), CHAPTER_ACCENTS[5]);
    const chapter = CHAPTERS[4];
    await seeTextIn(chapterPage, chapter.about, ...chapter.themes, COPY.statusUpcoming);
    await seeVisible(page.getByRole('heading', { level: 1, name: new RegExp(chapter.short) }));

    const read = at(page, 'chapter-read');
    await seePressed(read, false);
    await read.tap();
    await seePressed(read, true);
    assert.equal((await readState(page)).chapters['5'].read, true);
    await page.reload();
    await tap(page, 'nav-book');
    await tap(page, 'book-row-5');
    await seePressed(at(page, 'chapter-read'), true);
    await at(page, 'chapter-read').tap();
    await seePressed(at(page, 'chapter-read'), false);

    await tap(page, 'chapter-back');
    await seeNone(chapterPage);
    await seeVisible(at(page, 'book-row-5'));
    await tap(page, 'book-row-2');
    await seeVisible(chapterPage);
    await page.keyboard.press('Escape');
    await seeNone(chapterPage);
    await tap(page, 'book-row-3');
    await seeVisible(chapterPage);
    await tap(page, 'nav-book');
    await seeNone(chapterPage);
    await seeVisible(at(page, 'book-row-3'));
  });

  e2e('book: starting another week asks first, then moves the course', async () => {
    const page = await app({ v2: BOOK_STATE() });
    await tap(page, 'nav-book');
    await tap(page, 'book-row-7');
    await seeText(at(page, 'chapter-start'), COPY.startThisWeek);
    await tap(page, 'chapter-start');
    await seeVisible(at(page, 'confirm-yes'));
    await seeTextIn(at(page, 'chapter-page'), fill(COPY.startConfirm, { n: 7, current: 6 }));
    await seeText(at(page, 'confirm-yes'), fill(COPY.startConfirmYes, { n: 7 }));
    const before = await readState(page);
    await tap(page, 'confirm-no');
    await seeNone(at(page, 'confirm-yes'));
    await seeVisible(at(page, 'chapter-start'));
    assert.deepEqual(await readState(page), before);

    await tap(page, 'chapter-start');
    await tap(page, 'confirm-yes');
    await seeNone(at(page, 'confirm-yes'));
    const saved = await readState(page);
    assert.equal(saved.course.chapter, 7);
    assert.equal(saved.chapters['7'].startedOn, TODAY);
    assert.equal(saved.chapters['6'].startedOn, D(-3), 'the week left behind keeps its data');
    await seeHtmlAttr(page, 'data-accent', CHAPTER_ACCENTS[7]);
    await seeVisible(at(page, 'chapter-restart'));
    await seeNone(at(page, 'chapter-start'));

    await tap(page, 'chapter-back');
    assert.equal(await rowStatus(page, 7), 'current');
    assert.equal(await rowStatus(page, 6), 'done');
    await tap(page, 'nav-today');
    await seeText(at(page, 'chapter-line'), chapterLine(7));
    await seeVisible(page.getByText(dayOf(1), { exact: true }));
  });

  e2e('book: a finished week offers to do it again, with the quiet button', async () => {
    const page = await app({ v2: BOOK_STATE() });
    await tap(page, 'nav-book');
    await tap(page, 'book-row-2');
    await seeTextIn(at(page, 'chapter-page'), COPY.checkinHeading, 'Less news in the morning.');
    await seeText(at(page, 'chapter-start'), COPY.restartThisWeek);
    const fills = await buttonFills(page);
    assert.ok(!fills.filled.includes('chapter-start'), 'going back to a finished week is the quiet button');
    await tap(page, 'chapter-start');
    await tap(page, 'confirm-yes');
    const saved = await readState(page);
    assert.equal(saved.course.chapter, 2);
    assert.equal(saved.chapters['2'].startedOn, TODAY);
    assert.equal(saved.chapters['2'].finishedOn, null);
    assert.equal(saved.chapters['2'].checkin.matters, 'Less news in the morning.', 'the old check-in stays');
  });

  e2e('book: Do this week again restarts the current week and keeps its notes', async () => {
    const page = await app({
      v2: onChapter(4, { startedOn: D(-5), fields: { read: true, artistDate: { plan: 'Gallery', doneOn: D(-1), note: 'Loved it.' } } }),
    });
    await tap(page, 'nav-book');
    await tap(page, 'book-row-4');
    await tap(page, 'chapter-restart');
    await seeTextIn(at(page, 'chapter-page'), fill(COPY.restartConfirm, { n: 4 }));
    await tap(page, 'confirm-yes');
    await seeNone(at(page, 'confirm-yes'));
    const saved = (await readState(page)).chapters['4'];
    assert.equal(saved.startedOn, TODAY);
    assert.equal(saved.read, true);
    assert.deepEqual(saved.artistDate, { plan: 'Gallery', ideaId: null, doneOn: D(-1), note: 'Loved it.' });
    await tap(page, 'nav-today');
    await seeVisible(page.getByText(dayOf(1), { exact: true }));
  });

  e2e('book: the current week, not started yet, starts without a confirm', async () => {
    const page = await app({ v1: V1 });
    await tap(page, 'nav-book');
    await tap(page, 'book-row-3');
    await tap(page, 'chapter-start');
    await seeNone(at(page, 'confirm-yes'));
    await seeVisible(at(page, 'chapter-restart'));
    assert.equal((await readState(page)).chapters['3'].startedOn, TODAY);
  });
}

// ---------------------------------------------------------------------------
// Kept

function keptTests() {
  e2e('kept: a designed empty state before any line is kept', async () => {
    const page = await app({ v2: onChapter(1) });
    await tap(page, 'nav-kept');
    await seeVisible(at(page, 'kept-empty'));
    await seeTextIn(at(page, 'kept-empty'), COPY.keptEmptyTitle, COPY.keptEmpty);
    await seeNone(at(page, 'kept-list'));
  });

  e2e('kept: lines show newest first with their dates, exactly as typed', async () => {
    const days = {
      [D(-20)]: { pages: 2, keep: 'First line worth keeping.' },
      [D(-3)]: { pages: 0, keep: '<b>not bold</b> & still here' },
      [D(-1)]: { pages: 3, keep: 'Yesterday, plainly.' },
    };
    const page = await app({ v2: onChapter(4, { startedOn: D(-25), days }) });
    await tap(page, 'page-slot-3');
    await at(page, 'keep-input').fill('Today, from the pages.');
    await at(page, 'keep-input').press('Enter');
    await tap(page, 'nav-kept');
    const list = at(page, 'kept-list');
    await seeVisible(list);
    const items = (await list.getByRole('listitem').allTextContents()).map(squash);
    const expected = [
      [TODAY, 'Today, from the pages.'],
      [D(-1), 'Yesterday, plainly.'],
      [D(-3), '<b>not bold</b> & still here'],
      [D(-20), 'First line worth keeping.'],
    ];
    assert.equal(items.length, expected.length, `items: ${items.join(' | ')}`);
    expected.forEach(([key, line], i) => {
      assert.ok(items[i].includes(longDate(key)) && items[i].includes(line), `item ${i}: ${items[i]}`);
    });
    assert.equal(await list.locator('b').count(), 0, 'typed markup is not rendered');
  });
}

// ---------------------------------------------------------------------------
// Settings

function settingsTests() {
  e2e('settings: theme sets data-theme on <html> and survives a reload', async () => {
    const page = await app({ v2: onChapter(4) });
    await tap(page, 'settings-open');
    await seeVisible(page.getByRole('dialog', { name: COPY.settingsTitle }));
    await seePressed(at(page, 'set-theme-system'), true);
    assert.equal(await htmlAttr(page, 'data-theme'), null);
    const metas = () => page.$$eval('meta[name="theme-color"]', (list) => list.map((m) => m.getAttribute('content')));

    await tap(page, 'set-theme-dark');
    await seeHtmlAttr(page, 'data-theme', 'dark');
    await seePressed(at(page, 'set-theme-dark'), true);
    await seePressed(at(page, 'set-theme-system'), false);
    assert.equal((await readState(page)).settings.theme, 'dark');
    assert.deepEqual(await metas(), ['#0B0B0C', '#0B0B0C']);
    await shot('settings-dark');

    await tap(page, 'set-theme-light');
    await seeHtmlAttr(page, 'data-theme', 'light');
    assert.deepEqual(await metas(), ['#FFFFFF', '#FFFFFF']);
    await page.reload();
    await seeHtmlAttr(page, 'data-theme', 'light');

    await tap(page, 'settings-open');
    await tap(page, 'set-theme-system');
    await seeHtmlAttr(page, 'data-theme', null);
    assert.deepEqual(await metas(), ['#FFFFFF', '#0B0B0C']);
    assert.equal((await readState(page)).settings.theme, 'system');
  });

  e2e('settings: a forced theme is on <html> before the app script runs', async () => {
    const page = await app({ v2: onChapter(4, { settings: { theme: 'dark' } }), sw: false });
    await seeHtmlAttr(page, 'data-theme', 'dark');
    await page.route('**/app.js', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
    await page.reload();
    assert.equal(await at(page, 'nav-today').count(), 0, 'the app itself did not run');
    assert.equal(await htmlAttr(page, 'data-theme'), 'dark');
  });

  e2e('settings: a pinned colour wins over the chapter colour; follow the chapter goes back', async () => {
    const page = await app({ v2: onChapter(4) });
    await seeHtmlAttr(page, 'data-accent', CHAPTER_ACCENTS[4]);
    await tap(page, 'settings-open');
    await seePressed(at(page, 'set-accent-chapter'), true);
    for (const accent of ACCENTS) {
      assert.equal(await at(page, `set-accent-${accent.key}`).count(), 1, `a swatch for ${accent.key}`);
      await seeTextIn(at(page, `set-accent-${accent.key}`), accent.name);
    }

    const pin = ACCENTS.find((accent) => accent.chapter === 11);
    await tap(page, `set-accent-${pin.key}`);
    await seeHtmlAttr(page, 'data-accent', pin.key);
    await seePressed(at(page, `set-accent-${pin.key}`), true);
    await seePressed(at(page, 'set-accent-chapter'), false);
    await seeTextIn(at(page, 'settings-sheet'), pin.note);
    assert.equal((await readState(page)).settings.accent, pin.key);

    // Book rows keep their own colours under a pinned one.
    await page.keyboard.press('Escape');
    await tap(page, 'nav-book');
    assert.equal(await accentOf(at(page, 'book-row-4')), CHAPTER_ACCENTS[4]);
    assert.equal(await htmlAttr(page, 'data-accent'), pin.key);

    await tap(page, 'settings-open');
    await tap(page, 'set-accent-chapter');
    await seeHtmlAttr(page, 'data-accent', CHAPTER_ACCENTS[4]);
    assert.equal((await readState(page)).settings.accent, 'chapter');

    // A pinned key this version doesn't know falls back to the chapter colour.
    const other = await app({ v2: onChapter(4, { settings: { accent: 'retired-blue' } }) });
    await seeHtmlAttr(other, 'data-accent', CHAPTER_ACCENTS[4]);
    await tap(other, 'settings-open');
    await seePressed(at(other, 'set-accent-chapter'), true);
  });

  e2e('settings: timer length, bell, rain and the version', async () => {
    const page = await app({ v2: onChapter(4) });
    await tap(page, 'settings-open');
    await seePressed(at(page, 'set-minutes-25'), true);
    await tap(page, 'set-minutes-30');
    await seePressed(at(page, 'set-minutes-30'), true);
    await seePressed(at(page, 'set-minutes-25'), false);
    assert.equal((await readState(page)).settings.minutes, 30);

    await seePressed(at(page, 'set-bell'), true);
    await tap(page, 'set-bell');
    await seePressed(at(page, 'set-bell'), false);
    assert.equal((await readState(page)).settings.bell, false);

    await seePressed(at(page, 'set-rain'), false);
    await tap(page, 'set-rain');
    await seePressed(at(page, 'set-rain'), true);
    assert.equal((await readState(page)).settings.rain, true);

    await seeTextIn(at(page, 'settings-sheet'), fill(COPY.version, { version: APP_VERSION }));
    await page.keyboard.press('Escape');
    await seeNone(at(page, 'settings-sheet'));

    await seeTextIn(at(page, 'start-writing'), COPY.startWriting, fill(COPY.minutesOption, { n: 30 }));
    await tap(page, 'start-writing');
    await seeText(at(page, 'timer-digits'), '30:00');
    await seePressed(at(page, 'timer-preset-30'), true);
    await seeTextIn(at(page, 'writing'), COPY.writingLineNoBell);
    await seePressed(at(page, 'rain-toggle'), true);
    await tap(page, 'writing-done');

    await tap(page, 'settings-open');
    await tap(page, 'set-bell');
    await seePressed(at(page, 'set-bell'), true);
    await page.keyboard.press('Escape');
    await tap(page, 'start-writing');
    await seeTextIn(at(page, 'writing'), COPY.writingLine);
  });
}

// ---------------------------------------------------------------------------
// Backup, restore and start over

function backupTests() {
  e2e('backup: Copy backup puts the whole state on the clipboard', async () => {
    const page = await app({ v2: BOOK_STATE(), clipboard: true });
    await tap(page, 'settings-open');
    await tap(page, 'backup-copy');
    await seeToast(page, COPY.backupCopied);
    if (engine !== 'chromium') return; // reading the clipboard back needs a permission only Chromium grants
    const backup = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
    assert.equal(backup.app, 'artists-way-companion');
    assert.equal(backup.version, 2);
    assert.ok(!Number.isNaN(Date.parse(backup.exportedAt)));
    assert.deepEqual(backup.state, await readState(page));
  });

  e2e('backup: Download file saves the state as JSON, named for the day', async () => {
    const page = await app({ v2: BOOK_STATE() });
    await tap(page, 'settings-open');
    const [download] = await Promise.all([page.waitForEvent('download'), tap(page, 'backup-download')]);
    assert.equal(download.suggestedFilename(), `artists-way-backup-${TODAY}.json`);
    const backup = JSON.parse(await readFile(await download.path(), 'utf8'));
    assert.equal(backup.app, 'artists-way-companion');
    assert.equal(backup.version, 2);
    assert.ok(!Number.isNaN(Date.parse(backup.exportedAt)));
    assert.deepEqual(backup.state, await readState(page));
    await seeToast(page, COPY.backupDownloaded);
  });

  e2e('restore: asks first; Cancel keeps everything, Replace swaps the backup in', async () => {
    const page = await app({ v2: BOOK_STATE() });
    const restored = onChapter(9, { startedOn: D(-1), days: { [D(-1)]: { pages: 3, keep: 'From the backup.' } }, settings: { theme: 'dark' } });
    const file = { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(exportBackup(restored, '2026-10-20T07:30:00.000Z')) };
    const before = await readState(page);

    await tap(page, 'nav-book');
    await tap(page, 'settings-open');
    const sheet = at(page, 'settings-sheet');
    await at(sheet, 'restore-file').setInputFiles(file);
    await seeVisible(at(sheet, 'confirm-yes'));
    await seeTextIn(sheet, fill(COPY.restoreConfirmDated, { date: '20 October 2026' }));
    await shot('restore-confirm');
    await tap(sheet, 'confirm-no');
    await seeNone(at(sheet, 'confirm-yes'));
    await seeToast(page, COPY.restoreUnchanged);
    assert.deepEqual(await readState(page), before);

    await at(sheet, 'restore-file').setInputFiles(file);
    await tap(sheet, 'confirm-yes');
    await seeNone(sheet);
    await seeToast(page, COPY.restoreDone);
    // Everything but the idea on show, which Today picks as soon as it draws.
    const { seen, ...rest } = await readState(page);
    const { seen: _seen, ...expected } = restored;
    assert.deepEqual(rest, expected);
    // Back on Today, with the backup's week, colour and theme.
    await seeText(at(page, 'chapter-line'), chapterLine(9));
    await seeHtmlAttr(page, 'data-accent', CHAPTER_ACCENTS[9]);
    await seeHtmlAttr(page, 'data-theme', 'dark');
  });

  e2e("restore: an old app's export lands on the pick-up card", async () => {
    const page = await app({ v2: onChapter(4) });
    await tap(page, 'settings-open');
    await at(page, 'restore-file').setInputFiles({ name: 'old.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(V1)) });
    await seeTextIn(at(page, 'settings-sheet'), COPY.restoreConfirm);
    await tap(at(page, 'settings-sheet'), 'confirm-yes');
    await seeToast(page, COPY.restoreDoneOld);
    await seeTextIn(at(page, 'pickup'), fill(PICKUP.title, { n: 3 }), PICKUP.lineMoved);
    assert.deepEqual((await readState(page)).legacyV1, V1);
  });

  e2e('restore: files that are not a backup are refused, with the reason', async () => {
    const page = await app({ v2: onChapter(4) });
    const before = await readState(page);
    await tap(page, 'settings-open');
    const sheet = at(page, 'settings-sheet');
    const cases = [
      ['empty', ''],
      ['unreadable', '{ this is not json'],
      ['unknown', JSON.stringify({ hello: 'world' })],
      ['unknown', JSON.stringify([1, 2, 3])],
      ['wrongApp', JSON.stringify({ app: 'some-other-app', version: 2, state: {} })],
      ['newer', JSON.stringify({ app: 'artists-way-companion', version: 3, state: { version: 3 } })],
      ['damaged', JSON.stringify({ app: 'artists-way-companion', version: 2, state: { version: 1 } })],
    ];
    for (const [code, text] of cases) {
      await at(sheet, 'restore-file').setInputFiles({ name: `${code}.json`, mimeType: 'application/json', buffer: Buffer.from(text) });
      await seeToast(page, COPY.restoreErrors[code]);
      assert.equal(await at(sheet, 'confirm-yes').count(), 0, `${code}: no confirm`);
      // Clear the toast so the next case is a fresh message.
      await page.evaluate(() => {
        const toastEl = document.querySelector('[data-test="toast"]');
        toastEl.textContent = '';
      });
    }
    assert.deepEqual(await readState(page), before);
  });

  e2e("start over: clears this phone, never touches the old app's data, and doesn't migrate it again", async () => {
    const page = await app({ v1: V1 });
    await tap(page, 'pickup-start');
    await tap(page, 'page-slot-2');
    await seePages(page, 2);

    await tap(page, 'settings-open');
    await tap(page, 'start-over');
    await seeVisible(at(page, 'start-over-confirm'));
    await seeTextIn(at(page, 'settings-sheet'), COPY.startOverConfirm);
    await at(page, 'settings-sheet').getByRole('button', { name: COPY.startOverNo }).tap();
    await seeNone(at(page, 'start-over-confirm'));
    assert.equal((await readState(page)).days[TODAY].pages, 2);

    await tap(page, 'start-over');
    await tap(page, 'start-over-confirm');
    await seeNone(at(page, 'settings-sheet'));
    await seeToast(page, COPY.startOverDone);
    await seeTextIn(at(page, 'pickup'), PICKUP.freshTitle);
    const saved = await readState(page);
    assert.deepEqual(saved.chapters, {});
    assert.deepEqual(saved.days, {});
    assert.equal(saved.legacyV1, null);
    assert.equal(saved.course.chapter, 1);
    assert.equal(await readKey(page, KEY_V1), JSON.stringify(V1), 'the v1 key is untouched');

    await page.reload();
    await seeTextIn(at(page, 'pickup'), PICKUP.freshTitle);
    assert.equal((await readState(page)).legacyV1, null, 'not migrated again');
  });
}

// ---------------------------------------------------------------------------
// Storage: reloads, other tabs, unreadable data, saves that wait for a pause

function storageTests() {
  e2e('persistence: everything survives a reload', async () => {
    const page = await app({ v2: onChapter(4, { startedOn: D(-3) }) });
    await tap(page, 'page-slot-3');
    await at(page, 'keep-input').fill('Kept across a reload.');
    await at(page, 'keep-input').press('Enter');
    await at(page, `week-day-${D(-1)}`).tap();
    await tap(page, 'backfill-2');
    await tap(page, 'artist-plan');
    await tap(page, 'artist-did');
    await at(page, 'artist-note').fill('Good afternoon.');
    await at(page, 'artist-note').blur();
    await tap(page, 'nav-book');
    await tap(page, 'book-row-4');
    await tap(page, 'chapter-read');
    await seePressed(at(page, 'chapter-read'), true);
    await tap(page, 'settings-open');
    await tap(page, 'set-theme-dark');
    await tap(page, 'set-accent-magenta');
    await tap(page, 'set-minutes-20');
    await tap(page, 'set-bell');
    await tap(page, 'set-rain');
    await page.keyboard.press('Escape');
    await seeNone(at(page, 'settings-sheet'));
    const before = await readState(page);

    await page.reload();
    assert.deepEqual(await readState(page), before, 'nothing changed on the way back in');
    await seePages(page, 3, { monthTotal: 5 });
    assert.equal(await at(page, 'keep-input').inputValue(), 'Kept across a reload.');
    await seeHtmlAttr(page, 'data-theme', 'dark');
    await seeHtmlAttr(page, 'data-accent', 'magenta');
    assert.equal(await at(page, 'artist-note').inputValue(), 'Good afternoon.');
    await tap(page, 'nav-book');
    await tap(page, 'book-row-4');
    await seePressed(at(page, 'chapter-read'), true);
    await tap(page, 'settings-open');
    await seePressed(at(page, 'set-minutes-20'), true);
    await seePressed(at(page, 'set-bell'), false);
    await seePressed(at(page, 'set-rain'), true);
  });

  e2e("other tabs: a save in another tab replaces this tab's state, without a write back", async () => {
    const page = await app({ v2: onChapter(4), spy: true });
    await seeText(at(page, 'chapter-line'), chapterLine(4));
    const other = await openTab(page);
    await seeText(at(other, 'chapter-line'), chapterLine(4));
    await sleep(200);
    const writesBefore = (await page.evaluate(() => window.__writes)).filter((key) => key === 'awc.v2').length;

    await at(other, 'page-slot-2').tap();
    await seePages(other, 2);
    // This tab redraws from the other tab's save...
    await eventually(async () => assert.equal(await at(page, 'page-slot-2').getAttribute('aria-pressed'), 'true'));
    await seeText(at(page, 'pages-count'), fill(COPY.pagesPartial, { n: 2 }));
    // ...and doesn't write it back.
    await sleep(300);
    const writesAfter = (await page.evaluate(() => window.__writes)).filter((key) => key === 'awc.v2').length;
    assert.equal(writesAfter, writesBefore, 'this tab wrote awc.v2 after only reading the other tab');

    // A change here reaches the other tab the same way.
    await tap(page, 'page-slot-3');
    await eventually(async () => assert.equal(await at(other, 'page-slot-3').getAttribute('aria-pressed'), 'true'));
  });

  e2e("other tabs: saved data this version can't read stops this tab writing", async () => {
    const page = await app({ v2: onChapter(4), spy: true });
    await seeText(at(page, 'chapter-line'), chapterLine(4));
    const other = await openTab(page);
    await seeText(at(other, 'chapter-line'), chapterLine(4));
    await sleep(200);
    const newer = JSON.stringify({ version: 3, course: { chapter: 6 }, days: { [TODAY]: { pages: 1 } } });
    await other.evaluate(([key, value]) => localStorage.setItem(key, value), [KEY_V2, newer]);
    await sleep(300);
    const writesBefore = (await page.evaluate(() => window.__writes)).filter((key) => key === 'awc.v2').length;

    // This tab carries on in memory, says saving isn't working, and leaves the newer data alone.
    await tap(page, 'page-slot-1');
    await seePressed(at(page, 'page-slot-1'), true);
    await seeToast(page, COPY.storageError);
    assert.equal(await readKey(page, KEY_V2), newer);
    const writesAfter = (await page.evaluate(() => window.__writes)).filter((key) => key === 'awc.v2').length;
    assert.equal(writesAfter, writesBefore, 'no write to awc.v2 after the unreadable save arrived');
  });

  e2e('start-up: unreadable saved data is copied to awc.v2.unread before any write; the v1 key is left alone', async () => {
    const damaged = '{"version":2,"course":{"chapter":';
    const page = await app({ v2: damaged, v1: V1, spy: true });
    // The old app's data carries on (old data beats no data)...
    await seeTextIn(at(page, 'pickup'), fill(PICKUP.title, { n: 3 }));
    // ...after the unreadable text was put aside first.
    assert.equal(await readKey(page, KEY_UNREAD), damaged);
    const writes = await page.evaluate(() => window.__writes);
    assert.ok(writes.includes(KEY_UNREAD), `writes: ${writes}`);
    assert.ok(writes.indexOf(KEY_UNREAD) < writes.indexOf(KEY_V2), `the copy comes before the first awc.v2 write: ${writes}`);
    assert.ok(!writes.includes(KEY_V1) && !writes.includes(`-${KEY_V1}`), 'the v1 key is never written');
    assert.equal(await readKey(page, KEY_V1), JSON.stringify(V1));
    assert.deepEqual((await readState(page)).legacyV1, V1);
  });

  e2e('start-up: each different unreadable save gets its own slot: .unread, then .2, then .3', async () => {
    const newer = JSON.stringify({ version: 3, course: { chapter: 9 } });
    let page = await app({ v2: newer, storage: { [KEY_UNREAD]: 'an older unreadable save' } });
    await seeVisible(at(page, 'pickup'));
    assert.equal(await readKey(page, KEY_UNREAD), 'an older unreadable save');
    assert.equal(await readKey(page, `${KEY_UNREAD}.2`), newer);
    assert.equal((await readState(page)).version, 2);

    page = await app({ v2: 'garbage', storage: { [KEY_UNREAD]: 'a', [`${KEY_UNREAD}.2`]: 'b' } });
    await seeVisible(at(page, 'pickup'));
    assert.equal(await readKey(page, `${KEY_UNREAD}.3`), 'garbage');

    // The same text already put aside: no second copy.
    page = await app({ v2: 'same text', storage: { [KEY_UNREAD]: 'same text' } });
    await seeVisible(at(page, 'pickup'));
    assert.equal(await readKey(page, `${KEY_UNREAD}.2`), null);
  });

  e2e('start-up: with every unread slot taken, awc.v2 is never overwritten', async () => {
    const storage = {};
    for (let slot = 1; slot <= 20; slot += 1) storage[slot === 1 ? KEY_UNREAD : `${KEY_UNREAD}.${slot}`] = `kept ${slot}`;
    const page = await app({ v2: 'keep me', storage, spy: true });
    await seeToast(page, COPY.storageError);
    await tap(page, 'pickup-start');
    await tap(page, 'page-slot-1');
    await seePressed(at(page, 'page-slot-1'), true);
    assert.equal(await readKey(page, KEY_V2), 'keep me');
    assert.ok(!(await page.evaluate(() => window.__writes)).includes(KEY_V2), 'no write to awc.v2 at all');
  });

  e2e('pending saves: the keep line and the artist note are saved when the app is hidden or the page goes away', async () => {
    // The clock stands still, so a save waiting for a pause in typing never goes through on its own.
    const page = await app({
      v2: onChapter(4, { days: { [TODAY]: { pages: 3, keep: '' } }, fields: { artistDate: { plan: 'Print museum', doneOn: TODAY } } }),
      clock: T0,
    });
    await at(page, 'keep-input').fill('Saved on the way to the background.');
    await sleep(200);
    assert.equal((await readState(page)).days[TODAY].keep, '', 'still waiting for a pause in typing');
    await setVisibility(page, 'hidden');
    await eventually(async () => assert.equal((await readState(page)).days[TODAY].keep, 'Saved on the way to the background.'));
    await setVisibility(page, 'visible');

    await at(page, 'artist-note').fill('Saved as the page went away.');
    await sleep(200);
    assert.equal((await readState(page)).chapters['4'].artistDate.note, '');
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await eventually(async () => assert.equal((await readState(page)).chapters['4'].artistDate.note, 'Saved as the page went away.'));
  });
}

// ---------------------------------------------------------------------------
// The writing screen and its timer (page.clock: time only moves when the test moves it)

function writingTests() {
  e2e('writing: opens over Today with the timer, a starter line and Another line', async () => {
    const page = await app({ v2: onChapter(4), clock: T0 });
    await tap(page, 'start-writing');
    const writing = at(page, 'writing');
    await seeVisible(writing);
    assert.equal(await writing.getAttribute('aria-hidden'), 'false');
    await seeTextIn(writing, longDate(TODAY), COPY.writingLine);
    await seeText(at(page, 'timer-digits'), '25:00');
    await seePressed(at(page, 'timer-preset-25'), true);
    assert.equal(await at(page, 'timer-reset').isDisabled(), true);

    const first = await textOf(at(page, 'starter-line'));
    assert.ok(STARTER_TEXTS.includes(first));
    await tap(page, 'starter-another');
    await eventually(async () => assert.notEqual(await textOf(at(page, 'starter-line')), first));
    const second = await textOf(at(page, 'starter-line'));
    assert.ok(STARTER_TEXTS.includes(second));
    assert.equal((await readState(page)).seen.starters.at(-1), STARTERS.find((s) => s.text === second).id);

    await seePressed(at(page, 'rain-toggle'), false);
    await tap(page, 'rain-toggle');
    await seePressed(at(page, 'rain-toggle'), true);
    await tap(page, 'rain-toggle');
    await seePressed(at(page, 'rain-toggle'), false);
    assert.equal((await readState(page)).settings.rain, false, 'the toggle is for this session only');
    await shot('writing');

    // Idle, Escape leaves.
    await page.keyboard.press('Escape');
    await seeHidden(writing);
    assert.equal(await writing.getAttribute('aria-hidden'), 'true');
  });

  e2e('writing: start, pause, resume and reset; presets are locked while a session is under way', async () => {
    const page = await app({ v2: onChapter(4), clock: T0 });
    await tap(page, 'start-writing');
    await tap(page, 'timer-start');
    await seeVisible(at(page, 'timer-pause'));
    await seeNone(at(page, 'timer-start'));
    await seeText(at(page, 'timer-pause'), COPY.timerPause);
    for (const m of [20, 25, 30]) assert.equal(await at(page, `timer-preset-${m}`).isDisabled(), true, `preset ${m} while running`);

    await page.clock.runFor(61_000);
    await seeText(at(page, 'timer-digits'), '23:59');
    const saved = JSON.parse(await readKey(page, KEY_TIMER));
    assert.equal(saved.endsAt, T0 + 25 * MIN);
    assert.equal(saved.minutes, 25);
    assert.equal(saved.pausedLeft, null);

    await tap(page, 'timer-pause');
    await seeText(at(page, 'timer-start'), COPY.timerResume);
    await seeTextIn(at(page, 'writing'), COPY.timerPaused);
    assert.equal(JSON.parse(await readKey(page, KEY_TIMER)).pausedLeft, 25 * MIN - 61_000);
    for (const m of [20, 25, 30]) assert.equal(await at(page, `timer-preset-${m}`).isDisabled(), true, `preset ${m} while paused`);
    await at(page, 'timer-preset-20').tap({ force: true });
    await page.clock.runFor(5 * MIN);
    await seeText(at(page, 'timer-digits'), '23:59');
    assert.equal((await readState(page)).settings.minutes, 25, 'a locked preset changes nothing');

    await tap(page, 'timer-start');
    await seeVisible(at(page, 'timer-pause'));
    await page.clock.runFor(60_000);
    await seeText(at(page, 'timer-digits'), '22:59');

    await tap(page, 'timer-reset');
    await seeText(at(page, 'timer-digits'), '25:00');
    await seeText(at(page, 'timer-start'), COPY.timerStart);
    assert.equal(await at(page, 'timer-reset').isDisabled(), true);
    assert.equal(await readKey(page, KEY_TIMER), null);
    for (const m of [20, 25, 30]) assert.equal(await at(page, `timer-preset-${m}`).isDisabled(), false);
  });

  e2e('writing: presets set the length and become the default', async () => {
    const page = await app({ v2: onChapter(4), clock: T0 });
    await tap(page, 'start-writing');
    await tap(page, 'timer-preset-20');
    await seeText(at(page, 'timer-digits'), '20:00');
    await seePressed(at(page, 'timer-preset-20'), true);
    await seePressed(at(page, 'timer-preset-25'), false);
    assert.equal((await readState(page)).settings.minutes, 20);
    await tap(page, 'timer-preset-30');
    await seeText(at(page, 'timer-digits'), '30:00');
    await tap(page, 'timer-start');
    await page.clock.fastForward(10 * MIN);
    await page.clock.runFor(500);
    await seeText(at(page, 'timer-digits'), '20:00');
    await tap(page, 'writing-done');
    await seeTextIn(at(page, 'start-writing'), fill(COPY.minutesOption, { n: 30 }));
  });

  e2e('writing: at the end the bell rings, the digits read zero, and the pages stay tappable', async () => {
    const page = await app({ v2: onChapter(4), clock: T0, audio: true });
    await tap(page, 'start-writing');
    await tap(page, 'timer-start');
    await page.clock.fastForward(24 * MIN);
    await page.clock.runFor(70_000);
    await seeText(at(page, 'timer-digits'), '00:00');
    await seeTextIn(at(page, 'writing'), COPY.timerEnded);
    await seeVisible(at(page, 'timer-start'));
    await eventually(async () => assert.ok((await page.evaluate(() => window.__audio.oscillators)) > 0, 'the bell rang'));
    await shot('writing-ended');

    await tap(page, 'w-page-slot-1');
    await seePages(page, 1, { prefix: 'w-' });
    await tap(page, 'writing-done');
    await seeHidden(at(page, 'writing'));
    assert.equal(await readKey(page, KEY_TIMER), null, 'Done ends the session');
    await seeText(at(page, 'pages-count'), fill(COPY.pagesPartial, { n: 1 }));
  });

  e2e('writing: the screen stays awake while the timer runs, and the lock comes back after the app returns', async () => {
    const page = await app({ v2: onChapter(4), clock: T0, wakeLock: true });
    const log = () => page.evaluate(() => [...window.__wake]);
    await tap(page, 'start-writing');
    assert.deepEqual(await log(), [], 'no lock before the timer runs');
    await tap(page, 'timer-start');
    await eventually(async () => assert.deepEqual(await log(), ['request:screen']));
    await tap(page, 'timer-pause');
    await eventually(async () => assert.deepEqual(await log(), ['request:screen', 'release']));
    await tap(page, 'timer-start');
    await eventually(async () => assert.deepEqual(await log(), ['request:screen', 'release', 'request:screen']));

    // The phone drops the lock when the app goes to the background; coming back takes it again.
    await page.evaluate(() => window.__wakeLocks.at(-1).release());
    await setVisibility(page, 'hidden');
    await setVisibility(page, 'visible');
    await eventually(async () => assert.deepEqual((await log()).slice(-2), ['release', 'request:screen']));

    // The end lets go of it.
    await page.clock.fastForward(24 * MIN);
    await page.clock.runFor(70_000);
    await seeText(at(page, 'timer-digits'), '00:00');
    await eventually(async () => assert.equal((await log()).at(-1), 'release'));
  });

  e2e('writing: sound starts only from a tap, never from a restored session on its own', async () => {
    const running = { endsAt: T0 + 10 * MIN, minutes: 25, pausedLeft: null, savedAt: T0 - 15 * MIN };
    const page = await app({ v2: onChapter(4, { settings: { rain: true } }), clock: T0, audio: true, storage: { [KEY_TIMER]: running } });
    await seeVisible(at(page, 'timer-pause'));
    await seePressed(at(page, 'rain-toggle'), true);
    await sleep(200);
    assert.deepEqual(await page.evaluate(() => ({ ...window.__audio })), { contexts: 0, oscillators: 0, sources: 0 }, 'no audio before a tap');
    await tap(page, 'starter-another');
    await eventually(async () => {
      const audio = await page.evaluate(() => ({ ...window.__audio }));
      assert.equal(audio.contexts, 1, 'the first tap makes the audio context');
      assert.ok(audio.sources >= 1, 'and starts the rain');
    });

    const fresh = await app({ v2: onChapter(4, { settings: { rain: true } }), clock: T0, audio: true });
    assert.equal(await fresh.evaluate(() => window.__audio.contexts), 0);
    await tap(fresh, 'start-writing');
    await eventually(async () => {
      const audio = await fresh.evaluate(() => ({ ...window.__audio }));
      assert.equal(audio.contexts, 1);
      assert.ok(audio.sources >= 1, 'rain from the tap that opened the screen');
    });
  });

  e2e('writing: with the bell off the end is silent', async () => {
    const page = await app({ v2: onChapter(4, { settings: { bell: false } }), clock: T0, audio: true });
    await tap(page, 'start-writing');
    await seeTextIn(at(page, 'writing'), COPY.writingLineNoBell);
    await tap(page, 'timer-start');
    await page.clock.fastForward(24 * MIN);
    await page.clock.runFor(70_000);
    await seeText(at(page, 'timer-digits'), '00:00');
    await seeTextIn(at(page, 'writing'), COPY.timerEnded);
    assert.equal(await page.evaluate(() => window.__audio.oscillators), 0);
  });

  e2e('writing: a running session comes back after a reload, and Escape does not end it', async () => {
    const page = await app({ v2: onChapter(4), clock: T0 });
    await tap(page, 'start-writing');
    await tap(page, 'timer-start');
    await page.clock.runFor(2 * MIN);
    await seeText(at(page, 'timer-digits'), '23:00');
    await page.keyboard.press('Escape');
    await sleep(150);
    await seeVisible(at(page, 'writing'));

    await page.reload();
    await seeVisible(at(page, 'writing'));
    await seeVisible(at(page, 'timer-pause'));
    await seeText(at(page, 'timer-digits'), '23:00');
    await page.clock.runFor(MIN);
    await seeText(at(page, 'timer-digits'), '22:00');

    // Done ends it; opening again starts from the default.
    await tap(page, 'writing-done');
    await seeHidden(at(page, 'writing'));
    assert.equal(await readKey(page, KEY_TIMER), null);
    await tap(page, 'start-writing');
    await seeText(at(page, 'timer-digits'), '25:00');
    await seeVisible(at(page, 'timer-start'));
  });

  e2e('writing: a killed app reopens a paused session within 3 hours, not after', async () => {
    const paused = (savedAt) => ({ endsAt: null, minutes: 25, pausedLeft: 10 * MIN, savedAt });
    let page = await app({ v2: onChapter(4), clock: T0, storage: { [KEY_TIMER]: paused(T0 - 2 * 60 * MIN) } });
    await seeVisible(at(page, 'writing'));
    await seeText(at(page, 'timer-digits'), '10:00');
    await seeText(at(page, 'timer-start'), COPY.timerResume);
    await seeTextIn(at(page, 'writing'), COPY.timerPaused);
    for (const m of [20, 25, 30]) assert.equal(await at(page, `timer-preset-${m}`).isDisabled(), true);

    page = await app({ v2: onChapter(4), clock: T0, storage: { [KEY_TIMER]: paused(T0 - 3 * 60 * MIN - MIN) } });
    await seeVisible(at(page, 'start-writing'));
    await seeHidden(at(page, 'writing'));
    assert.equal(await readKey(page, KEY_TIMER), null);
  });

  e2e('writing: a killed app reopens a running session, and an ended one within 30 minutes', async () => {
    const running = { endsAt: T0 + 10 * MIN, minutes: 25, pausedLeft: null, savedAt: T0 - 15 * MIN };
    let page = await app({ v2: onChapter(4), clock: T0, storage: { [KEY_TIMER]: running } });
    await seeVisible(at(page, 'writing'));
    await seeVisible(at(page, 'timer-pause'));
    await seeText(at(page, 'timer-digits'), '10:00');

    const ended = (endsAt) => ({ endsAt, minutes: 25, pausedLeft: null, savedAt: endsAt - 25 * MIN });
    page = await app({ v2: onChapter(4), clock: T0, audio: true, storage: { [KEY_TIMER]: ended(T0 - 10 * MIN) } });
    await seeVisible(at(page, 'writing'));
    await seeText(at(page, 'timer-digits'), '00:00');
    await seeTextIn(at(page, 'writing'), COPY.timerEnded);
    assert.equal(await page.evaluate(() => window.__audio.oscillators), 0, 'no bell for an end long past');

    page = await app({ v2: onChapter(4), clock: T0, storage: { [KEY_TIMER]: ended(T0 - 31 * MIN) } });
    await seeVisible(at(page, 'start-writing'));
    await seeHidden(at(page, 'writing'));
    assert.equal(await readKey(page, KEY_TIMER), null);

    // A saved end further off than the timer's length means the clock moved back: ignored.
    page = await app({ v2: onChapter(4), clock: T0, storage: { [KEY_TIMER]: { endsAt: T0 + 40 * MIN, minutes: 25, pausedLeft: null, savedAt: T0 } } });
    await seeHidden(at(page, 'writing'));
  });
}

// ---------------------------------------------------------------------------
// App updates (a new service worker taking over)

function updateTests() {
  e2e('update: with nothing in the way the app reloads at once', async () => {
    const page = await controlledApp({ v2: onChapter(4) });
    const reloaded = page.waitForEvent('load');
    await fireUpdate(page);
    await reloaded;
    assert.equal(await sameDocument(page), false);
    await seeText(at(page, 'chapter-line'), chapterLine(4));
  });

  e2e('update: waits while a sheet is open and reloads once it closes', async () => {
    const page = await controlledApp({ v2: onChapter(4) });
    await tap(page, 'settings-open');
    await seeVisible(at(page, 'settings-sheet'));
    await fireUpdate(page);
    await sleep(500);
    assert.ok(await sameDocument(page), 'no reload under an open sheet');
    const reloaded = page.waitForEvent('load');
    await page.keyboard.press('Escape');
    await reloaded;
    assert.equal(await sameDocument(page), false);
  });

  e2e('update: waits while a field has focus, then saves what was typed and reloads when it is left', async () => {
    const page = await controlledApp({ v2: onChapter(4, { days: { [TODAY]: { pages: 3, keep: '' } } }) });
    const keep = at(page, 'keep-input');
    await keep.fill('Typed while an update arrived.');
    await fireUpdate(page);
    await sleep(500);
    assert.ok(await sameDocument(page), 'no reload while typing');
    const reloaded = page.waitForEvent('load');
    await keep.blur();
    await reloaded;
    assert.equal(await sameDocument(page), false);
    assert.equal((await readState(page)).days[TODAY].keep, 'Typed while an update arrived.');
  });

  e2e('update: waits for a writing session, says so, and reloads after Done', async () => {
    const page = await controlledApp({ v2: onChapter(4) });
    await tap(page, 'start-writing');
    await tap(page, 'timer-start');
    await fireUpdate(page);
    await seeToast(page, COPY.updateWaiting);
    await sleep(300);
    assert.ok(await sameDocument(page), 'no reload while the timer runs');
    await tap(page, 'timer-pause');
    await sleep(300);
    assert.ok(await sameDocument(page), 'no reload while the writing screen is open');
    const reloaded = page.waitForEvent('load');
    await tap(page, 'writing-done');
    await reloaded;
    assert.equal(await sameDocument(page), false);
    await seeHidden(at(page, 'writing'));
  });

  e2e('update: going to the background while typing saves the text first, then reloads', async () => {
    const page = await controlledApp({ v2: onChapter(4, { days: { [TODAY]: { pages: 3, keep: '' } } }), clock: T0 });
    await at(page, 'keep-input').fill('Typed as the phone was put down.');
    await fireUpdate(page);
    await sleep(300);
    assert.ok(await sameDocument(page));
    assert.equal((await readState(page)).days[TODAY].keep, '', 'still waiting for a pause in typing');
    const reloaded = page.waitForEvent('load');
    await setVisibility(page, 'hidden');
    await reloaded;
    assert.equal((await readState(page)).days[TODAY].keep, 'Typed as the phone was put down.');
  });
}

// ---------------------------------------------------------------------------
// The date moving on while the app is open

function dateTests() {
  e2e('date: midnight while the app is open moves Today to the new day', async () => {
    const page = await app({
      today: null,
      clock: Date.parse('2026-10-22T23:59:30+01:00'),
      v2: onChapter(4, { startedOn: '2026-10-19', days: pagesDays({ '2026-10-22': 3 }) }),
    });
    await seeText(page.getByRole('heading', { level: 1 }), longDate('2026-10-22'));
    await seePages(page, 3);
    assert.equal(await at(page, 'week-day-2026-10-23').evaluate((el) => el.tagName), 'DIV');

    await page.clock.runFor(61_000); // the once-a-minute check
    await seeText(page.getByRole('heading', { level: 1 }), longDate('2026-10-23'));
    await eventually(async () => assert.equal(await at(page, 'week-day-2026-10-23').getAttribute('aria-current'), 'date'));
    assert.equal(await at(page, 'week-day-2026-10-23').evaluate((el) => el.tagName), 'BUTTON');
    assert.equal(await at(page, 'week-day-2026-10-22').getAttribute('aria-current'), null);
    for (let k = 1; k <= 3; k += 1) await seePressed(at(page, `page-slot-${k}`), false);
    await seeText(at(page, 'month-count'), monthCount(3));
    await seeVisible(page.getByText(dayOf(5), { exact: true }));
    await seeHidden(at(page, 'reentry'));
  });

  e2e('date: coming back after midnight shows the new day, across a month end', async () => {
    const page = await app({
      today: null,
      clock: Date.parse('2026-10-31T22:00:00Z'),
      v2: onChapter(5, { startedOn: '2026-10-26', days: pagesDays({ '2026-10-30': 2, '2026-10-31': 3 }) }),
    });
    await seeText(page.getByRole('heading', { level: 1 }), longDate('2026-10-31'));
    await seeText(at(page, 'month-count'), monthCount(5));

    // The phone slept through midnight: no timers ran. Coming back focuses the window.
    await page.clock.setSystemTime(Date.parse('2026-11-01T07:30:00Z'));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await seeText(page.getByRole('heading', { level: 1 }), longDate('2026-11-01'));
    await seeText(at(page, 'month-count'), COPY.monthEmpty);
    await eventually(async () => assert.equal(await at(page, 'week-day-2026-11-01').getAttribute('aria-current'), 'date'));
    await seeTextIn(page.locator('body'), fill(COPY.weekRange, { date: ['26 Oct', '1 Nov'] }));

    // The next morning, coming back to the app (it becomes visible again).
    await page.clock.setSystemTime(Date.parse('2026-11-02T07:00:00Z'));
    await setVisibility(page, 'visible');
    await seeText(page.getByRole('heading', { level: 1 }), longDate('2026-11-02'));
    await seeTextIn(page.locator('body'), fill(COPY.weekRange, { date: ['2', '8 Nov'] }));
  });
}
