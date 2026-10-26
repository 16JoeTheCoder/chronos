// Quick capture (§8.6): Enter saves an inbox task (title only), Esc closes.
import { useState } from 'react';
import { api } from '../api';

export function Capture() {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  return (
    <form
      className="capture"
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return api.win.closeCapture();
        void api.command({ type: 'task.create', input: { title: text.slice(0, 120) } }).then((r) => (r.ok ? api.win.closeCapture() : setError(r.error)));
      }}
    >
      <input
        autoFocus
        value={text}
        maxLength={120}
        aria-label="Capture a task"
        placeholder={error || 'Capture a task. Enter saves, Esc closes.'}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && api.win.closeCapture()}
      />
    </form>
  );
}
