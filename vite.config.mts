// Vite builds only the renderer (two pages: Home with the launch screen, and the
// small widget/capture page). base './' so the packaged app loads from file://.
// The strict CSP is injected for production builds only, because the dev server
// needs inline scripts for React Fast Refresh.
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const csp: Plugin = {
  name: 'chronos-csp',
  transformIndexHtml(html, ctx) {
    const policy = ctx.server
      ? ''
      : `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'" />`;
    return html.replace('<!--CSP-->', policy);
  },
};

export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react(), csp],
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    target: 'chrome120',
    assetsInlineLimit: 0,
    rollupOptions: { input: { index: 'src/renderer/index.html', widget: 'src/renderer/widget.html' } },
  },
  server: { port: 5173, strictPort: true },
});
