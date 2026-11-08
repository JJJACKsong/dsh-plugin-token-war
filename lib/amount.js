/** Small non-negative scientific-number arithmetic. JSON-safe [mantissa, exponent]. */
export const ZERO = Object.freeze([0, 0]);
export function normalize(m, e = 0) {
  if (!Number.isFinite(m) || !Number.isFinite(e) || m < 0) throw new RangeError('Invalid magnitude');
  if (!m) return [0, 0];
  const shift = Math.floor(Math.log10(m));
  let a = m / 10 ** shift, b = e + shift;
  if (a >= 10) { a /= 10; b++; }
  if (a < 1) { a *= 10; b--; }
  if (!Number.isInteger(b) || Math.abs(b) > 1e12) throw new RangeError('Magnitude exponent out of range');
  return [a, b];
}
export function amount(n) { return normalize(n); }
export function fromLog(l) {
  if (l === -Infinity) return [0, 0];
  if (!Number.isFinite(l)) throw new RangeError('Invalid logarithm');
  const e = Math.floor(l); return normalize(10 ** (l - e), e);
}
export function log(a) { return a[0] ? Math.log10(a[0]) + a[1] : -Infinity; }
export function compare(a, b) {
  if (!a[0] || !b[0]) return Math.sign(a[0] - b[0]);
  return a[1] === b[1] ? Math.sign(a[0] - b[0]) : Math.sign(a[1] - b[1]);
}
export function add(a, b) {
  if (!a[0]) return [...b]; if (!b[0]) return [...a];
  if (a[1] < b[1]) return add(b, a);
  const d = a[1] - b[1];
  return d > 17 ? [...a] : normalize(a[0] + b[0] * 10 ** -d, a[1]);
}
export function subtract(a, b) {
  if (compare(a, b) <= 0) return [0, 0];
  const d = a[1] - b[1];
  return !b[0] || d > 17 ? [...a] : normalize(Math.max(0, a[0] - b[0] * 10 ** -d), a[1]);
}
export function multiply(a, b) { return normalize(a[0] * b[0], a[1] + b[1]); }
export function scale(a, n) { return multiply(a, amount(n)); }
export function divide(a, b) {
  if (!b[0]) throw new RangeError('Division by zero');
  return normalize(a[0] / b[0], a[1] - b[1]);
}
export function power(a, p) { return a[0] ? fromLog(log(a) * p) : [0, 0]; }
export function numeric(a) { return a[0] * 10 ** a[1]; }
export function ratio(a, b) { return b[0] ? numeric(divide(a, b)) : Infinity; }
export function valid(a) {
  return Array.isArray(a) && a.length === 2 && Number.isFinite(a[0]) &&
    Number.isInteger(a[1]) && Math.abs(a[1]) <= 1e12 &&
    ((a[0] === 0 && a[1] === 0) || (a[0] >= 1 && a[0] < 10));
}
export function format(a, digits = 2) {
  if (!a[0]) return '0';
  if (a[1] < 0) return numeric(a).toFixed(digits);
  if (a[1] < 3) return numeric(a).toLocaleString('en-US', {maximumFractionDigits: a[1] < 1 ? 1 : 0});
  const suffixes = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi'];
  const group = Math.floor(a[1] / 3);
  if (group < suffixes.length) return (a[0] * 10 ** (a[1] % 3)).toFixed(digits).replace(/\.00$/, '') + suffixes[group];
  return a[0].toFixed(digits) + 'e' + a[1];
}
/** Sum first n costs in a geometric upgrade series, without enumerating levels. */
export function seriesCost(first, growth, n) {
  if (n <= 0) return amount(0);
  if (growth <= 1 || !Number.isInteger(n)) throw new RangeError('Invalid upgrade series');
  const l = n * Math.log10(growth);
  return multiply(first, l > 15 ? fromLog(l - Math.log10(growth - 1)) : amount(Math.expm1(n * Math.log(growth)) / (growth - 1)));
}
export function affordableLevels(first, growth, budget, max = 1000000) {
  if (compare(budget, first) < 0) return 0;
  const term = add(scale(divide(budget, first), growth - 1), amount(1));
  let n = Math.min(max, Math.max(0, Math.floor(log(term) / Math.log10(growth) + 1e-10)));
  while (n > 0 && compare(seriesCost(first, growth, n), budget) > 0) n--;
  return n;
}
