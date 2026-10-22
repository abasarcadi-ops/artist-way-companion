// Date formatting for display. Names come from COPY, arithmetic from core.

import { daysBetween, parseKey } from '../core.js';
import { COPY } from '../content.js';
import { fill } from './dom.js';

const EPOCH_MONDAY = '1970-01-05';

/** 0 for Monday .. 6 for Sunday. */
export function weekdayIndex(key) {
  return (parseKey(key).getDay() + 6) % 7;
}

/** "Thursday" */
export function weekdayName(key) {
  return COPY.weekdayNames[weekdayIndex(key)];
}

/** "22 October" */
export function dayMonth(key) {
  const d = parseKey(key);
  return `${d.getDate()} ${COPY.monthNames[d.getMonth()]}`;
}

/** "Thursday 22 October", with the year when it isn't this year's. */
export function longDate(key, today = null) {
  const text = `${weekdayName(key)} ${dayMonth(key)}`;
  return today && key.slice(0, 4) !== today.slice(0, 4) ? `${text} ${key.slice(0, 4)}` : text;
}

/** "22 Oct" */
export function shortDate(key) {
  const d = parseKey(key);
  return `${d.getDate()} ${COPY.monthShort[d.getMonth()]}`;
}

/** "October" */
export function monthName(key) {
  return COPY.monthNames[parseKey(key).getMonth()];
}

/** "19 to 25 Oct", or "28 Sep to 4 Oct" across a month end. */
export function weekRange(keys) {
  const first = keys[0];
  const last = keys[keys.length - 1];
  const start = first.slice(0, 7) === last.slice(0, 7) ? String(parseKey(first).getDate()) : shortDate(first);
  return fill(COPY.weekRange, { date: [start, shortDate(last)] });
}

/** A whole number that steps by one each calendar day, for picking a line per day. */
export function dayIndex(key) {
  return Math.abs(daysBetween(EPOCH_MONDAY, key));
}

/** The same item all day, a different one tomorrow. */
export function pickByDay(list, key, offset = 0) {
  return list[(dayIndex(key) + offset) % list.length];
}
