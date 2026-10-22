// One quiet line at the bottom of the screen. It sits above sheets and the
// writing screen, never takes a tap, and is a polite live region.

let timer = null;

function toastEl() {
  return typeof document === 'undefined' ? null : document.getElementById('toast');
}

export function toast(text, ms = 3800) {
  const el = toastEl();
  if (!el) return;
  clearTimeout(timer);
  el.textContent = text;
  el.classList.add('show');
  timer = setTimeout(() => el.classList.remove('show'), ms);
}

export function hideToast() {
  const el = toastEl();
  if (!el) return;
  clearTimeout(timer);
  el.classList.remove('show');
}
