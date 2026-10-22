// Chapter accents: a 12-tube paint set, one colour per chapter.
// ACCENTS lists the colours in chapter order; CHAPTER_ACCENTS maps chapter number to key.
// The colour values live in accents.css (tokens per key, light and dark).
// Keys are stored in settings.accent when a colour is pinned, so never rename a key.

export const ACCENTS = [
  { key: "ultramarine", name: "Ultramarine", chapter: 1, note: "A deep, calm blue for feeling safe enough to start making things." },
  { key: "may-green", name: "May Green", chapter: 2, note: "The green of new leaves, for a new sense of yourself that needs guarding." },
  { key: "cadmium-red", name: "Cadmium Red", chapter: 3, note: "Red for anger, read here as fuel and a map of what you want." },
  { key: "cerulean", name: "Cerulean", chapter: 4, note: "A clear sky blue for being honest about what you actually like." },
  { key: "cadmium-yellow", name: "Cadmium Yellow", chapter: 5, note: "Sunlight yellow for the wishes and small joys you haven't allowed yourself." },
  { key: "dioxazine-violet", name: "Dioxazine Violet", chapter: 6, note: "Purple was once the costliest colour to wear, so it stands for small luxuries." },
  { key: "emerald-green", name: "Emerald Green", chapter: 7, note: "Green for jealousy, which this chapter reads as a clue to what you'd love to make." },
  { key: "cobalt-blue", name: "Cobalt Blue", chapter: 8, note: "Cobalt is the blue that goes through a kiln's fire and keeps its colour." },
  { key: "opera-rose", name: "Opera Rose", chapter: 9, note: "A warm pink for treating your blocks, and yourself, with patience." },
  { key: "cadmium-orange", name: "Cadmium Orange", chapter: 10, note: "The orange of safety gear, for spotting the habits that get in your way." },
  { key: "magenta", name: "Magenta", chapter: 11, note: "A loud magenta for making things on your own terms." },
  { key: "cobalt-teal", name: "Cobalt Teal", chapter: 12, note: "Spiral teal from Gurren Lagann, for trusting the work enough to pierce the heavens." },
];

export const CHAPTER_ACCENTS = {
  1: "ultramarine", 2: "may-green", 3: "cadmium-red", 4: "cerulean",
  5: "cadmium-yellow", 6: "dioxazine-violet", 7: "emerald-green", 8: "cobalt-blue",
  9: "opera-rose", 10: "cadmium-orange", 11: "magenta", 12: "cobalt-teal",
};

// The accent key to show: a pinned colour if it exists, else the chapter's own.
export function accentFor(chapter, pinned = "chapter") {
  if (pinned && pinned !== "chapter" && ACCENTS.some((a) => a.key === pinned)) return pinned;
  return CHAPTER_ACCENTS[chapter] || ACCENTS[0].key;
}
