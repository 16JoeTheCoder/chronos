// Error toasts say what failed in plain words; identical toasts collapse into one with a count.
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../src/renderer/api', () => ({ api: { command: vi.fn(async () => ({ ok: false, error: 'Name is empty.' })) } }));
import { describeError, getToasts, run, toast } from '../../src/renderer/store';

describe('toasts', () => {
  it('describes a failed command in plain words', () => {
    expect(describeError({ type: 'project.create', name: '' }, 'Name is empty.')).toBe("Couldn't create the project: name is empty.");
  });
  it('collapses identical toasts into one with a count', async () => {
    await run({ type: 'project.create', name: '' });
    await run({ type: 'project.create', name: '' });
    await run({ type: 'project.create', name: '' });
    toast('Something else');
    const list = getToasts();
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ text: "Couldn't create the project: name is empty.", count: 3, error: true });
  });
});
