import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('Bank Frick operations runbook', () => {
  const runbook = readFileSync(resolve(__dirname, '../../../../../../docs/bank-frick-operations.md'), 'utf8');
  const compactRunbook = runbook.replace(/\s+/g, ' ');

  it('describes 90 seconds only as the local HTTP window, not a Bank Frick side-effect deadline', () => {
    expect(runbook).toContain('90s is not an upper bound on Bank Frick processing');
    expect(runbook).toContain('Bank Frick may queue or finish work after the local HTTP attempt has ended');
    expect(runbook).not.toContain('the create side effect can therefore occur no later than 90s');
  });

  it('documents durable per-effect completion and target verification before manual replay', () => {
    expect(runbook).toContain('postCommitEffectsPending=<comma-separated effect names>');
    expect(runbook).toContain('postCommitEffectCompleted=<effect name>');
    expect(runbook).toContain('Application logs are observability only');
    expect(runbook).toContain('verify the target system first');
    expect(runbook).toContain(
      'missing durable marker is evidence of an unresolved effect, not proof that replay is safe',
    );
    expect(runbook).not.toContain('compare it with application-log completion markers');
    expect(runbook).not.toContain('Manually replay any missing effect after a crash');
  });

  it('documents that non-authoritative listing misses never arm an automatic retry', () => {
    expect(compactRunbook).toContain('listing misses are alert-only');
    expect(compactRunbook).toContain('keep the existing `requestReference`');
    expect(compactRunbook).toContain('preflight failure before any create call');
    expect(compactRunbook).toContain('classified definite create rejection');
    expect(runbook).not.toContain('non-authoritative listing miss will arm automatic retry');
  });

  it('documents the Frick-only intent/scanner boundary and uncached correctness read', () => {
    expect(runbook).toContain("provider = 'Bank Frick'");
    expect(runbook).toContain('Yapeal retains its pre-feature direct create/save flow');
    expect(runbook).toContain('uncached');
    expect(runbook).not.toContain('newest row always wins');
  });
});
