// Pure helpers for the sign-in screen (no bridge import, so tests can load them).

/** Plain words for whatever the bridge says went wrong. */
export function plainSignInError(error: string): string {
  const e = error.toLowerCase();
  if (/popup|closed|cancel/.test(e)) return 'The sign-in window was closed before it finished. Try again.';
  if (/network|offline|fetch/.test(e)) return 'Chronos could not reach Google. Check your connection and try again.';
  if (/blocked/.test(e)) return 'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.';
  return error || 'Sign-in did not work. Try again.';
}

/** Should the sign-in screen show instead of Home? Pure so it can be tested. */
export function needsSignIn(web: { configured: boolean; isLocal(): boolean } | null, syncState: string): boolean {
  return !!web && web.configured && !web.isLocal() && syncState === 'signedOut';
}
