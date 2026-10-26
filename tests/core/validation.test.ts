import { describe, expect, it } from 'vitest';
import { defaultDevice, defaultSettings } from '../../src/core/model/defaults';
import { clockOf, dateLabel, formatClock, formatHM, formatHuman, greeting, parseHM } from '../../src/core/format';
import { isDropReason, isFinishPhrase, isValidAccelerator, validateDevice, validateSettings, validateTaskFields } from '../../src/core/validation';
import { T0, TZ } from '../helpers';

describe('validation', () => {
  it('checks the finish phrase and drop reason', () => {
    expect(isFinishPhrase('I have finished this task')).toBe(true);
    expect(isFinishPhrase('  i HAVE finished   this task.')).toBe(true);
    expect(isFinishPhrase('I have finished')).toBe(false);
    expect(isDropReason('ab')).toBe(false);
    expect(isDropReason(' abc ')).toBe(true);
  });

  it('allows inbox tasks but enforces 8 characters once a finish condition is given', () => {
    expect(validateTaskFields({ title: 'Read', finishCondition: '' })).toEqual({});
    expect(validateTaskFields({ title: 'Read', finishCondition: 'short' }).finishCondition).toBeDefined();
    expect(validateTaskFields({ title: '' }).title).toBeDefined();
    expect(validateTaskFields({ estimateMin: 0 }).estimateMin).toBeDefined();
  });

  it('validates settings and device settings', () => {
    expect(validateSettings(defaultSettings())).toEqual({});
    expect(validateSettings({ ...defaultSettings(), timezone: 'Mars/Base' }).timezone).toBeDefined();
    expect(validateSettings({ ...defaultSettings(), dayStartMin: 600, dayEndMin: 620 }).day).toBeDefined();
    const dev = defaultDevice('d', 'PC');
    expect(validateDevice(dev)).toEqual({});
    expect(validateDevice({ ...dev, shortcuts: { ...dev.shortcuts, capture: dev.shortcuts.toggle } }).shortcuts).toBeDefined();
    expect(isValidAccelerator('Ctrl+Alt+Space')).toBe(true);
    expect(isValidAccelerator('Space')).toBe(false);
  });
});

describe('format', () => {
  it('formats clocks, durations and dates', () => {
    expect(formatClock(65_000)).toBe('01:05');
    expect(formatClock(3_725_000)).toBe('1:02:05');
    expect(formatHuman(4 * 3_600_000 + 12 * 60_000)).toBe('4h 12m');
    expect(formatHuman(14 * 60_000)).toBe('14m');
    expect(formatHM(485)).toBe('08:05');
    expect(parseHM('8:05')).toBe(485);
    expect(parseHM('25:00')).toBeNull();
    expect(clockOf(T0, TZ)).toBe('09:00');
    expect(dateLabel('2026-10-26')).toBe('Mon 26 Oct');
    expect(greeting(540, 'Josef')).toBe('Good morning, Josef');
  });
});
