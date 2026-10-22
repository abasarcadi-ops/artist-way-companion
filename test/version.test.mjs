// The release number and the service worker's precache list.
// Run: node --test test/version.test.mjs (npm test runs it with the rest).
//
// Settings shows APP_VERSION from public/ui/store.js; public/sw.js names its
// cache after VERSION. A release bumps both, or open apps either never pick
// up the new files or show the wrong version. Every file in the worker's
// SHELL list must exist: one missing file fails the whole install, and the
// old worker stays in charge.
//
// sw.js runs here in a small sandbox (a stand-in `self`), so the check reads
// the real constants, however the file is formatted.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { APP_VERSION } from '../public/ui/store.js';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));

// Runs public/sw.js top to bottom and hands back its VERSION, CACHE and SHELL.
async function readWorker() {
  const source = await readFile(join(PUBLIC, 'sw.js'), 'utf8');
  const listeners = [];
  const sandbox = {
    URL,
    console,
    self: {
      location: { href: 'https://example.test/sw.js', origin: 'https://example.test' },
      addEventListener: (type) => listeners.push(type),
      skipWaiting: () => Promise.resolve(),
      clients: { claim: () => Promise.resolve() },
    },
    caches: {},
    fetch: () => Promise.reject(new Error('no network in this test')),
    setTimeout,
    clearTimeout,
    Response: class {},
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(source, context, { filename: 'public/sw.js' });
  // Top-level const declarations live in the context's own scope, so ask for them there.
  const values = vm.runInContext(
    '({ version: typeof VERSION === "undefined" ? undefined : VERSION,' +
      ' cache: typeof CACHE === "undefined" ? undefined : CACHE,' +
      ' shell: typeof SHELL === "undefined" ? undefined : SHELL })',
    context,
  );
  return { ...values, shell: values.shell ? Array.from(values.shell) : values.shell, listeners };
}

async function isFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

test('APP_VERSION in ui/store.js equals VERSION in sw.js', async () => {
  const { version } = await readWorker();
  assert.equal(typeof APP_VERSION, 'string');
  assert.equal(typeof version, 'string', 'public/sw.js defines a VERSION string');
  assert.match(APP_VERSION, /^\d+\.\d+\.\d+$/, 'APP_VERSION looks like 2.0.0');
  assert.equal(version, APP_VERSION, 'bump VERSION in public/sw.js and APP_VERSION in public/ui/store.js together');
});

test('the cache name carries the version', async () => {
  const { version, cache } = await readWorker();
  assert.equal(typeof cache, 'string', 'public/sw.js defines a CACHE name');
  assert.ok(cache.includes(version), `CACHE "${cache}" names VERSION "${version}"`);
});

test('the worker installs, activates and answers fetches', async () => {
  const { listeners } = await readWorker();
  for (const type of ['install', 'activate', 'fetch']) {
    assert.ok(listeners.includes(type), `sw.js listens for ${type}`);
  }
});

test("every file in sw.js's precache list exists in public/", async () => {
  const { shell } = await readWorker();
  assert.ok(Array.isArray(shell) && shell.length > 0, 'public/sw.js has a SHELL list');

  const problems = [];
  for (const entry of shell) {
    if (typeof entry !== 'string' || entry === '') {
      problems.push(`${JSON.stringify(entry)} is not a file path`);
      continue;
    }
    // Paths are relative to sw.js and must stay inside public/.
    const path = normalize(join(PUBLIC, entry));
    if (entry.startsWith('/') || /^[a-z]+:/i.test(entry) || !path.startsWith(PUBLIC.endsWith(sep) ? PUBLIC : PUBLIC + sep)) {
      problems.push(`${entry} is not a path inside public/`);
      continue;
    }
    if (!(await isFile(path))) problems.push(`${entry} is missing`);
  }
  assert.deepEqual(problems, [], 'fix the SHELL list in public/sw.js (a missing file fails the install)');

  const repeated = shell.filter((entry, i) => shell.indexOf(entry) !== i);
  assert.deepEqual(repeated, [], 'files listed twice in SHELL');
});

test('the precache list holds the page, its scripts and styles, and the manifest', async () => {
  const { shell } = await readWorker();
  for (const file of ['index.html', 'app.js', 'core.js', 'content.js', 'accents.js', 'styles.css', 'accents.css', 'manifest.json', 'fonts/fonts.css']) {
    assert.ok(shell.includes(file), `SHELL lists ${file}`);
  }
  // Every module app.js can reach must be there too, or the app breaks offline.
  const modules = await moduleGraph('app.js');
  const missing = modules.filter((file) => !shell.includes(file));
  assert.deepEqual(missing, [], 'modules app.js imports that SHELL leaves out');
});

// app.js and every module it imports, as paths relative to public/.
async function moduleGraph(entry) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = await readFile(join(PUBLIC, file), 'utf8');
    for (const match of source.matchAll(/(?:^|\n)\s*(?:import|export)\s[^'";]*?from\s+['"](\.[^'"]+)['"]/g)) {
      const target = new URL(match[1], `https://x.test/${file}`).pathname.slice(1);
      queue.push(target);
    }
  }
  return [...seen];
}
