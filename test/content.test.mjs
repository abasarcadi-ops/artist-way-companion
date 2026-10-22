// Copy rules for public/content.js.
// Run: node --test test/content.test.mjs
//
// Every string in every export is walked and checked against the house rules
// (typography, banned words, AI tells, placeholders), then each deck's shape
// is checked. The checker also gets tested on known bad lines, so a broken
// regex can't let everything through.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as content from '../public/content.js';

const { CHAPTERS, STARTERS, IDEAS, REENTRY, PICKUP, DONE_LINES, CHECKIN, COPY } = content;

// ---------------------------------------------------------------------------
// Walking every string

function walk(value, path, out = []) {
  if (typeof value === 'string') {
    out.push({ path, text: value });
  } else if (Array.isArray(value)) {
    value.forEach((item, i) => walk(item, `${path}[${i}]`, out));
  } else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) walk(item, `${path}.${key}`, out);
  }
  return out;
}

const STRINGS = Object.entries(content).flatMap(([name, value]) => walk(value, name));

// ---------------------------------------------------------------------------
// The rules

const TYPOGRAPHY = [
  { rule: 'em dash', re: /[—―]/ },
  // An en dash is only allowed inside a number range like 20–30.
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

// The AI tells from the voice notes. Heuristics: they catch the usual shapes.
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

function sentencesOf(text) {
  return text
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function wordCount(sentence) {
  return sentence.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

// Three or more sentences of three words or fewer in a row ("Pen. Paper. Go.").
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

// Placeholder names documented at the top of content.js.
const PLACEHOLDERS = new Set([
  'n', 'name', 'day', 'date', 'month', 'next', 'current',
  'pages', 'mornings', 'artistDate', 'time', 'version',
]);

const TITLES = [
  'Recovering a Sense of Safety',
  'Recovering a Sense of Identity',
  'Recovering a Sense of Power',
  'Recovering a Sense of Integrity',
  'Recovering a Sense of Possibility',
  'Recovering a Sense of Abundance',
  'Recovering a Sense of Connection',
  'Recovering a Sense of Strength',
  'Recovering a Sense of Compassion',
  'Recovering a Sense of Self-Protection',
  'Recovering a Sense of Autonomy',
  'Recovering a Sense of Faith',
];

const KINDS = ['out', 'make', 'look', 'listen', 'wander', 'home'];
const COSTS = ['free', 'cheap', 'some'];

const EXACT_COPY = {
  morningPages: 'Morning pages',
  morningSub: 'Three pages, longhand, before anything else.',
  startWriting: 'Start writing',
  keepPrompt: 'Anything worth keeping?',
  keepPlaceholder: "One line from today's pages",
  artistDate: 'Artist date',
  artistSub: 'Two hours, alone, doing something that feeds you.',
  another: 'Another',
  planThis: 'Plan this one',
  didIt: 'Did it',
  change: 'Change',
  artistDoneAsk: 'Done. How was it?',
  writingLine: 'Phone face down. A bell rings at the end.',
  stuckLine: "Can't start? Copy this line onto the page.",
  anotherLine: 'Another line',
};

function failuresFor(check) {
  const failures = [];
  for (const { path, text } of STRINGS) {
    const problem = check(text);
    if (problem) failures.push(`${path}: ${problem} in ${JSON.stringify(text)}`);
  }
  return failures;
}

function rulesCheck(rules) {
  return (text) => {
    const hits = rules.filter(({ re }) => re.test(text)).map(({ rule }) => rule);
    return hits.length ? hits.join(', ') : null;
  };
}

function assertUnique(values, label) {
  const seen = new Set();
  const dupes = values.filter((v) => (seen.has(v) ? true : (seen.add(v), false)));
  assert.deepEqual(dupes, [], `duplicate ${label}`);
}

// ---------------------------------------------------------------------------
// The checker itself

describe('the checker', () => {
  const BAD = [
    ['Brain-Unstick Spark', 'spark'],
    ['A 2-hour solo excursion to enchant your inner creative child', 'enchant'],
    ['A 2-hour solo excursion to enchant your inner creative child', 'inner child'],
    ['Shuffle Idea \u{1F3B2}', 'emoji'],
    ['Use for This Week ✍️', 'emoji'],
    ['Keep going!', 'exclamation mark'],
    ['Pages — three of them', 'em dash'],
    ['Pages – three of them', 'en dash used as a dash'],
    ['Pages - three of them', 'hyphen used as a dash'],
    ["Don't break the chain.", "don't break the chain"],
    ['Day 5 streak', 'streak'],
    ["Let's go", "let's"],
    ["You've got this", "you've got this"],
    ['Time for some self-care', 'self-care'],
    ['Crushing it', 'crush'],
    ['Level up your mornings', 'level up'],
    ['An amazing week', 'amazing'],
    ['Awesome work', 'awesome'],
    ['Your creative journey', 'journey'],
    ['Unlock your creativity', 'unlock'],
    ['Good vibes only', 'vibe'],
    ['A little magic', 'magic'],
    ['Manifest your dreams', 'manifest'],
    ["It's not a lift anymore. It's a thread.", '"It\'s not X. It\'s Y." inversion'],
    ['Not a chore, but a gift.', '"not X, but Y" inversion'],
    ["The problem isn't time, it's attention.", '"X isn\'t Y, it\'s Z" inversion'],
    ['Here’s the thing: you already know.', 'colon reveal'],
    ["Here's what nobody tells you about pages.", 'reveal tease'],
    ['Pen. Paper. Go.', 'staccato fragment stack'],
    ['Three pages, then breakfast. Press play.', 'cinematic closer'],
    ['The rest of the day is yours.', 'cinematic closer'],
    ['If you miss a day, then start again.', '"if X, then Y" formula'],
  ];

  for (const [text, rule] of BAD) {
    test(`flags ${rule}: ${JSON.stringify(text)}`, () => {
      assert.ok(problemsIn(text).includes(rule), `expected "${rule}", got ${JSON.stringify(problemsIn(text))}`);
    });
  }

  test('passes the canonical lines', () => {
    for (const text of [
      "Last pages: 9 days ago. One page today and you're back in.",
      'Three pages. Done for today.',
      'Done. How was it?',
      'Day 8 of week 4. Move on when you\'re ready.',
      'A 20–30 minute timer.',
    ]) {
      assert.deepEqual(problemsIn(text), [], text);
    }
  });
});

// ---------------------------------------------------------------------------
// Every string in every export

describe('copy rules on every string', () => {
  test('every export is walked', () => {
    for (const name of ['CHAPTERS', 'STARTERS', 'IDEAS', 'REENTRY', 'PICKUP', 'DONE_LINES', 'CHECKIN', 'COPY']) {
      assert.ok(STRINGS.some(({ path }) => path.startsWith(name)), `${name} has no strings`);
    }
    assert.ok(STRINGS.length > 300, `only ${STRINGS.length} strings found`);
  });

  test('no em dashes, en dashes, hyphens used as dashes, emoji or exclamation marks', () => {
    assert.deepEqual(failuresFor(rulesCheck(TYPOGRAPHY)), []);
  });

  test('no banned words or phrases', () => {
    assert.deepEqual(failuresFor(rulesCheck(BANNED)), []);
  });

  test('no inversions, colon reveals, reveal teases, cinematic closers or if/then formulas', () => {
    assert.deepEqual(failuresFor(rulesCheck(TELLS)), []);
  });

  test('no staccato fragment stacks', () => {
    assert.deepEqual(failuresFor((text) => (hasStaccatoStack(text) ? 'staccato fragment stack' : null)), []);
  });

  test('no empty strings, stray whitespace or line breaks', () => {
    const check = (text) => {
      if (text.trim() === '') return 'empty string';
      if (/^\s|\s$|\s{2}|\n/.test(text)) return 'stray whitespace';
      return null;
    };
    assert.deepEqual(failuresFor(check), []);
  });

  test('straight apostrophes and quotes throughout, like the required strings', () => {
    assert.deepEqual(failuresFor((text) => (/[‘’“”]/.test(text) ? 'curly quote' : null)), []);
  });

  test('placeholders are documented names with balanced braces', () => {
    const check = (text) => {
      for (const [, name] of text.matchAll(/\{([^{}]*)\}/g)) {
        if (!PLACEHOLDERS.has(name)) return `unknown placeholder {${name}}`;
      }
      if (/[{}]/.test(text.replace(/\{\w+\}/g, ''))) return 'stray brace';
      return null;
    };
    assert.deepEqual(failuresFor(check), []);
  });
});

// ---------------------------------------------------------------------------
// CHAPTERS

describe('CHAPTERS', () => {
  test('12 chapters with the exact titles in order', () => {
    assert.equal(CHAPTERS.length, 12);
    assert.deepEqual(CHAPTERS.map((c) => c.title), TITLES);
    assert.deepEqual(CHAPTERS.map((c) => c.num), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  test('each chapter has exactly num, title, short, about, themes, note', () => {
    for (const chapter of CHAPTERS) {
      assert.deepEqual(Object.keys(chapter).sort(), ['about', 'note', 'num', 'short', 'themes', 'title']);
    }
  });

  test('short is the name after "Recovering a Sense of"', () => {
    assert.deepEqual(
      CHAPTERS.map((c) => c.short),
      TITLES.map((t) => t.replace('Recovering a Sense of ', '')),
    );
    assert.equal(CHAPTERS[0].short, 'Safety');
    assert.equal(CHAPTERS[9].short, 'Self-Protection');
  });

  test('about is 2 or 3 sentences', () => {
    for (const { num, about } of CHAPTERS) {
      const count = sentencesOf(about).length;
      assert.ok(count >= 2 && count <= 3, `chapter ${num} has ${count} sentences`);
      assert.match(about, /\.$/, `chapter ${num} about should end with a period`);
    }
  });

  test('themes are 3 to 5 short labels', () => {
    for (const { num, themes } of CHAPTERS) {
      assert.ok(Array.isArray(themes) && themes.length >= 3 && themes.length <= 5, `chapter ${num} themes count`);
      for (const theme of themes) {
        assert.ok(theme.length <= 30, `chapter ${num} theme too long: ${theme}`);
        assert.doesNotMatch(theme, /[.?!]$/, `chapter ${num} theme ends in punctuation: ${theme}`);
      }
      assertUnique(themes, `theme in chapter ${num}`);
    }
  });

  test('note is null or a single short line', () => {
    for (const { num, note } of CHAPTERS) {
      if (note === null) continue;
      assert.equal(typeof note, 'string', `chapter ${num} note`);
      assert.ok(note.length <= 120, `chapter ${num} note is too long for one line`);
      assert.match(note, /\.$/, `chapter ${num} note should end with a period`);
    }
  });

  test('the reading-deprivation week has a heads-up', () => {
    assert.match(CHAPTERS[3].note, /read/i);
  });

  test('no quoting the book', () => {
    for (const { num, about, note } of CHAPTERS) {
      assert.doesNotMatch(`${about} ${note ?? ''}`, /["“”]/, `chapter ${num} has quotation marks`);
    }
  });
});

// ---------------------------------------------------------------------------
// STARTERS

describe('STARTERS', () => {
  test('at least 40', () => {
    assert.ok(STARTERS.length >= 40, `only ${STARTERS.length}`);
  });

  test('ids and texts are unique', () => {
    assertUnique(STARTERS.map((s) => s.id), 'starter id');
    assertUnique(STARTERS.map((s) => s.text), 'starter text');
  });

  test('each is { id, text } with a first line ending in "..."', () => {
    for (const starter of STARTERS) {
      assert.deepEqual(Object.keys(starter).sort(), ['id', 'text']);
      assert.match(starter.id, /^[a-z0-9-]+$/);
      assert.match(starter.text, /^[^.?!]+\.\.\.$/, `bad starter: ${starter.text}`);
    }
  });
});

// ---------------------------------------------------------------------------
// IDEAS

describe('IDEAS', () => {
  test('at least 50', () => {
    assert.ok(IDEAS.length >= 50, `only ${IDEAS.length}`);
  });

  test('ids are unique', () => {
    assertUnique(IDEAS.map((i) => i.id), 'idea id');
    assertUnique(IDEAS.map((i) => i.text), 'idea text');
  });

  test('each is { id, text, kind, cost } with valid kind and cost', () => {
    for (const idea of IDEAS) {
      assert.deepEqual(Object.keys(idea).sort(), ['cost', 'id', 'kind', 'text']);
      assert.match(idea.id, /^[a-z0-9-]+$/);
      assert.ok(KINDS.includes(idea.kind), `${idea.id}: bad kind ${idea.kind}`);
      assert.ok(COSTS.includes(idea.cost), `${idea.id}: bad cost ${idea.cost}`);
    }
  });

  test('text is one sentence under 100 characters', () => {
    for (const { id, text } of IDEAS) {
      assert.ok(text.length < 100, `${id} is ${text.length} characters`);
      assert.match(text, /^[^.?!]+\.$/, `${id} should be one sentence ending in a period`);
    }
  });

  test('every kind and cost is used, with plenty for winter evenings at home', () => {
    for (const kind of KINDS) {
      assert.ok(IDEAS.filter((i) => i.kind === kind).length >= 3, `fewer than 3 "${kind}" ideas`);
    }
    for (const cost of COSTS) {
      assert.ok(IDEAS.some((i) => i.cost === cost), `no "${cost}" ideas`);
    }
    assert.ok(IDEAS.filter((i) => i.kind === 'home').length >= 8, 'fewer than 8 home ideas');
  });
});

// ---------------------------------------------------------------------------
// REENTRY, PICKUP, DONE_LINES, CHECKIN

describe('REENTRY', () => {
  test('four buckets of at least two lines each', () => {
    assert.deepEqual(Object.keys(REENTRY).sort(), ['days', 'never', 'week', 'weeks']);
    for (const [bucket, lines] of Object.entries(REENTRY)) {
      assert.ok(Array.isArray(lines) && lines.length >= 2, `${bucket} needs two variants`);
    }
  });

  test('the canonical line is there for a 7 to 20 day gap', () => {
    assert.ok(REENTRY.week.includes("Last pages: {n} days ago. One page today and you're back in."));
  });

  test('gap buckets use {n}; "never" has no gap to show', () => {
    for (const bucket of ['days', 'week', 'weeks']) {
      assert.ok(REENTRY[bucket].some((line) => line.includes('{n}')), `${bucket} never uses {n}`);
    }
    for (const line of REENTRY.never) assert.ok(!line.includes('{n}'), line);
  });

  test('every line offers a page', () => {
    for (const line of Object.values(REENTRY).flat()) assert.match(line, /\b(?:one|page)\b/i, line);
  });
});

describe('PICKUP', () => {
  test('title, line and the two buttons', () => {
    assert.match(PICKUP.title, /\{n\}/);
    assert.equal(typeof PICKUP.line, 'string');
    assert.equal(PICKUP.start, 'Start week {n} today');
    assert.equal(PICKUP.choose, 'Choose another week');
  });
});

describe('DONE_LINES', () => {
  test('at least 6 unique lines, starting with the default', () => {
    assert.ok(DONE_LINES.length >= 6, `only ${DONE_LINES.length}`);
    assert.equal(DONE_LINES[0], 'Three pages. Done for today.');
    assertUnique(DONE_LINES, 'done line');
  });
});

describe('CHECKIN', () => {
  test('intro carries the pages, mornings and artist date placeholders', () => {
    assert.deepEqual(Object.keys(CHECKIN).sort(), ['intro', 'questions']);
    for (const name of ['{pages}', '{mornings}', '{artistDate}']) assert.ok(CHECKIN.intro.includes(name), name);
  });

  test('two questions, lineUp then matters', () => {
    assert.deepEqual(CHECKIN.questions.map((q) => q.id), ['lineUp', 'matters']);
    for (const question of CHECKIN.questions) {
      assert.deepEqual(Object.keys(question).sort(), ['hint', 'id', 'q']);
      assert.match(question.q, /\?$/);
      assert.ok(question.hint.length > 0);
    }
  });

  test('the coincidence question is in plain words', () => {
    for (const { text } of walk(CHECKIN, 'CHECKIN')) assert.doesNotMatch(text, /synchronicit/i);
  });
});

// ---------------------------------------------------------------------------
// COPY

describe('COPY', () => {
  test('the required strings are exact', () => {
    for (const [key, value] of Object.entries(EXACT_COPY)) assert.equal(COPY[key], value, key);
  });

  test('labels for every idea kind and cost', () => {
    assert.deepEqual(Object.keys(COPY.ideaKinds).sort(), [...KINDS].sort());
    assert.deepEqual(Object.keys(COPY.ideaCosts).sort(), [...COSTS].sort());
  });

  test('a restore message for every backup error code', () => {
    for (const code of ['file', 'empty', 'unreadable', 'unknown', 'wrongApp', 'newer', 'damaged']) {
      assert.equal(typeof COPY.restoreErrors[code], 'string', code);
    }
  });

  test('the chapter move line matches the spec example', () => {
    const filled = COPY.moveLine.replace('{day}', '8').replace('{n}', '4');
    assert.equal(filled, "Day 8 of week 4. Move on when you're ready.");
  });
});
