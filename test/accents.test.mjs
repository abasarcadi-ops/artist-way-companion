// Accent colour rules for public/accents.css and public/accents.js.
// Run: node --test test/accents.test.mjs
//
// accents.css is parsed and run through a small cascade (media query, selector
// matching, specificity, source order, inheritance) for a root and for a Book
// row in each of the four theme states. Every accent is then checked against
// the token rules in SPEC.md ("Accent colours") in light and in dark, the set
// is checked as a palette, and the notes get the same copy rules as content.js.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACCENTS, CHAPTER_ACCENTS, accentFor } from '../public/accents.js';

const CSS = readFileSync(new URL('../public/accents.css', import.meta.url), 'utf8');

const THEMES = {
  light: { paper: '#FFFFFF', ink: '#0B0B0C' },
  dark: { paper: '#0B0B0C', ink: '#F3F3F4' },
};

// The four ways a page ends up light or dark.
const STATES = [
  { name: 'light, following the OS', os: 'light', dataTheme: null, theme: 'light' },
  { name: 'light, chosen over a dark OS', os: 'dark', dataTheme: 'light', theme: 'light' },
  { name: 'dark, following the OS', os: 'dark', dataTheme: null, theme: 'dark' },
  { name: 'dark, chosen over a light OS', os: 'light', dataTheme: 'dark', theme: 'dark' },
];

const TOKENS = ['--accent', '--on-accent', '--accent-text', '--accent-edge'];
const KEYS = ACCENTS.map((a) => a.key);

// ---------------------------------------------------------------------------
// Colour maths (WCAG 2 contrast, OKLab for the palette checks)

function rgb(hex) {
  assert.match(hex, /^#[0-9A-Fa-f]{6}$/, `not a 6-digit hex colour: ${hex}`);
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
}
const linear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function luminance(hex) {
  const [r, g, b] = rgb(hex).map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function oklab(hex) {
  const [r, g, b] = rgb(hex).map(linear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklch(hex) {
  const [L, a, b] = oklab(hex);
  return { L, C: Math.hypot(a, b), h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 };
}

// Distance in OKLab, times 100 (about 2 is a just-visible difference).
function distance(x, y) {
  const [p, q] = [oklab(x), oklab(y)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) * 100;
}

function hueGap(x, y) {
  const d = Math.abs(oklch(x).h - oklch(y).h) % 360;
  return Math.min(d, 360 - d);
}

const same = (x, y) => x.toUpperCase() === y.toUpperCase();
const fmt = (n) => n.toFixed(2);

// ---------------------------------------------------------------------------
// A small cascade for accents.css

function parseDecls(body, where) {
  const decls = {};
  for (const part of body.split(';')) {
    if (part.trim() === '') continue;
    const m = part.match(/^\s*(--[\w-]+)\s*:\s*(\S(?:.*\S)?)\s*$/s);
    assert.ok(m, `unexpected declaration in ${where}: ${part.trim()}`);
    decls[m[1]] = m[2];
  }
  return decls;
}

function parseCss(css) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  const media = [];
  let prelude = '';
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') {
      const head = prelude.trim().replace(/\s+/g, ' ');
      prelude = '';
      if (head.startsWith('@')) {
        media.push(head);
        continue;
      }
      const end = src.indexOf('}', i);
      assert.ok(end > i, `unclosed rule: ${head}`);
      const selectors = head.split(',').map((s) => s.trim());
      rules.push({
        order: rules.length,
        media: media.at(-1) ?? null,
        selectors,
        compounds: selectors.map(parseSelector),
        decls: parseDecls(src.slice(i + 1, end), head),
      });
      i = end;
    } else if (ch === '}') {
      assert.ok(media.length > 0, 'unbalanced } in accents.css');
      media.pop();
      prelude = '';
    } else {
      prelude += ch;
    }
  }
  assert.equal(media.length, 0, 'unclosed @media in accents.css');
  assert.equal(prelude.trim(), '', `stray text at the end of accents.css: ${prelude.trim()}`);
  return rules;
}

// A selector is compounds joined by descendant combinators (spaces). A compound
// is made of :root, [attr="value"] and :not([attr="value"]).
function parseSelector(selector) {
  return selector.split(/\s+/).map((compound) => {
    const parts = [];
    const re = /:root|:not\(\[([\w-]+)="([^"]*)"\]\)|\[([\w-]+)="([^"]*)"\]/y;
    re.lastIndex = 0;
    while (re.lastIndex < compound.length) {
      const m = re.exec(compound);
      assert.ok(m, `unsupported selector in accents.css: ${selector}`);
      if (m[0] === ':root') parts.push({ type: 'root' });
      else if (m[1]) parts.push({ type: 'not', attr: m[1], value: m[2] });
      else parts.push({ type: 'attr', attr: m[3], value: m[4] });
    }
    return parts;
  });
}

// :root, [attr] and :not([attr]) all weigh the same (one class-level count).
const specificity = (compounds) => compounds.reduce((n, parts) => n + parts.length, 0);

function matchesCompound(el, parts) {
  return parts.every((p) => {
    if (p.type === 'root') return el.parent === null;
    if (p.type === 'attr') return el.attrs[p.attr] === p.value;
    return el.attrs[p.attr] !== p.value;
  });
}

function matches(el, compounds) {
  if (!matchesCompound(el, compounds.at(-1))) return false;
  let i = compounds.length - 2;
  for (let node = el.parent; node && i >= 0; node = node.parent) {
    if (matchesCompound(node, compounds[i])) i--;
  }
  return i < 0;
}

function mediaMatches(media, state) {
  if (media === null) return true;
  const m = media.match(/^@media \(prefers-color-scheme: (light|dark)\)$/);
  assert.ok(m, `unsupported at-rule in accents.css: ${media}`);
  return m[1] === state.os;
}

const RULES = parseCss(CSS);

function computed(el, state) {
  const won = {};
  for (const rule of RULES) {
    if (!mediaMatches(rule.media, state)) continue;
    const hits = rule.compounds.filter((c) => matches(el, c)).map(specificity);
    if (hits.length === 0) continue;
    const spec = Math.max(...hits);
    for (const [prop, value] of Object.entries(rule.decls)) {
      // Rules come in source order, so a later rule wins a tie.
      if (!won[prop] || spec >= won[prop].spec) won[prop] = { spec, value };
    }
  }
  const inherited = el.parent ? computed(el.parent, state) : {};
  return Object.fromEntries(TOKENS.map((t) => [t, won[t]?.value ?? inherited[t]]));
}

// A page: the root (maybe with data-theme and data-accent) and a Book row
// inside a list, carrying its own data-accent.
function page(state, rootAccent, rowAccent) {
  const attrs = {};
  if (state.dataTheme) attrs['data-theme'] = state.dataTheme;
  if (rootAccent) attrs['data-accent'] = rootAccent;
  const root = { parent: null, attrs };
  const list = { parent: root, attrs: {} };
  const row = { parent: list, attrs: rowAccent ? { 'data-accent': rowAccent } : {} };
  return { root, row };
}

// The tokens an accent resolves to in a theme, after checking that the root and
// a Book row agree in both states of that theme.
function tokensFor(key, theme) {
  const results = [];
  const other = KEYS[(KEYS.indexOf(key) + 1) % KEYS.length];
  for (const state of STATES.filter((s) => s.theme === theme)) {
    const onRoot = computed(page(state, key).root, state);
    const onRow = computed(page(state, other, key).row, state);
    assert.deepEqual(onRow, onRoot, `${key}: a Book row and the root differ (${state.name})`);
    results.push({ state, tokens: onRoot });
  }
  assert.deepEqual(results[1].tokens, results[0].tokens, `${key}: ${theme} differs between "${results[0].state.name}" and "${results[1].state.name}"`);
  return results[0].tokens;
}

// ---------------------------------------------------------------------------
// Copy rules for the notes: the same house rules as test/content.test.mjs.

const TYPOGRAPHY = [
  { rule: 'em dash', re: /[—―]/ },
  { rule: 'en dash used as a dash', re: /(?<!\d)–|–(?!\d)/ },
  { rule: 'hyphen used as a dash', re: /\s-\s|--/ },
  { rule: 'emoji', re: /\p{Extended_Pictographic}|\p{Regional_Indicator}|️|⃣/u },
  { rule: 'exclamation mark', re: /[!¡]/ },
];

const BANNED = [
  { rule: 'journey', re: /\bjourney/i },
  { rule: 'unlock', re: /\bunlock/i },
  { rule: "you've got this", re: /\byou(?:['’]ve)? got this\b/i },
  { rule: 'self-care', re: /\bself[\s-]?care\b/i },
  { rule: 'crush', re: /\bcrush/i },
  { rule: 'level up', re: /\blevel(?:l?ing|l?ed)?[\s-]?up\b/i },
  { rule: "let's", re: /\blet['’]s\b/i },
  { rule: 'amazing', re: /\bamazing/i },
  { rule: 'awesome', re: /\bawesome/i },
  { rule: 'streak', re: /\bstreak/i },
  { rule: "don't break the chain", re: /\bbreak(?:ing)? the chain\b/i },
  { rule: 'inner child', re: /\binner[\s-]+(?:creative[\s-]+)?child/i },
  { rule: 'enchant', re: /\benchant/i },
  { rule: 'spark', re: /\bspark/i },
  { rule: 'vibe', re: /\bvibe/i },
  { rule: 'magic', re: /\bmagic/i },
  { rule: 'manifest', re: /\bmanifest/i },
];

const TELLS = [
  { rule: '"not X, but Y" inversion', re: /\bnot\b[^.?!]*,\s*but\b/i },
  {
    rule: '"It\'s not X. It\'s Y." inversion',
    re: /\b(?:it|this|that)(?:['’]s|\s+is|\s+was)\s+(?:not|never)\b[^.?!]*[.?!]\s+(?:it|this|that)(?:['’]s|\s+is|\s+was)\b/i,
  },
  {
    rule: '"X isn\'t Y, it\'s Z" inversion',
    re: /\b(?:isn['’]t|wasn['’]t|aren['’]t)\b[^.?!,]*(?:[.?!]\s+|,\s*)(?:it|this|that|they)(?:['’]s|['’]re|\s+is|\s+was|\s+are)\b/i,
  },
  { rule: '"not because X but because Y"', re: /\bnot because\b[^.?!]*\bbut because\b/i },
  {
    rule: 'colon reveal',
    re: /\b(?:here['’]s|the)\s+(?:thing|truth|secret|trick|catch|kicker|twist|point|answer|key|lesson|difference|result|reason|best part|real reason)\s*:/i,
  },
  {
    rule: 'reveal tease',
    re: /\b(?:nobody|no one) (?:tells|told) you\b|\bhere['’]s (?:what|the part|why)\b|\bplot twist\b|\bspoiler\b/i,
  },
  {
    rule: 'cinematic closer',
    re: /\bpress play\b|\byour move\b|\bnow go\b|\bthe page is waiting\b|\bthe page awaits\b|\bchanges everything\b|\bthat['’]s all it takes\b|\bthe rest is (?:history|yours)\b|\bis yours\.?$/i,
  },
  { rule: '"if X, then Y" formula', re: /\bif\b[^.?!]*\bthen\b/i },
];

const sentencesOf = (text) => text.split(/(?<=[.?!])\s+/).map((s) => s.trim()).filter(Boolean);
const wordCount = (s) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

function hasStaccatoStack(text) {
  let run = 0;
  for (const sentence of sentencesOf(text)) {
    run = wordCount(sentence) <= 3 ? run + 1 : 0;
    if (run >= 3) return true;
  }
  return false;
}

function problemsIn(text) {
  const found = [...TYPOGRAPHY, ...BANNED, ...TELLS].filter(({ re }) => re.test(text)).map(({ rule }) => rule);
  if (hasStaccatoStack(text)) found.push('staccato fragment stack');
  return found;
}

// ---------------------------------------------------------------------------
// accents.css

describe('accents.css', () => {
  test('parses into rules with only accent tokens', () => {
    assert.ok(RULES.length > 0);
    for (const rule of RULES) {
      for (const prop of Object.keys(rule.decls)) assert.ok(TOKENS.includes(prop), `${rule.selectors[0]}: unexpected ${prop}`);
    }
  });

  test('each colour has a light rule and both dark rule pairs, and no colour is missing or extra', () => {
    const DARK_OS = '@media (prefers-color-scheme: dark)';
    const has = (media, selector) =>
      RULES.some((r) => r.media === media && r.selectors.includes(selector) && TOKENS.every((t) => t in r.decls));
    for (const key of KEYS) {
      const k = `[data-accent="${key}"]`;
      assert.ok(has(null, k), `${key}: no light rule`);
      assert.ok(has(DARK_OS, `:root:not([data-theme="light"]) ${k}`), `${key}: no dark rule for a Book row (OS)`);
      assert.ok(has(DARK_OS, `:root:not([data-theme="light"])${k}`), `${key}: no dark rule for the root (OS)`);
      assert.ok(has(null, `:root[data-theme="dark"] ${k}`), `${key}: no dark rule for a Book row (chosen)`);
      assert.ok(has(null, `:root[data-theme="dark"]${k}`), `${key}: no dark rule for the root (chosen)`);
    }
    const mentioned = new Set([...CSS.matchAll(/data-accent="([^"]+)"/g)].map((m) => m[1]));
    assert.deepEqual([...mentioned].sort(), [...KEYS].sort());
  });

  for (const state of STATES) {
    test(`a root without data-accent gets ultramarine (${state.name})`, () => {
      assert.deepEqual(computed(page(state).root, state), computed(page(state, 'ultramarine').root, state));
    });
  }

  test('a root with a key the file does not know falls back to ultramarine', () => {
    for (const state of STATES) {
      assert.deepEqual(computed(page(state, 'no-such-colour').root, state), computed(page(state, 'ultramarine').root, state), state.name);
    }
  });

  test('a Book row keeps its own colour whatever the root uses', () => {
    for (const state of STATES) {
      const row = computed(page(state, 'cadmium-yellow', 'ultramarine').row, state);
      assert.deepEqual(row, computed(page(state, 'ultramarine').root, state), state.name);
      const plain = computed(page(state, 'cadmium-yellow').row, state);
      assert.deepEqual(plain, computed(page(state, 'cadmium-yellow').root, state), `a row without data-accent inherits (${state.name})`);
    }
  });

  test('light and dark really differ where the dark theme needs it', () => {
    // Ultramarine #1F3BFF is under 3:1 on the dark paper, so dark must lift it.
    assert.notEqual(tokensFor('ultramarine', 'dark')['--accent'], tokensFor('ultramarine', 'light')['--accent']);
  });
});

// ---------------------------------------------------------------------------
// The token rules, every accent in both themes

describe('token rules', () => {
  for (const { key, name, chapter } of ACCENTS) {
    for (const theme of ['light', 'dark']) {
      const { paper, ink } = THEMES[theme];
      test(`${chapter} ${name}, ${theme}`, () => {
        const t = tokensFor(key, theme);
        for (const token of ['--accent', '--on-accent', '--accent-text']) {
          assert.match(t[token] ?? '', /^#[0-9A-Fa-f]{6}$/, `${token} should be a 6-digit hex colour`);
        }

        const onFill = contrast(t['--on-accent'], t['--accent']);
        assert.ok(onFill >= 4.5, `--on-accent ${t['--on-accent']} on ${t['--accent']} is ${fmt(onFill)}:1, needs 4.5:1`);

        const asText = contrast(t['--accent-text'], paper);
        assert.ok(asText >= 4.5, `--accent-text ${t['--accent-text']} on ${paper} is ${fmt(asText)}:1, needs 4.5:1`);

        const fill = contrast(t['--accent'], paper);
        if (fill >= 3) {
          assert.equal(t['--accent-edge'], 'transparent', `fill is ${fmt(fill)}:1 on ${paper}, so the edge should be transparent`);
        } else {
          assert.ok(same(t['--accent-edge'], ink), `fill is ${fmt(fill)}:1 on ${paper}, so the edge should be the ink ${ink}, got ${t['--accent-edge']}`);
        }
      });
    }
  }
});

// ---------------------------------------------------------------------------
// The set as a palette

describe('the set', () => {
  const fills = (theme) => ACCENTS.map((a) => tokensFor(a.key, theme)['--accent']);

  test("chapter 1 is Tally's ultramarine", () => {
    assert.equal(CHAPTER_ACCENTS[1], 'ultramarine');
    assert.ok(same(tokensFor('ultramarine', 'light')['--accent'], '#1F3BFF'));
  });

  test("the owner's four sit where he put them", () => {
    const hue = (n) => oklch(tokensFor(CHAPTER_ACCENTS[n], 'light')['--accent']).h;
    assert.ok(hue(3) >= 20 && hue(3) <= 40, `chapter 3 should be a signal red, hue ${hue(3).toFixed(0)}`);
    assert.ok(hue(5) >= 75 && hue(5) <= 100, `chapter 5 should be a yellow, hue ${hue(5).toFixed(0)}`);
    assert.ok(hue(12) >= 165 && hue(12) <= 195, `chapter 12 should be a teal, hue ${hue(12).toFixed(0)}`);
  });

  for (const theme of ['light', 'dark']) {
    test(`twelve distinct colours (${theme})`, () => {
      const f = fills(theme);
      assert.equal(new Set(f.map((x) => x.toUpperCase())).size, 12);
      for (let i = 0; i < f.length; i++) {
        for (let j = i + 1; j < f.length; j++) {
          const d = distance(f[i], f[j]);
          assert.ok(d >= 8, `${ACCENTS[i].name} and ${ACCENTS[j].name} are too close (${d.toFixed(1)})`);
        }
      }
    });

    test(`neighbouring chapters are clearly different (${theme})`, () => {
      const f = fills(theme);
      for (let i = 0; i < f.length - 1; i++) {
        const d = distance(f[i], f[i + 1]);
        assert.ok(d >= 18, `chapters ${i + 1} and ${i + 2} are too alike (${d.toFixed(1)})`);
      }
    });

    test(`no pastels, browns or greys (${theme})`, () => {
      for (const [i, hex] of fills(theme).entries()) {
        const { C } = oklch(hex);
        assert.ok(C >= 0.12, `${ACCENTS[i].name} ${hex} is too dull (chroma ${C.toFixed(3)})`);
      }
    });

    test(`--accent-text is a deeper or lighter version of the fill (${theme})`, () => {
      for (const { key, name } of ACCENTS) {
        const t = tokensFor(key, theme);
        const gap = hueGap(t['--accent-text'], t['--accent']);
        assert.ok(gap <= 10, `${name}: text ${t['--accent-text']} drifts ${gap.toFixed(1)} degrees from ${t['--accent']}`);
      }
    });
  }

  test('dark only changes a fill as much as it needs to', () => {
    for (const { key, name } of ACCENTS) {
      const light = tokensFor(key, 'light')['--accent'];
      const dark = tokensFor(key, 'dark')['--accent'];
      const before = contrast(light, THEMES.dark.paper);
      if (before >= 3) {
        assert.ok(same(dark, light), `${name}: already ${fmt(before)}:1 on the dark paper, so dark should keep ${light}, got ${dark}`);
      } else {
        const after = contrast(dark, THEMES.dark.paper);
        assert.ok(after >= 3 && after <= 3.5, `${name}: dark fill ${dark} should just clear 3:1, got ${fmt(after)}:1`);
        assert.ok(hueGap(dark, light) <= 3, `${name}: dark fill ${dark} changes the hue of ${light}`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// accents.js

describe('ACCENTS and CHAPTER_ACCENTS', () => {
  test('twelve colours in chapter order, each { key, name, chapter, note }', () => {
    assert.equal(ACCENTS.length, 12);
    assert.deepEqual(ACCENTS.map((a) => a.chapter), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    for (const accent of ACCENTS) {
      assert.deepEqual(Object.keys(accent).sort(), ['chapter', 'key', 'name', 'note']);
      assert.equal(typeof accent.name, 'string');
      assert.ok(accent.name.trim().length > 0 && accent.name.length <= 24, `name: ${accent.name}`);
    }
  });

  test('keys are unique and fit the pattern settings.accent accepts', () => {
    assert.equal(new Set(KEYS).size, KEYS.length, 'duplicate key');
    for (const key of KEYS) assert.match(key, /^[a-z][a-z0-9-]{0,23}$/);
    assert.ok(!KEYS.includes('chapter'), '"chapter" is the follow-the-chapter setting, not a colour');
  });

  test('names are unique', () => {
    assert.equal(new Set(ACCENTS.map((a) => a.name)).size, ACCENTS.length);
  });

  test('every chapter 1 to 12 maps to an existing key, its own one', () => {
    assert.deepEqual(Object.keys(CHAPTER_ACCENTS).map(Number).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    for (const [num, key] of Object.entries(CHAPTER_ACCENTS)) {
      assert.ok(KEYS.includes(key), `chapter ${num} maps to unknown key ${key}`);
      assert.equal(ACCENTS.find((a) => a.key === key).chapter, Number(num), `chapter ${num} maps to ${key}, which belongs to another chapter`);
    }
    assert.equal(new Set(Object.values(CHAPTER_ACCENTS)).size, 12, 'two chapters share a colour');
  });
});

describe('notes', () => {
  test('the checker flags known bad lines', () => {
    for (const [text, rule] of [
      ['Blue — for calm', 'em dash'],
      ['A bold red!', 'exclamation mark'],
      ['Green for your creative journey.', 'journey'],
      ['Yellow \u{1F31E} for hope.', 'emoji'],
      ['Not a colour, but a feeling.', '"not X, but Y" inversion'],
      ['If you pick it, then it fits.', '"if X, then Y" formula'],
      ['Red. Hot. Loud.', 'staccato fragment stack'],
    ]) {
      assert.ok(problemsIn(text).includes(rule), `expected "${rule}" for ${JSON.stringify(text)}, got ${JSON.stringify(problemsIn(text))}`);
    }
  });

  for (const { name, note } of ACCENTS) {
    test(`${name}: one plain short line`, () => {
      assert.equal(typeof note, 'string');
      assert.deepEqual(problemsIn(note), [], note);
      assert.equal(sentencesOf(note).length, 1, `one sentence: ${note}`);
      assert.match(note, /^[A-Z].*\.$/, `starts with a capital and ends with a period: ${note}`);
      assert.ok(note.length <= 90, `${note.length} characters is too long for one line`);
      assert.doesNotMatch(note, /^\s|\s$|\s{2}|\n/, 'stray whitespace');
      assert.doesNotMatch(note, /[‘’“”]/, 'curly quote');
    });
  }

  test('notes are all different', () => {
    assert.equal(new Set(ACCENTS.map((a) => a.note)).size, ACCENTS.length);
  });
});

describe('accentFor', () => {
  test('follows the chapter by default and when set to "chapter"', () => {
    for (let n = 1; n <= 12; n++) {
      assert.equal(accentFor(n), CHAPTER_ACCENTS[n]);
      assert.equal(accentFor(n, 'chapter'), CHAPTER_ACCENTS[n]);
    }
  });

  test('a pinned key wins over the chapter', () => {
    assert.equal(accentFor(3, 'cobalt-teal'), 'cobalt-teal');
    assert.equal(accentFor(12, 'ultramarine'), 'ultramarine');
    for (const key of KEYS) assert.equal(accentFor(7, key), key);
  });

  test('an unknown pinned key falls back to the chapter', () => {
    assert.equal(accentFor(5, 'no-such-colour'), CHAPTER_ACCENTS[5]);
    assert.equal(accentFor(5, 'Ultramarine'), CHAPTER_ACCENTS[5], 'keys are case sensitive');
    assert.equal(accentFor(9, ''), CHAPTER_ACCENTS[9]);
    assert.equal(accentFor(9, null), CHAPTER_ACCENTS[9]);
    assert.equal(accentFor(9, undefined), CHAPTER_ACCENTS[9]);
  });

  test('a chapter outside 1 to 12 gets the first colour', () => {
    for (const n of [0, 13, -1, undefined, null, 'x']) assert.equal(accentFor(n), ACCENTS[0].key);
  });
});
