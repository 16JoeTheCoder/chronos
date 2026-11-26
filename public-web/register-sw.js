// Registers the app-shell service worker (external file: the CSP forbids inline scripts).
// Skipped on localhost (dev server, wrangler dev) unless the page URL has ?sw=1.
(function () {
  if (!('serviceWorker' in navigator)) return;
  var local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  if (local && location.search.indexOf('sw=1') < 0) return;
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').catch(function () { /* the app still opens online without it */ });
  });
})();
