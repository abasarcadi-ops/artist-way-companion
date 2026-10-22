# Artist's Way Companion v2 · Spec

A companion for working through *The Artist's Way* with a paper notebook. Morning pages get written longhand. The app tracks them by date, runs the writing timer, holds the weekly artist date and check-in, and keeps the course self-paced.

v1 (single `index.html`, commit `33a3d41`) is replaced completely. Its saved data must carry over.

## Principles

1. One obvious next thing. Before today's pages are done, the screen is about the pages.
2. Count what's done, never what's missed. No breaking streaks, no red, no X marks, no "0 / 84", no course percentages.
3. Coming back after a gap is a normal path. Say it plainly once, offer the smallest step (one page).
4. Real dates. Pages belong to a calendar date (device local time). Chapters are self-paced: you stay on a chapter until you move on.
5. Calm, not cute. No emoji, confetti, exclamation marks or slogans.
6. Thumb-first. Main controls in the lower two thirds, targets at least 48px.

## Layout of the repo

```
public/              what Netlify serves (netlify.toml: publish = "public", no build)
  index.html
  app.js             UI entry, ES module, imports core.js, content.js, accents.js (may split into ui/*.js)
  core.js            pure logic, ES module, no DOM, never reads the clock itself
  content.js         all copy and decks, ES module, plain data
  accents.js         chapter accent map and accent list
  styles.css
  accents.css        accent tokens per colour, light and dark
  fonts/             self-hosted woff2 + fonts.css
  sw.js
  manifest.json
  icon.svg, icon-192.png, icon-512.png, apple-touch-icon.png
test/
  core.test.mjs      node:test
  content.test.mjs   node:test, copy rules
  accents.test.mjs   node:test, contrast rules for every accent
  e2e.mjs            Playwright, phone size
  server.mjs         static server for public/, port 8910, ?today=YYYY-MM-DD override (localhost only)
package.json         "test": "node --test test/*.test.mjs", "dev": "node test/server.mjs", "e2e": "node test/e2e.mjs"
```

## Data

localStorage key `awc.v2`. v1 key `artists_way_tracker_v1` is read once for migration and never written or deleted.

```js
{
  version: 2,
  createdAt: "2026-10-22T06:40:00.000Z",   // ISO, set once
  course: { chapter: 4 },                   // current chapter, 1..12
  chapters: {                               // only chapters that have been touched, keys "1".."12"
    "4": {
      startedOn: "2026-10-19",              // date key or null (null = not started yet / picked up after migration)
      finishedOn: null,                     // date key or null
      read: false,                          // read the chapter in the book
      artistDate: { plan: "", ideaId: null, doneOn: null, note: "" },
      checkin: { doneOn: null, lineUp: "", matters: "" },
      legacy: null                          // { mornings: n, artistDate: bool } carried from v1
    }
  },
  days: {                                   // keyed by local date key
    "2026-10-13": { pages: 3, keep: "" }    // pages 0..3, keep = one line worth keeping
  },
  settings: { theme: "system", minutes: 25, bell: true, rain: false, accent: "chapter" },  // accent: "chapter" or an accent key
  seen: { starters: [], ideas: [] },        // ids picked recently, to avoid repeats (cap 20 each)
  legacyV1: null                            // raw v1 object, kept verbatim after migration
}
```

Date keys are `YYYY-MM-DD` in device local time. Never `toISOString()` for date keys (UTC breaks around midnight).

Other keys the UI keeps next to `awc.v2`:
- `awc.timer`: the running or paused writing session, so a killed app can reopen it (paused within 3 h, ended within 30 min).
- `awc.drafts`: unsent check-in answers and an unsaved own artist-date plan, per chapter. Cleared on submit, start over and restore.
- `awc.v2.unread` (then `.2`, `.3`, ...): a copy of any `awc.v2` value this version could not read, made before anything is written. Never overwritten.

## core.js API

Pure functions. The caller passes `today` (a date key) in. Functions that change state return a new state object and never mutate the input.

Dates
- `dateKey(date)` → `"YYYY-MM-DD"` local
- `parseKey(key)` → `Date` at local noon (noon avoids DST edge cases)
- `addDays(key, n)` → key
- `daysBetween(a, b)` → whole calendar days from a to b (b later = positive)
- `weekOf(key)` → 7 keys, Monday to Sunday, containing key
- `monthOf(key)` → `"YYYY-MM"`

State
- `emptyState(today, nowIso)` → fresh v2 state, chapter 1, chapter 1 not started
- `load({ v2Raw, v1Raw, today, nowIso })` → `{ state, migrated: bool, needsPickUp: bool }`. Accepts strings or null for the raws. Never throws: garbage in = empty state out. v2 wins over v1 when both exist. Normalizes every field (clamps pages to 0..3, drops invalid date keys, fills missing chapter fields, chapter outside 1..12 becomes 1).
- `migrateV1(v1, today, nowIso)` → v2 state (rules below)
- `serialize(state)` → JSON string

Pages
- `pagesOn(state, key)` → 0..3
- `tapPage(state, key, slot, today)` → slot 1..3. If pages on key >= slot then pages = slot - 1, else pages = slot. Refuses future dates (returns state unchanged).
- `setPages(state, key, n, today)` → clamps 0..3, refuses future dates. Setting 0 keeps any `keep` line.
- `setKeep(state, key, text)` → trims, max 280 chars
- `lastPagesBefore(state, key)` → latest date key before `key` with pages > 0, or null
- `reentry(state, today)` → null when today has pages or the gap is under 3 days. Otherwise `{ gapDays, lastKey, bucket }` with bucket `"days"` (3 to 6), `"week"` (7 to 20), `"weeks"` (21+), `"never"` (no dated pages at all).
- `monthPages(state, today)` → total pages in today's calendar month
- `weekRow(state, today)` → 7 items `{ key, pages, isToday, isFuture }`
- `keptLines(state)` → `[{ key, text }]` newest first, only non-empty

Chapters
- `chapterInfo(state, today)` → `{ num, startedOn, dayOfChapter, readyToMove }` for the current chapter. `dayOfChapter` = daysBetween(startedOn, today) + 1, null if not started. `readyToMove` = dayOfChapter >= 7.
- `startChapter(state, num, today)` → sets course.chapter = num and that chapter's startedOn = today, finishedOn = null. Starting a chapter again (restart) resets startedOn only; artist date, read, notes stay.
- `finishChapter(state, today, { lineUp, matters })` → sets checkin.doneOn = today plus answers, finishedOn = today, and starts the next chapter today (stays on 12 after the last, finishedOn set).
- `chapterStats(state, num, today)` → `{ mornings, pages, artistDateDone }`. Mornings = days with pages > 0 from startedOn to finishedOn (or today), plus legacy mornings. artistDateDone = doneOn set or legacy artistDate true.
- `setRead(state, num, bool)`
- `chapterStatus(state, num, today)` → `"current" | "done" | "upcoming"`. Done = finishedOn set or (num < current and touched).

Artist date (per chapter)
- `planArtistDate(state, num, plan, ideaId)` → sets plan (trimmed, max 200) and ideaId, clears doneOn
- `clearArtistPlan(state, num)`
- `markArtistDate(state, num, today)` → doneOn = today (requires a plan; if none, plan stays "")
- `unmarkArtistDate(state, num)`
- `setArtistNote(state, num, text)` → max 600
- `artistDateState(state, num)` → `"unplanned" | "planned" | "done"`

Decks
- `pickNext(deck, seenIds, rand = Math.random)` → an item whose id isn't in the last `min(20, deck.length - 1)` seen ids. Deterministic given rand.
- `markSeen(state, kind, id)` → kind `"starters" | "ideas"`, keeps the last 20

Settings and backup
- `setSetting(state, key, value)` → validates: theme in system/light/dark, minutes in 20/25/30, bell/rain booleans, accent = "chapter" or a lowercase key matching /^[a-z][a-z0-9-]{0,23}$/ (the UI falls back to the chapter colour for a key it does not know)
- `exportBackup(state, nowIso)` → JSON string `{ app: "artists-way-companion", version: 2, exportedAt, state }`
- `importBackup(text, today, nowIso)` → `{ ok, state, error }`. Accepts a v2 backup, a bare v2 state, or a v1 export (the old app exported its raw state). Error messages in plain English.

Timer (pure helpers, the UI owns the interval)
- `timerStart(minutes, nowMs)` → `{ endsAt, minutes, pausedLeft: null }`
- `timerLeft(timer, nowMs)` → ms left, never negative
- `timerPause(timer, nowMs)` / `timerResume(timer, nowMs)`

## Migration from v1

v1 shape: `{ weeks: { "1": { days: [7 booleans], artistDate: bool, artistDateNote: string }, ... "12" }, openWeeks: [], quoteIndex: n, theme: "light" | "dark" }`. v1 ticks have no dates.

- For each week with any tick, artistDate true, or a note: chapter `legacy = { mornings: count of true days, artistDate }`, `artistDate.note = artistDateNote`.
- Weeks below the suggested chapter that were touched get `finishedOn = null` but count as done through `chapterStatus` (num < current and touched).
- Suggested chapter = highest week with any tick or artist date. If that week is complete (7 days and artist date), the next one (max 12). If nothing ticked, 1.
- `course.chapter` = suggested, its `startedOn = null`, so the UI shows the pick-up step: "Pick up at week N" with "Start week N today" and "Choose another week".
- `days` stays empty. No pages get invented on real dates.
- `legacyV1` = the raw v1 object. The v1 key is left in place.

## Screens

Today
- Date, chapter line ("Week 4 · Integrity" plus day of chapter), settings entry.
- Pick-up card instead of the chapter line when the current chapter has no startedOn.
- Re-entry line (from `reentry`), copy from content.js by bucket.
- Morning pages: three slots, "Start writing", partial "n of 3", done line and the optional keep line.
- This week strip (Mon to Sun). Tap a past or current day to set its pages (backfill sheet with 0 1 2 3).
- Chapter move: when `readyToMove`, a quiet line "Day 8 of week 4. Move on when you're ready." opens the check-in.
- Artist date card for the current chapter (unplanned, planned, done).
- Month count, count-up only.

Writing (overlay from Today)
- Timer with 20/25/30 presets, start, pause, reset. Wall-clock based so it survives sleep. Wake lock while running. Synth bell at the end, optional synth rain. Sound starts only from a tap.
- Starter line plus "Another line". Three page slots. Done returns to Today.
- An app update never reloads the page while the timer runs.

Book
- 12 chapters as a contents page: current, done (mornings, artist date), upcoming.
- Chapter page: title, what the chapter is about (content.js, own words), read tick, artist date, check-in answers if done, stats, "Start this week" for a non-current chapter (in-page confirm).

Check-in (sheet, finishing a chapter)
- Auto line: pages and mornings this chapter, artist date done or not.
- Two optional questions from content.js, then "Start week N+1".

Kept
- Every keep line, newest first, with its date. Designed empty state.

Settings (sheet)
- Theme, colour (follow the chapter, or pin one colour), timer length, bell, rain, backup (copy to clipboard, download file, restore from file), start over (in-page confirm), version.

## Design: Tally

The approved direction is `design/mockups/tally.html` (gitignored, local only): Swiss grid, Schibsted Grotesk with tabular figures, black and white, one loud accent. Pages are vertical strokes, three a day. Only real strokes exist, nothing is ever crossed out.

## Accent colours (one per chapter)

Each chapter has its own accent, like a 12-colour paint set. The accent follows the current chapter unless a colour is pinned in Settings (`settings.accent`: `"chapter"` or an accent key).

- `public/accents.css` defines every accent as tokens on any element with `data-accent="<key>"` (the root, or a Book row), for light and dark, using the same three-state theme pattern as the rest of the CSS.
- `public/accents.js` exports `ACCENTS` (`[{ key, name, chapter, note }]` in chapter order), `CHAPTER_ACCENTS` (`{ 1: "<key>", ... 12: "<key>" }`) and `accentFor(chapter, pinned)`. Keys are stored when a colour is pinned, so they never get renamed.
- The app sets `document.documentElement.dataset.accent`. Components only ever use these tokens, never a literal accent colour:
  - `--accent`: fills (strokes, today's cell, the primary button)
  - `--on-accent`: text and icons on an accent fill, at least 4.5:1
  - `--accent-text`: accent used as text or thin lines on the paper, at least 4.5:1
  - `--accent-edge`: outline drawn around accent fills on the paper. `transparent` when the fill reaches 3:1 against the paper, otherwise the ink colour (a yellow stroke on white gets an ink outline).
- In Book, each chapter row uses its own chapter's accent, so the contents page reads as the colour chart of the course.

## PWA

- Keep the v1 public file names so an installed home-screen app and the old service worker find them: `manifest.json`, `icon.svg`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`, all at the site root (inside `public/`). `sw.js` stays at the root so it replaces the v1 worker in the same scope.
- Manifest name "Artist's Way", standalone, portrait, colours from Tally.
- Fonts self-hosted in `public/fonts/` (woff2 plus `fonts.css`), so the app works offline and makes no third-party requests.
- Service worker: network-first for every same-origin GET with a 2.5 s timeout, falling back to the cache when offline. Precache the app shell on install. Delete every other cache on activate (this also clears v1's `artists-way-v1`). `CACHE` name carries the app version.
- When a new worker takes control, reload once, but never while the Writing timer runs (defer until it stops).
- netlify.toml: `publish = "public"`, no build command, `no-cache` on `/sw.js`, `/index.html`, `/` and `/manifest.json`.

## Testing

- `npm test`: core and content unit tests.
- `npm run e2e`: Playwright at 390x844. Fresh start, v1 migration plus pick-up, page taps, backfill, artist date flow, check-in, timer start and pause, theme toggle, reload keeps state.
- `?today=YYYY-MM-DD` works on localhost only, so tests can move the clock.

## Deploy

Code on GitHub `abasarcadi-ops/artist-way-companion`, branch `main`. Netlify project `artists-way-companion` (artists-way-companion.netlify.app) is not linked to GitHub: `node deploy.mjs` uploads `public/` and `netlify.toml` through the Netlify MCP. Each deploy costs 15 credits from the shared team cap. Same origin as v1, so the old saved data is there to migrate.
