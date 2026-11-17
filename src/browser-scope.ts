import type { BrowserContext } from 'playwright';

export async function restrictBrowser(context: BrowserContext, origin: string, blocked: (url: string) => void) {
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin && !url.username && !url.password) return route.continue();
    blocked(url.href); return route.abort();
  });
  await context.routeWebSocket('**/*', socket => {
    const url = new URL(socket.url()); url.protocol = url.protocol === 'ws:' ? 'http:' : 'https:';
    if (url.origin === origin && !url.username && !url.password) { socket.connectToServer(); return; }
    blocked(url.href); socket.close();
  });
}
