// Windows notifications (block end, Pomodoro boundaries, prep nudges, sprint
// checkpoints). Silent when notifications are off; the optional short beep is
// synthesised in a renderer. UNVERIFIED-ON-WINDOWS.

import { Notification } from 'electron';
import type { DeviceSettings } from '../core/model/types';
import type { Notice } from './controller';

export function notify(n: Notice, device: DeviceSettings, beep: () => void): void {
  if (device.notifications && Notification.isSupported()) new Notification({ title: n.title, body: n.body, silent: true }).show();
  if (device.sound) beep();
}
