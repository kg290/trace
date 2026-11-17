// Runs in the selected document. No console/fetch/promise prototypes are replaced.
// Actions are not recorded here: TRACE drives the page from the agent's flow, so the flow is the reproduction.
export function observe(options: { bridge: string; control: string; origin: string; values: boolean; messages: boolean }) {
  if (window !== window.top || location.origin !== options.origin || (window as any)[options.control]) return;
  const documentId = crypto.randomUUID();
  let sequence = 0, enabled = true, totalMs = 0, dropped = 0;
  const clean = (text: string, max = 160) => text.slice(0, 4000)
    .replace(/\b(?:Bearer|Basic)\s+[^\s"'<>]+/gi, '[CREDENTIAL OMITTED]')
    .replace(/\b(?:sk[-_](?:proj[-_])?|gh[pousr]_|github_pat_|AKIA)[A-Za-z0-9_\-]{8,}/g, '[TOKEN OMITTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[TOKEN OMITTED]')
    .replace(/((?:password|secret|token|api[_-]?key|authorization|cookie)\s*[=:]\s*)[^\s,;"'<>]+/gi, '$1[REDACTED]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL OMITTED]')
    .replace(/-----BEGIN[\s\S]*/g, '[KEY OMITTED]').slice(0, max);
  const send = (kind: string, data: Record<string, unknown>) => {
    if (!enabled) return;
    if (sequence >= 10000) { dropped++; return; }
    // Native CDP binding emits synchronously, including during document teardown.
    (window as any)[options.bridge](JSON.stringify({ kind, data, document: documentId, browserSeq: ++sequence, browserMs: performance.now(), observerMs: totalMs }));
  };
  const privateElement = (e: Element) => !!e.closest('[data-private], [data-trace-private]') || /hidden|password|secret|token|auth|session|csrf|api.?key|credit|card|cvv|email/i.test(`${e.getAttribute('type')} ${e.getAttribute('name')} ${e.id} ${e.getAttribute('autocomplete')}`);
  const label = (e: Element) => clean((e as HTMLInputElement).labels?.[0]?.textContent?.trim() || e.getAttribute('aria-label') || e.id || '', 120);
  const visibleMessages = () => Array.from(document.querySelectorAll('[role=status],[role=alert]')).slice(0, 5).filter(e => !privateElement(e)).map(e => clean(e.textContent || '', 300));
  const snapshot = () => {
    if (!options.values && !options.messages) return;
    const controls = options.values ? Array.from(document.querySelectorAll('input,textarea,select')).slice(0, 15).filter(e => !privateElement(e)).map(e => ({ label: label(e), value: clean((e as HTMLInputElement).value, 160) })) : [];
    send('observation', { controls, messages: options.messages ? visibleMessages() : [] });
  };
  // Chromium discards binding events at pagehide; beforeunload still delivers them.
  window.addEventListener('beforeunload', () => send('document-end', { dropped, observerMs: totalMs }));
  let lastMessages = '';
  const observer = new MutationObserver(() => {
    if (!enabled || !options.messages) return;
    const start = performance.now();
    const texts = visibleMessages(), next = JSON.stringify(texts);
    if (next !== lastMessages) { lastMessages = next; send('visible-message', { messages: texts }); }
    totalMs += performance.now() - start;
  });
  observer.observe(document, { childList: true, subtree: true, characterData: true });
  (window as any)[options.control] = async (command: string) => {
    snapshot();
    send('checkpoint', { dropped, observerMs: totalMs });
    if (command === 'stop') { enabled = false; observer.disconnect(); }
    return { document: documentId, sequence, dropped, observerMs: totalMs };
  };
  send('document', { navigation: (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming)?.type || 'navigate' });
}
