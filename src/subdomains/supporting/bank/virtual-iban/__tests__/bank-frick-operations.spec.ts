import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('Bank Frick operations runbook', () => {
  const runbook = readFileSync(resolve(__dirname, '../../../../../../docs/bank-frick-operations.md'), 'utf8');

  it('describes 90 seconds only as the local HTTP window, not a Bank Frick side-effect deadline', () => {
    expect(runbook).toContain('90s is not an upper bound on Bank Frick processing');
    expect(runbook).toContain('Bank Frick may queue or finish work after the local HTTP attempt has ended');
    expect(runbook).not.toContain('the create side effect can therefore occur no later than 90s');
  });

  it('documents the known post-commit merge-effect loss window and manual replay procedure', () => {
    expect(runbook).toContain('There is no durable outbox in this change');
    expect(runbook).toContain('This is a known, bounded gap accepted for this PR');
    expect(runbook).toContain('manually replay any missing effect after a crash');
  });
});
