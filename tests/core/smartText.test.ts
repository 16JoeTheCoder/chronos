// Plain-text editing rules for the notepad, Log composer and Focus notes (Phase 3.7 §7).
import { describe, expect, it } from 'vitest';
import { applyTaskLine, bulletBackspace, bulletEnter, taskLineAt, undoTaskLine } from '../../src/core/log/smartText';

describe('bullets', () => {
  it('Enter on "- a" continues the list with "\\n- "', () => {
    expect(bulletEnter('- a', 3)).toEqual({ value: '- a\n- ', caret: 6 });
  });
  it('Enter in the middle of a bullet splits it into a new bullet', () => {
    expect(bulletEnter('- ab', 3)).toEqual({ value: '- a\n- b', caret: 6 });
  });
  it('Enter on an empty bullet ends the list', () => {
    expect(bulletEnter('- a\n- ', 6)).toEqual({ value: '- a\n', caret: 4 });
    expect(bulletEnter('- ', 2)).toEqual({ value: '', caret: 0 });
  });
  it('Enter on a plain line is not handled', () => {
    expect(bulletEnter('hello', 5)).toBeNull();
  });
  it('Backspace right after the "- " of an empty bullet removes the marker', () => {
    expect(bulletBackspace('- a\n- ', 6)).toEqual({ value: '- a\n', caret: 4 });
    expect(bulletBackspace('- ', 2)).toEqual({ value: '', caret: 0 });
  });
  it('Backspace elsewhere is not handled', () => {
    expect(bulletBackspace('- a', 3)).toBeNull();
    expect(bulletBackspace('- a\n- ', 2)).toBeNull();
  });
});

describe('TASK lines', () => {
  it('finds a trailing TASK when the caret is at the end of the line', () => {
    const v = 'call mom TASK';
    expect(taskLineAt(v, v.length)).toMatchObject({ where: 'end', body: 'call mom', original: v, start: 0, end: v.length });
  });
  it('finds a leading TASK, with the rest as the body', () => {
    const v = 'TASK call mom fri';
    expect(taskLineAt(v, v.length)).toMatchObject({ where: 'start', body: 'call mom fri', original: v });
  });
  it('only when the caret is at the end of the line', () => {
    const v = 'call mom TASK';
    expect(taskLineAt(v, 4)).toBeNull();
    expect(taskLineAt('TASK call mom fri', 0)).toBeNull();
    expect(taskLineAt('TASK call mom\nnext', 'TASK call mom'.length - 2)).toBeNull();
  });
  it('works on the caret line of a longer text', () => {
    const v = 'first\ncall mom TASK\nlast';
    const caret = 'first\ncall mom TASK'.length;
    expect(taskLineAt(v, caret)).toMatchObject({ where: 'end', body: 'call mom', start: 6, end: caret });
  });
  it('ignores lowercase "task"', () => {
    expect(taskLineAt('call mom task', 13)).toBeNull();
    expect(taskLineAt('task call mom', 13)).toBeNull();
    expect(taskLineAt('TASK', 4)).toBeNull();
  });
  it('applyTaskLine drops TASK and opens a new line; undoTaskLine restores the original text exactly', () => {
    for (const original of ['call mom TASK', 'TASK call mom fri', '- buy milk TASK', '- TASK send datasheet']) {
      const before = `intro\n${original}\noutro`;
      const caret = `intro\n${original}`.length;
      const t = taskLineAt(before, caret)!;
      expect(t, original).not.toBeNull();
      const applied = applyTaskLine(before, t);
      expect(applied.value, original).not.toContain('TASK');
      expect(applied.value.split('\n')[1]).toBe(original.replace(/^(- )?TASK /, '$1').replace(/ TASK$/, ''));
      expect(applied.caret).toBe(applied.value.indexOf('\n', 6) + 1);
      const undone = undoTaskLine(applied.value, t);
      expect(undone.value, original).toBe(before);
      expect(undone.caret).toBe(caret);
    }
  });
  it('applyTaskLine keeps the bullet and the body', () => {
    const v = '- buy milk TASK';
    const t = taskLineAt(v, v.length)!;
    expect(applyTaskLine(v, t)).toEqual({ value: '- buy milk\n', caret: 11 });
  });
});
