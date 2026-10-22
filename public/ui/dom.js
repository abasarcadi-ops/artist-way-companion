// Small DOM and string helpers shared by every screen.

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escapes text for HTML. Every piece of user text goes through this. */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ENTITIES[c]);
}

/** Marks a string as markup, so fillHtml inserts it as is. */
export function raw(html) {
  return { html: String(html) };
}

/**
 * Fills {name} placeholders in a COPY string. A value given as an array is
 * used in order, one item per occurrence. Plain text result.
 */
export function fill(template, values = {}) {
  return pieces(template, values, (text) => text, (value) => String(value ?? '')).join('');
}

/** Like fill, but escapes the template and the values (raw() values go in as markup). */
export function fillHtml(template, values = {}) {
  return pieces(template, values, esc, (value) =>
    value && typeof value === 'object' && 'html' in value ? value.html : esc(value),
  ).join('');
}

function pieces(template, values, text, value) {
  const used = {};
  return String(template)
    .split(/(\{\w+\})/)
    .map((part) => {
      const name = /^\{(\w+)\}$/.exec(part)?.[1];
      if (!name || !(name in values)) return text(part);
      let v = values[name];
      if (Array.isArray(v)) {
        used[name] = (used[name] ?? -1) + 1;
        v = v[used[name]];
      }
      return value(v);
    });
}

/** The text before and after a placeholder, for strings like "{n} of 3". */
export function splitAround(template, name = 'n') {
  const token = `{${name}}`;
  const at = template.indexOf(token);
  return at < 0 ? [template, ''] : [template.slice(0, at), template.slice(at + token.length)];
}

/**
 * Sentences of a line, so "Three pages. Done for today." can sit on two lines.
 * No lookbehind in the pattern: Safari before 16.4 can't parse one, and a
 * parse error there stops the whole app from loading.
 */
export function sentences(text) {
  return String(text)
    .replace(/([.?!])\s+/g, '$1\n')
    .split('\n')
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Replaces an element's markup only when it changed. Focus survives the swap
 * when the focused element comes back with the same id or data-test.
 */
export function patch(el, html) {
  if (!el || el.__html === html) return false;
  const active = document.activeElement;
  const inside = active && active !== el && el.contains(active);
  const selector = inside ? focusSelector(active) : null;
  // A field being typed in keeps its text and cursor through the swap.
  const typing = inside && isTextField(active)
    ? { value: active.value, start: active.selectionStart, end: active.selectionEnd }
    : null;
  el.innerHTML = html;
  el.__html = html;
  const again = selector ? el.querySelector(selector) : null;
  if (again) {
    if (typing && isTextField(again)) {
      again.value = typing.value;
      try {
        again.setSelectionRange(typing.start, typing.end);
      } catch {
        // Some input types have no selection.
      }
    }
    focus(again);
  }
  return true;
}

function isTextField(node) {
  return node.tagName === 'TEXTAREA' || (node.tagName === 'INPUT' && /^(text|search|url|email)$/.test(node.type));
}

function focusSelector(node) {
  if (node.id) return `#${CSS.escape(node.id)}`;
  const test = node.getAttribute('data-test');
  return test ? `[data-test="${CSS.escape(test)}"]` : null;
}

/** Sets an input's value unless the person is typing in it. */
export function setValue(input, value) {
  if (!input || document.activeElement === input) return;
  const text = value ?? '';
  if (input.value !== text) input.value = text;
}

/** Grows a one-row textarea to fit its text. Skipped while it isn't on screen. */
export function fitHeight(field) {
  if (!field?.isConnected || field.getClientRects().length === 0) return;
  field.style.height = 'auto';
  const { borderTopWidth, borderBottomWidth } = getComputedStyle(field);
  field.style.height = `${field.scrollHeight + parseFloat(borderTopWidth) + parseFloat(borderBottomWidth)}px`;
}

/** Scrolls a block (an in-page confirm, say) into view, then focuses `target` in it. */
export function reveal(block, target = block) {
  if (!block) return;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  block.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
  focus(target);
}

export function focus(el) {
  if (!el) return;
  try {
    el.focus({ preventScroll: true });
  } catch {
    el.focus();
  }
}

/**
 * n strokes. `fresh` is how many were there before, so only the new ones
 * animate in, one after another. Groups of five get a little air (a tally).
 */
export function strokes(n, { now = false, fresh = null, five = false } = {}) {
  let html = '';
  for (let i = 0; i < n; i += 1) {
    if (five && i > 0 && i % 5 === 0) html += '<span class="gap" aria-hidden="true"></span>';
    const isNew = fresh !== null && i >= fresh;
    const style = isNew ? ` style="animation-delay:${(i - fresh) * 70 + 60}ms"` : '';
    html += `<i class="stroke${now ? ' is-now' : ''}${isNew ? ' new' : ''}"${style}></i>`;
  }
  return html;
}

/** A tiny debounce that can also be flushed (on blur) or dropped. */
export function debounce(fn, ms) {
  let timer = null;
  let lastArgs = null;
  const run = () => {
    timer = null;
    const args = lastArgs;
    lastArgs = null;
    if (args) fn(...args);
  };
  const debounced = (...args) => {
    lastArgs = args;
    clearTimeout(timer);
    timer = setTimeout(run, ms);
  };
  debounced.flush = () => {
    clearTimeout(timer);
    run();
  };
  debounced.cancel = () => {
    clearTimeout(timer);
    timer = null;
    lastArgs = null;
  };
  return debounced;
}
