// Web entry (src/renderer/web.html): install the web bridge, then load the renderer.
import { installBridge } from '../platform';
import { createWebBridge } from '../platform/web';

installBridge(await createWebBridge());
await import('../renderer/main');
