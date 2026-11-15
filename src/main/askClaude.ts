// "Ask Claude" (D-146): copy the text, open Claude Desktop; fall back to claude.ai. No network
// request is made here: the OS opens the URL.
import { clipboard, shell } from 'electron';
import type { Result } from '../core/commands';

export async function askClaude(text: string): Promise<Result> {
  clipboard.writeText(text);
  try {
    await shell.openExternal('claude://');
  } catch {
    await shell.openExternal('https://claude.ai/new');
  }
  return { ok: true };
}
