export const SECRET_KEY = /password|passwd|secret|token|authorization|cookie|credential|api[-_]?key|private[-_]?key|session|credit|card|cvv/i;
export function redact(value: string, max = 1000): string {
  return value.slice(0, 16000)
    .replace(/-----BEGIN [\s\S]*?PRIVATE KEY-----[\s\S]*?(?:-----END [\s\S]*?PRIVATE KEY-----|$)/g, '[PRIVATE KEY OMITTED]')
    .replace(/\b(?:Bearer|Basic)\s+[^\s"'<>]+/gi, '[CREDENTIAL OMITTED]')
    .replace(/\b(?:sk[-_](?:proj[-_])?|gh[pousr]_|github_pat_|AKIA)[A-Za-z0-9_\-]{8,}/g, '[TOKEN OMITTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[TOKEN OMITTED]')
    .replace(/((?:password|secret|token|api[_-]?key|authorization|cookie)\s*[=:]\s*)[^\s,;"'<>]+/gi, '$1[REDACTED]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL OMITTED]')
    .replace(/https?:\/\/[^\s"'<>]+/g, match => safeUrl(match))
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .slice(0, max);
}
export function safeUrl(value: string): string {
  try {
    const u = new URL(value);
    if (!['http:', 'https:'].includes(u.protocol)) return '[URL OMITTED]';
    const path = u.pathname.split('/').map(s => /(?:[A-Za-z0-9_-]{30,}|@|%40)/.test(s) ? '[SEGMENT OMITTED]' : s).join('/');
    return `${u.protocol}//${u.host}${path}${u.search ? '?[query omitted]' : ''}${u.hash ? '#[fragment omitted]' : ''}`.slice(0, 600);
  } catch { return '[URL OMITTED]'; }
}
export function localUrl(value: string): URL {
  const u = new URL(value);
  if (u.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) || u.username || u.password) {
    throw new Error('Choose an http://localhost or loopback application without URL credentials.');
  }
  return u;
}
export function sanitize(value: unknown, depth = 0): any {
  if (depth > 5) return '[DEPTH OMITTED]';
  if (typeof value === 'string') return redact(value);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 40).map(v => sanitize(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = Object.create(null);
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value)).slice(0, 40)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) continue;
      out[redact(key, 80)] = SECRET_KEY.test(key) ? '[REDACTED]' : 'value' in descriptor ? sanitize(descriptor.value, depth + 1) : '[GETTER OMITTED]';
    }
    return out;
  }
  return '[OMITTED]';
}
