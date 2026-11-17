export function total(values) {
  if (!Array.isArray(values) || values.some(value => typeof value !== 'number' || !Number.isFinite(value))) throw new TypeError('Use finite numbers.');
  return values.reduce((sum, value) => sum + value, 0);
}
