// Help sheet (? in the top bar, or the ? key): every shortcut and the few Chronos words, in one place.
import { Dialog } from '../components/ui';

const KEYS: [string, string][] = [
  ['Ctrl K', 'Add, search, ask Claude, or type > for commands'],
  ['G then I, T, U, A', 'Tasks: Inbox, Today, Upcoming, All'],
  ['P', 'Plan: the day as a time grid, and unscheduled tasks'],
  ['F', 'Focus: only the task and its timer'],
  ['N', 'New task'],
  ['Ctrl L', 'Log (R inside it: reading view)'],
  ['Ctrl Shift C', 'Cache: things to carry to your other devices'],
  ['E · Del · Ctrl Enter · S', 'On a task row: edit, delete, complete, start'],
  ['Ctrl Shift P', 'Switch project (Board) or pick the post\'s project (Log)'],
  ['Space', 'Start or pause the timer in Focus'],
  ['Hold Enter', 'Finish the task (2 s; let go early to cancel)'],
  ['Hold Backspace', 'Drop the task to the back of the queue (2 s)'],
  ['Ctrl Z', 'Undo the last change that offered Undo'],
  ['Esc', 'Close what is open, then go back to Home, then hide Chronos'],
  ['Ctrl Alt Space', 'Show or hide Chronos from any app'],
  ['Ctrl Alt N', 'Notepad from any app (change it in Settings → Tasks and notepad); Ctrl Enter pushes the note to the Log'],
];

const WORDS: [string, string][] = [
  ['Runway', 'Your day as a time grid: fixed events on top, planned blocks below. A plan may sit over a class.'],
  ['Block', 'Time set aside for one task on the runway.'],
  ['In focus', 'The one task you are doing now. Start it from Home, Tasks or Focus; drag it to the shelf to pause.'],
  ['Thinking space', 'Notes for the task in focus. Type a stray thought and keep going.'],
  ['Buffer', 'Time kept free at the end of the day.'],
  ['TASK', 'Write TASK at the end (or start) of a line in the notepad, Log or Focus notes and it becomes a task.'],
  ['P1-P4, @label', 'In any add box: !1 to !4 set the priority, @word adds a label.'],
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
