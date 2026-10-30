// First run (§9.6): at most 3 steps, skippable, no sample data.
import { useState } from 'react';
import { formatHM, parseHM } from '../../core/format';
import type { Settings } from '../../core/model/types';
import { isValidZone } from '../../core/time/zone';
import { Field } from '../components/ui';
import { run } from '../store';

export function Onboarding({ s, onTimetable, onDone }: { s: Settings; onTimetable: () => void; onDone: () => void }) {
  const [step, setStep] = useState(1);
  const [tz, setTz] = useState(s.timezone);
  const [start, setStart] = useState(formatHM(s.dayStartMin));
  const [end, setEnd] = useState(formatHM(s.dayEndMin));
  const [error, setError] = useState('');

  const finish = async (then: () => void) => {
    const r = await run({ type: 'settings.update', patch: { onboarded: true } });
    if (r.ok) then();
  };

  async function saveDay() {
    const a = parseHM(start);
    const b = parseHM(end);
    if (!isValidZone(tz)) return setError('Unknown time zone. Use a name like Asia/Jakarta.');
    if (a === null || b === null || b - a < 60) return setError('The day must be at least an hour long.');
    const r = await run({ type: 'settings.update', patch: { timezone: tz, dayStartMin: a, dayEndMin: b } }, true);
    if (!r.ok) return setError(r.error);
    setError('');
    setStep(2);
  }

  return (
    <div className="scrim">
      <section className="dlg onboard" role="dialog" aria-modal="true" aria-label="Welcome to Chronos">
        <p className="eyebrow">Step {step} of 3</p>
        {step === 1 ? (
          <>
            <h2 className="pair">
              Own your <b>time.</b>
            </h2>
            <p className="muted">Where are you, and when does your day run?</p>
            <Field label="Time zone" help="WIB is Asia/Jakarta.">
              <input autoFocus value={tz} onChange={(e) => setTz(e.target.value)} />
            </Field>
            <div className="grid2">
              <Field label="Day starts">
                <input value={start} onChange={(e) => setStart(e.target.value)} />
              </Field>
              <Field label="Day ends">
                <input value={end} onChange={(e) => setEnd(e.target.value)} />
              </Field>
            </div>
            {error && <p className="warn">{error}</p>}
            <div className="row end gap">
              <button className="btn btn-ghost" onClick={() => void finish(onDone)}>
                Skip setup
              </button>
              <button className="btn" onClick={() => void saveDay()}>
                Next
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="pair">
              Add your weekly <b>timetable.</b>
            </h2>
            <p className="muted">Classes, shifts and lectures become fixed blocks on your runway, so Chronos knows what time is really yours.</p>
            <div className="row end gap">
              <button className="btn btn-ghost" onClick={() => void finish(onDone)}>
                Skip, I'll plan manually
              </button>
              <button className="btn" onClick={() => void finish(onTimetable)}>
                Add timetable
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
