// Unit tests for the parts of the UI layer that hold logic: the storage
// guard at start-up, other tabs, saves waiting for a pause in typing, drafts,
// and text helpers. Run: node --test test/ui.test.mjs
//
// store.js only touches `window` inside its functions, so each test hands it
// a stand-in window with a fake localStorage, and imports a fresh copy of the
// module (a query string makes a new module instance).

import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { emptyState, serialize, setPages, startChapter } from '../public/core.js';
import { DONE_LINES, REENTRY } from '../public/content.js';
import { sentences } from '../public/ui/dom.js';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const TODAY = '2026-10-22';
const NOW = '2026-10-22T06:40:00.000Z';

const V1_KEY = 'artists_way_tracker_v1';
const V3 = JSON.stringify({ version: 3, course: { chapter: 6 }, days: { [TODAY]: { pages: 3 } } });

function v1Raw() {
  const weeks = {};
  for (let n = 1; n <= 12; n += 1) weeks[n] = { days: [false, false, false, false, false, false, false], artistDate: false, artistDateNote: '' };
  weeks[2] = { days: [true, true, true, false, false, false, false], artistDate: true, artistDateNote: 'Flea market' };
  return JSON.stringify({ weeks, openWeeks: [], quoteIndex: 0, theme: 'light' });
}

// A stand-in for the browser window: localStorage, location, listeners.
function fakeWindow(items = {}, { failOn = [] } = {}) {
  const store = new Map(Object.entries(items));
  const writes = [];
  const listeners = {};
  return {
    store,
    writes,
    listeners,
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => {
        if (failOn.includes(key)) throw new Error('QuotaExceededError');
        writes.push(key);
        store.set(key, String(value));
      },
      removeItem: (key) => {
        writes.push(`-${key}`);
        store.delete(key);
      },
    },
    location: { hostname: 'example.test', search: '' },
    addEventListener: (type, fn) => {
      (listeners[type] ??= []).push(fn);
    },
  };
}

let instance = 0;
async function freshStore(win) {
  globalThis.window = win;
  instance += 1;
  return import(`../public/ui/store.js?instance=${instance}`);
}

afterEach(() => {
  delete globalThis.window;
});

// ---------------------------------------------------------------------------

describe('start-up guard in boot()', () => {
  test('an unreadable awc.v2 is copied to awc.v2.unread before anything is written', async () => {
    const win = fakeWindow({ 'awc.v2': V3, [V1_KEY]: v1Raw() });
    const store = await freshStore(win);
    const { source } = store.boot();
    assert.equal(source, 'v1');
    assert.equal(win.store.get('awc.v2.unread'), V3);
    assert.equal(win.writes[0], 'awc.v2.unread', 'the copy is the very first write');
    assert.equal(JSON.parse(win.store.get('awc.v2')).version, 2, 'then the migrated state is saved');
    assert.equal(win.store.get(V1_KEY), v1Raw(), 'the old app key is untouched');
  });

  test('an earlier, different copy is never overwritten', async () => {
    const win = fakeWindow({ 'awc.v2': V3, 'awc.v2.unread': 'an older copy' });
    const store = await freshStore(win);
    store.boot();
    assert.equal(win.store.get('awc.v2.unread'), 'an older copy');
    assert.equal(win.store.get('awc.v2.unread.2'), V3);
  });

  test('when the copy cannot be written, awc.v2 is never written either', async () => {
    const win = fakeWindow({ 'awc.v2': V3 }, { failOn: ['awc.v2.unread'] });
    const store = await freshStore(win);
    store.boot();
    assert.equal(win.store.get('awc.v2'), V3);
    store.commit(setPages(store.app.state, TODAY, 2, TODAY));
    assert.equal(win.store.get('awc.v2'), V3, 'not by a later save either');
    assert.deepEqual(win.writes, []);
  });

  test('with every copy slot taken, nothing is written', async () => {
    const items = { 'awc.v2': V3 };
    for (let slot = 1; slot <= 20; slot += 1) items[slot === 1 ? 'awc.v2.unread' : `awc.v2.unread.${slot}`] = `copy ${slot}`;
    const win = fakeWindow(items);
    const store = await freshStore(win);
    store.boot();
    store.commit(setPages(store.app.state, TODAY, 1, TODAY));
    assert.equal(win.store.get('awc.v2'), V3);
    assert.deepEqual(win.writes, []);
  });

  test('a readable awc.v2 is loaded and nothing is written at start-up', async () => {
    const saved = serialize(startChapter(emptyState(TODAY, NOW), 4, TODAY));
    const win = fakeWindow({ 'awc.v2': saved, [V1_KEY]: v1Raw() });
    const store = await freshStore(win);
    const { source } = store.boot();
    assert.equal(source, 'v2');
    assert.equal(store.app.state.course.chapter, 4);
    assert.deepEqual(win.writes, []);
  });

  test('only the old app: migrated and saved once, no copy made', async () => {
    const win = fakeWindow({ [V1_KEY]: v1Raw() });
    const store = await freshStore(win);
    store.boot();
    assert.deepEqual(win.writes, ['awc.v2']);
    assert.equal(win.store.get('awc.v2.unread'), undefined);
  });
});

describe('other tabs', () => {
  test("another tab's save becomes this tab's state and redraws the screen", async () => {
    const win = fakeWindow({ 'awc.v2': serialize(emptyState(TODAY, NOW)) });
    const store = await freshStore(win);
    store.boot();
    let renders = 0;
    store.setRenderer(() => {
      renders += 1;
    });
    store.watchOtherTabs();
    const [onStorage] = win.listeners.storage;

    const theirs = setPages(startChapter(emptyState(TODAY, NOW), 3, TODAY), TODAY, 2, TODAY);
    onStorage({ key: 'awc.v2', newValue: serialize(theirs) });
    assert.deepEqual(store.app.state, theirs);
    assert.equal(renders, 1);
    assert.deepEqual(win.writes, [], 'adopting it writes nothing back');

    onStorage({ key: 'awc.timer', newValue: '{}' });
    onStorage({ key: 'awc.v2', newValue: null });
    assert.equal(renders, 1, 'other keys and removals are ignored');
  });

  test('a save this version cannot read stops this tab from writing', async () => {
    const win = fakeWindow({ 'awc.v2': serialize(emptyState(TODAY, NOW)) });
    const store = await freshStore(win);
    store.boot();
    store.setRenderer(() => {});
    store.watchOtherTabs();
    const before = store.app.state;
    win.store.set('awc.v2', V3); // the newer tab's write
    win.listeners.storage[0]({ key: 'awc.v2', newValue: V3 });
    assert.equal(store.app.state, before, 'its data is not taken');
    store.commit(setPages(store.app.state, TODAY, 3, TODAY));
    assert.equal(win.store.get('awc.v2'), V3, 'and never overwritten');
  });
});

describe('saves waiting for a pause in typing', () => {
  test('flushPending pushes every waiting save through, once', async () => {
    const store = await freshStore(fakeWindow());
    const calls = [];
    const saveA = store.pendingSave((text) => calls.push(`a:${text}`), 60_000);
    const saveB = store.pendingSave((text) => calls.push(`b:${text}`), 60_000);
    saveA('d');
    saveA('dr');
    saveB('note');
    assert.deepEqual(calls, []);
    store.flushPending();
    assert.deepEqual(calls.sort(), ['a:dr', 'b:note']);
    store.flushPending();
    assert.equal(calls.length, 2, 'nothing left to save the second time');
  });
});

describe('drafts', () => {
  test('kept in storage until cleared, and garbage reads as empty', async () => {
    const win = fakeWindow();
    const store = await freshStore(win);
    assert.equal(store.getDraft('checkin-4-lineUp'), '');
    store.setDraft('checkin-4-lineUp', 'A door opened.');
    store.setDraft('own-4', 'Saturday at the market');
    assert.equal(store.getDraft('checkin-4-lineUp'), 'A door opened.');
    store.setDraft('checkin-4-lineUp', '');
    assert.equal(store.getDraft('checkin-4-lineUp'), '');
    assert.equal(store.getDraft('own-4'), 'Saturday at the market');
    store.clearDrafts();
    assert.equal(win.store.has('awc.drafts'), false);

    win.store.set('awc.drafts', 'not json');
    assert.equal(store.getDraft('own-4'), '');
    win.store.set('awc.drafts', '["a"]');
    assert.equal(store.getDraft('0'), '');
  });

  test('the last draft removed takes the key with it', async () => {
    const win = fakeWindow();
    const store = await freshStore(win);
    store.setDraft('own-2', 'x');
    store.setDraft('own-2', '');
    assert.equal(win.store.has('awc.drafts'), false);
  });
});

describe('sentences', () => {
  test('splits after . ? and ! and keeps the marks', () => {
    assert.deepEqual(sentences('Three pages. Done for today.'), ['Three pages.', 'Done for today.']);
    assert.deepEqual(sentences("That's today's pages done."), ["That's today's pages done."]);
    assert.deepEqual(sentences('One? Two!  Three.'), ['One?', 'Two!', 'Three.']);
    assert.deepEqual(sentences('No end mark'), ['No end mark']);
    assert.deepEqual(sentences(''), []);
  });

  test('every done line and re-entry line comes back whole', () => {
    for (const line of [...DONE_LINES, ...Object.values(REENTRY).flat()]) {
      assert.equal(sentences(line).join(' '), line, line);
    }
  });
});

describe('the shipped code parses on older iPhones', () => {
  async function scripts(dir = PUBLIC) {
    const out = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...(await scripts(path)));
      else if (entry.name.endsWith('.js')) out.push(path);
    }
    return out;
  }

  test('no regex lookbehind in any file under public/ (Safari before 16.4 rejects the whole module)', async () => {
    const found = [];
    for (const file of await scripts()) {
      const source = await readFile(file, 'utf8');
      if (/\(\?<[=!]/.test(source)) found.push(file.slice(PUBLIC.length));
    }
    assert.deepEqual(found, []);
  });
});
