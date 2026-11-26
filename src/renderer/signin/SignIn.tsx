// The web sign-in screen. Shown before Home when the site has Firebase configured, the person has not
// chosen "use without an account", and sync says signedOut (main.tsx gates it). Phone first: one centred
// column, 16 px text, 44 px targets, safe areas.
import { useId, useState } from 'react';
import { api } from '../api';
import { DesktopLink } from '../components/InstallApp';
import monogram from '../assets/jy-monogram.svg';
import { plainSignInError } from './logic';
import './signin.css';

export function SignIn({ onLocal }: { onLocal: () => void }) {
  const web = api.web;
  const [pub, setPub] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const id = useId();
  if (!web) return null;
  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await web.signIn({ publicComputer: pub });
      if (!r.ok) setErr(plainSignInError(r.error));
    } catch {
      setErr(plainSignInError(''));
    }
    setBusy(false);
  };
  return (
    <main className="si" aria-labelledby={`${id}-t`}>
      <div className="si-col">
        <img className="si-mark" src={monogram} alt="" width={48} height={48} />
        <h1 className="si-word" id={`${id}-t`}>Chronos</h1>
        <p className="si-line">Own your time. Plan the day, focus on one thing, and keep what you learn.</p>

        <button type="button" className="si-primary" onClick={() => void go()} disabled={busy} aria-busy={busy}>
          {busy ? 'Opening Google…' : 'Continue with Google'}
        </button>
        {err && <p className="si-err" role="alert">{err}</p>}

        <label className="si-check">
          <input type="checkbox" checked={pub} onChange={(e) => setPub(e.target.checked)} aria-describedby={`${id}-d`} />
          <span>
            <b>This is a public computer</b>
            <small id={`${id}-d`}>Chronos clears this browser&rsquo;s copy when you sign out.</small>
          </span>
        </label>

        <button type="button" className="si-link" onClick={() => { web.continueLocal(); onLocal(); }}>Use without an account (stays in this browser)</button>
        <DesktopLink />
      </div>
    </main>
  );
}
