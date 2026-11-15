// Day and planning, and the tags that planning uses.

import { useState } from 'react';
import { formatHM, parseHM } from '../../core/format';
import { TAG_COLORS, type Snapshot, type TagColor } from '../../core/model/types';
import { live, settingsOf } from '../../core/repo/repo';
import { isValidZone } from '../../core/time/zone';
import { Icon } from '../components/Icon';
import { recycleWithUndo } from '../components/actions';
import { run } from '../store';
import { Btn, Group, NumField, Row, Seg, TextField, Toggle, saveSettings } from './rows';

const hm = (v: string) => (parseHM(v) === null ? 'Use HH:MM, 24 hour.' : null);

export function DaySection({ snap }: { snap: Snapshot }) {
  const s = settingsOf(snap.data);
  const pl = s.planning;
  return (
    <>
      <Group title="Your day" note="Auto-plan only fills the time between these, after fixed events and the buffer.">
        <TextField label="Day starts" value={formatHM(s.dayStartMin)} mono placeholder="06:00" check={hm} onCommit={(v) => saveSettings({ dayStartMin: parseHM(v) ?? s.dayStartMin })} />
        <TextField label="Day ends" value={formatHM(s.dayEndMin)} mono placeholder="22:00" check={hm} hint="At least an hour after the start." onCommit={(v) => saveSettings({ dayEndMin: parseHM(v) ?? s.dayEndMin })} />
        <NumField label="Buffer at the end of the day" hint="A cushion kept free. The end-of-day review opens when it begins." value={s.bufferMin} min={0} max={240} suffix="min" onCommit={(bufferMin) => saveSettings({ bufferMin })} />
        <NumField label="Prep reminder before class" value={s.prepLeadMin} min={5} max={1440} suffix="min" onCommit={(prepLeadMin) => saveSettings({ prepLeadMin })} />
        <TextField label="Time zone" hint="IANA name. WIB is Asia/Jakarta." value={s.timezone} wide placeholder="Asia/Jakarta" check={(v) => (isValidZone(v.trim()) ? null : 'Unknown time zone.')} onCommit={(timezone) => saveSettings({ timezone: timezone.trim() })} />
      </Group>

      <Group title="Planning">
        <Row label="Snap when dragging" hint="Hold Alt while dragging for free placement.">
          <Seg label="Snap" value={String(s.snapMin) as '5'} options={[['5', '5 min'], ['10', '10 min'], ['15', '15 min'], ['30', '30 min']]} onChange={(v) => void saveSettings({ snapMin: Number(v) })} />
        </Row>
        <NumField label="Default block length" hint="For a task with no estimate." value={pl.defaultBlockMin} min={5} max={480} suffix="min" onCommit={(defaultBlockMin) => saveSettings({ planning: { ...pl, defaultBlockMin } })} />
        <Toggle label="Learn estimates" hint="Use the median of your last five finished tasks in the same project or tag, once there are three." checked={pl.learnEstimates} onChange={(learnEstimates) => saveSettings({ planning: { ...pl, learnEstimates } })} />
        <NumField label="Offer a break after" hint="Shown when a block ends after this much continuous focus, never in the middle of one." value={pl.breakAfterMin} min={15} max={240} suffix="min" onCommit={(breakAfterMin) => saveSettings({ planning: { ...pl, breakAfterMin } })} />
        <NumField label="Weekly focus goal" hint="The momentum cell charges toward this." value={s.weeklyFocusTargetH} min={0} max={168} suffix="hours" onCommit={(weeklyFocusTargetH) => saveSettings({ weeklyFocusTargetH })} />
      </Group>

      <TagsGroup snap={snap} />
    </>
  );
}

function TagsGroup({ snap }: { snap: Snapshot }) {
  const tags = live(snap.data, 'tags');
  const [name, setName] = useState('');
  const [color, setColor] = useState<TagColor>('tag1');
  return (
    <Group title="Tags" note="Colour for classes, projects and everything else.">
      <div className="st-list">
        {tags.length === 0 && <p className="st-empty">No tags yet.</p>}
        {tags.map((t) => (
          <div className="st-item" key={t.id}>
            <span className="st-pill" style={{ ['--sw' as string]: `var(--${t.color})` }} aria-hidden="true">{t.kind}</span>
            <div className="st-item-main"><span className="st-item-title">{t.name}</span></div>
            <select className="st-select" aria-label={`Colour of ${t.name}`} value={t.color} onChange={(e) => void run({ type: 'tag.update', id: t.id, input: { name: t.name, color: e.target.value as TagColor, kind: t.kind } })}>
              {TAG_COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <button type="button" className="st-icon" aria-label={`Delete ${t.name}`} onClick={() => void recycleWithUndo('tags', t.id, t.name)}>
              <Icon name="trash" size={16} />
            </button>
          </div>
        ))}
      </div>
      <form
        className="st-actions"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) void run({ type: 'tag.create', input: { name, color, kind: 'general' } }).then((r) => r.ok && setName(''));
        }}
      >
        <input className="st-input st-wide" aria-label="New tag name" placeholder="New tag" value={name} onChange={(e) => setName(e.target.value)} />
        <select className="st-select" aria-label="New tag colour" value={color} onChange={(e) => setColor(e.target.value as TagColor)}>
          {TAG_COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <Btn onClick={() => { if (name.trim()) return run({ type: 'tag.create', input: { name, color, kind: 'general' } }).then((r) => { if (r.ok) setName(''); return r.ok; }); }}>Add tag</Btn>
      </form>
    </Group>
  );
}
