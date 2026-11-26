// Web entry (src/renderer/web.html): install the web bridge, then load the renderer.
// No top-level await: Safari 15 and older Android WebViews lack it.
import { installBridge } from '../platform';
import { createWebBridge } from '../platform/web';

void (async () => {
  installBridge(await createWebBridge());
  await import('../renderer/main');
})();
