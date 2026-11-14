// Runs before first paint (external file: the CSP forbids inline scripts). Re-applies the last theme's
// CSS variables so the launch screen is already themed. ThemeProvider re-resolves and overwrites them.
try {
  var c = JSON.parse(localStorage.getItem('chronos.themeBoot') || 'null');
  if (c && c.vars) {
    var r = document.documentElement;
    for (var k in c.vars) r.style.setProperty(k, c.vars[k]);
    r.dataset.mode = c.mode; r.dataset.themeId = c.id; r.dataset.signature = c.sig;
    r.style.colorScheme = c.mode;
  }
} catch (e) { /* first run: system colours until the theme loads */ }
