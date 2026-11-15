// Help sheet (? in the top bar, or the ? key): every shortcut and the few Chronos words, in one place.
import { Dialog } from '../components/ui';

const KEYS: [string, string][] = [
  ['Ctrl K', 'Add, search, ask Claude, or type > for commands'],
  ['P', 'Plan: the day runway and unscheduled tasks'],
  ['F', 'Focus: only the task and its timer'],
  ['N', 'New task'],
  ['Ctrl L', 'Log'],
  ['Ctrl Shift P', 'Switch project (Board) or pick the post\'s project (Log)'],
  ['Space', 'Start or pause the timer in Focus'],
  ['Hold Enter', 'Finish the task (2 s; let go early to cancel)'],
  ['Ctrl Z', 'Undo the last change that offered Undo'],
  ['Esc', 'Close what is open, then go back to Home, then hide Chronos'],
  ['Ctrl Alt Space', 'Show or hide Chronos from any app'],
  ['Ctrl Alt N', 'Notepad for the task in focus, from any app'],
];

const WORDS: [string, string][] = [
  ['Runway', 'Your day as a timeline: fixed events on top, planned blocks below.'],
  ['Block', 'Time set aside for one task on the runway.'],
  ['Finish condition', 'How you will know the task is done. A task needs one to be focused on.'],
  ['Thinking space', 'Notes for the task in focus. Type a stray thought and keep going.'],
  ['Buffer', 'Time kept free at the end of the day.'],
  ['Log', 'Your running notes. A line starting with - becomes a task.'],
];

export function Help({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Shortcuts and words" onClose={onClose} wide>
      <div className="help">
        <section aria-labelledby="help-keys">
          <h3 id="help-keys">Keys</h3>
          <dl className="help-list">
            {KEYS.map(([k, v]) => (
              <div key={k}><dt><kbd>{k}</kbd></dt><dd>{v}</dd></div>
            ))}
          </dl>
        </section>
        <section aria-labelledby="help-words">
          <h3 id="help-words">Words</h3>
          <dl className="help-list">
            {WORDS.map(([k, v]) => (
              <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
            ))}
          </dl>
        </section>
      </div>
    </Dialog>
  );
}
