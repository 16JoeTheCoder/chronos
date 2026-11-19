// Static guard on firebase/firestore.rules. The Firestore emulator is not available here, so this
// does NOT execute the rules: it reads the file as text and checks that the Phase 3.7 clauses
// (task labels / priority, settings tasks / pillShowsClass) are present and wired into the write rule.
// Run the emulator suite where it exists before deploying.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const raw = fs.readFileSync(path.join(__dirname, '../../firebase/firestore.rules'), 'utf8');
/** Comments dropped and whitespace collapsed, so the checks do not depend on line breaks. */
const rules = raw.replace(/\/\/.*$/gm, '').replace(/\s+/g, ' ');

describe('firestore.rules (static)', () => {
  it('tasks: labels must be a list of at most 20, priority one of must / should / nice / none', () => {
    expect(rules).toMatch(/collection != 'tasks' \|\| \(/);
    expect(rules).toContain("(!('labels' in d) || (d.labels is list && d.labels.size() <= 20))");
    expect(rules).toContain("(!('priority' in d) || d.priority in ['must', 'should', 'nice', 'none'])");
  });

  it('settings: tasks.doneRetentionHours in [0, 24, 72, 168], pillShowsClass a bool', () => {
    expect(rules).toMatch(/collection != 'settings' \|\|/);
    expect(rules).toContain("(!('tasks' in d) || (d.tasks is map && d.tasks.get('doneRetentionHours', 24) in [0, 24, 72, 168]))");
    expect(rules).toContain("(!('pillShowsClass' in d) || d.pillShowsClass is bool)");
  });

  it('the shape clauses are enforced on create and update, and deletes stay forbidden', () => {
    expect(rules).toMatch(/allow create, update: if owner\(\) && known\(\) && valid\(\) && shape\(\);/);
    expect(rules).toContain('allow delete: if false;');
  });

  it('the old priority set (no "none") and an unbounded labels list are gone', () => {
    expect(rules).not.toMatch(/priority in \['must', 'should', 'nice'\]/);
    expect(rules).not.toMatch(/d\.labels is list\)/);
  });
});
