# Artist's Way Companion

A phone web app for working through *The Artist's Way* with a paper notebook. The morning pages get written by hand. The app counts them by date, runs the writing timer, holds the weekly artist date and check-in, and lets you take the twelve chapters at your own pace.

It is a static site: HTML, CSS and plain ES modules in `public/`. No build step, no accounts, no server code. Added to the home screen from Safari, it runs full screen and works offline.

## Run it

Needs Node 20 or later.

```sh
npm run dev
```

This serves `public/` at http://localhost:8910 with caching turned off, so a reload always shows the files on disk. `PORT=9000 npm run dev` uses another port. `HOST=0.0.0.0 npm run dev` lets a phone on the same network open it.

The app itself has no dependencies. `npm install` is only needed for the browser tests.

### Test another day

On localhost the app takes its date from `?today=YYYY-MM-DD`:

```
http://localhost:8910/?today=2026-10-22
```

Handy for checking a new week, a gap of a few days or the turn of a month without touching the computer's clock. The live site ignores it and always uses the phone's own date.

## Tests

```sh
npm test       # unit tests, test/*.test.mjs (node:test, nothing to install)
npm install    # once, for the browser tests
npm run e2e    # Playwright: Chromium at iPhone size, 390x844 at 3x
```

`npm run e2e` starts its own server on a free port, gives every test a fresh browser (empty storage, no service worker) and exits with an error when a test fails. Screenshots go to `test-results/`. `HEADED=1 npm run e2e` shows the browser while it runs. If Playwright says its browser is missing, run `npx playwright install chromium`.

Playwright is pinned to an exact version in `package.json`.

## What's where

```
public/               everything the site serves
  index.html
  app.js, ui/*.js     the interface
  core.js             pure logic: dates, saved state, v1 migration (no DOM)
  content.js          all copy and the prompt decks
  accents.js, .css    one accent colour per chapter
  styles.css
  fonts/              Schibsted Grotesk: woff2 files, fonts.css, licence
  sw.js               service worker
  manifest.json, icon.svg, icon-192.png, icon-512.png,
  icon-maskable-512.png, apple-touch-icon.png
test/
  *.test.mjs          unit tests: core, content, accent contrast
  e2e.mjs             browser tests
  server.mjs          the local server
SPEC.md               what the app does and why
```

Fonts and icons are served from the site itself, so the app never calls a third party.

## Where the data lives

On the phone only, in `localStorage` under the key `awc.v2`. Nothing is sent anywhere. Settings has a backup: copy it, download it as a file, or restore from a file. Make one before changing phones or clearing website data.

Data from the first version of the app (key `artists_way_tracker_v1`) is migrated the first time the new version opens. The old key is only read: it is never changed or deleted, so the original data stays on the phone.

## Deploys

Netlify is not linked to GitHub, so pushing does not deploy. `node deploy.mjs` stages `public/` and `netlify.toml` in a temp folder and uploads them through the Netlify MCP's deploy-site operation (`node deploy.mjs --site-id <id> --proxy-path "<url>"`, or `--stage` to only stage). `netlify.toml` publishes `public/` as it is, with no build command, and sets the cache headers: `sw.js`, `index.html`, `/` and `manifest.json` are checked with the server on every load, and the font files are kept for a year.

Each deploy uses credits from a shared team cap. Batch changes, run `npm test` and `npm run e2e` first, bump `VERSION` in `public/sw.js` and `APP_VERSION` in `public/ui/store.js` together, then deploy once.

The site keeps the address of the first version, so its saved data is there to migrate.

### The service worker

`public/sw.js` answers every same-origin GET from the network first. When the network takes longer than 2.5 s, or there is none, the cached copy is used. Scripts are the exception: they always wait for the network and only fall back to the cache when there is no network at all, so a slow connection after a deploy can't mix old and new modules. Every good answer is stored, so the cache keeps up with the latest deploy on its own.

Before each release:

1. bump `VERSION` in `public/sw.js`, and keep `APP_VERSION` in `public/ui/store.js` (shown in Settings) equal to it,
2. when a file in `public/` was added, removed or renamed, update the `SHELL` list in `public/sw.js` too. `npm run e2e` fails until the list matches the folder.

A new `VERSION` installs a new worker. It caches the shell, takes over straight away and deletes every older cache. The app then reloads once, but never in the middle of something: it waits while the writing screen is open or its timer runs, while a sheet is open and while a text field has focus, then reloads as soon as that ends or the app goes to the background (unless a writing session is still going). Pending saves are written first. Without a new `VERSION` the files still update (network first), but an app that stays open keeps running the old code until it is closed.

The font files are cached for a year under their names, so never replace one in place. A new font version gets new file names, in `fonts/fonts.css` and in `SHELL`.

## Licences

Schibsted Grotesk is licensed under the SIL Open Font License 1.1, see `public/fonts/OFL.txt`.
