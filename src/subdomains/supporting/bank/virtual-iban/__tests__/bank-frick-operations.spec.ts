import { readFileSync } from 'fs';
import { resolve } from 'path';
import { newDb } from 'pg-mem';

describe('Bank Frick operations runbook', () => {
  const runbook = readFileSync(resolve(__dirname, '../../../../../../docs/bank-frick-operations.md'), 'utf8');
  const deploymentGuide = readFileSync(resolve(__dirname, '../../../../../../infrastructure/README.md'), 'utf8');
  const serviceSource = readFileSync(resolve(__dirname, '../virtual-iban.service.ts'), 'utf8');
  const frickServiceSource = readFileSync(
    resolve(__dirname, '../../../../../../src/integration/bank/services/frick.service.ts'),
    'utf8',
  );
  const frickCoverageConfig = readFileSync(resolve(__dirname, '../../../../../../jest.frick.config.js'), 'utf8');
  const compactRunbook = runbook.replace(/\s+/g, ' ');

  it('includes preflight in the 120-second local window without treating it as a Frick deadline', () => {
    expect(runbook).toContain('conservative **local** upper-bound estimate for the create attempt is **120 seconds**');
    expect(runbook).toContain('authorization preflight before the create call can consume 30s');
    expect(runbook).toContain('120s is not a Bank Frick SLA or processing deadline');
    expect(runbook).toContain('not a retry or automatic-fallback precondition');
    expect(runbook).toContain('Bank Frick may queue or finish work after the local HTTP attempt has ended');
    expect(runbook).not.toContain('FRICK_CREATE_MAX_PROCESSING_MS');
    expect(runbook).not.toContain('latestPossibleCreateProcessedAt');
  });

  it('documents durable per-effect completion and target verification before manual replay', () => {
    expect(runbook).toContain('postCommitEffectsPending=<comma-separated effect names>');
    expect(runbook).toContain('postCommitEffectCompleted=<effect name>');
    expect(runbook).toContain('postCommitEffectFailed=<effect name>');
    expect(runbook).toContain('not customer email addresses or names');
    expect(runbook).toContain('Application logs are observability only');
    expect(runbook).toContain('verify the target system first');
    expect(runbook).toContain(
      'missing durable marker is evidence of an unresolved effect, not proof that replay is safe',
    );
    expect(runbook).not.toContain('compare it with application-log completion markers');
    expect(runbook).not.toContain('Manually replay any missing effect after a crash');
  });

  it('documents that non-authoritative listing misses never arm an automatic retry', () => {
    expect(compactRunbook).toContain('listing absence remains non-authoritative');
    expect(compactRunbook).toContain('never enables a second create');
    expect(compactRunbook).toContain('keep the existing `requestReference`');
    expect(compactRunbook).toContain('preflight failure before any create call');
    expect(compactRunbook).toContain('classified definite create rejection');
    expect(runbook).not.toContain('non-authoritative listing miss will arm automatic retry');
  });

  it('keeps code comments aligned with automatic fail-closed reconciliation', () => {
    expect(serviceSource).not.toContain('Reconciliation is the only');
    expect(serviceSource).not.toContain('reconciliation would reopen');
    expect(frickServiceSource).not.toContain('reconciliation empty-listing resets');
    expect(frickCoverageConfig).not.toContain('stuck-intent reopen');
    expect(frickServiceSource).toContain('Reconciliation only acts on positive matches');
  });

  it('states exactly what listingCompletedAt validation establishes', () => {
    expect(compactRunbook).toContain(
      '`listingCompletedAt` is checked for a valid `Date` and for not preceding `listingStartedAt`',
    );
    expect(compactRunbook).toContain('it establishes no temporal coverage of the create window');
    expect(compactRunbook).not.toContain('latestPossibleCreateProcessedAt');
    expect(compactRunbook).not.toContain('validated when deciding whether a miss is fully covered');
  });

  it('documents the Frick-only intent/scanner boundary and immutable reference-account snapshot', () => {
    expect(runbook).toContain("provider = 'Bank Frick'");
    expect(runbook).toContain('Yapeal retains its pre-feature direct create/save flow');
    expect(runbook).toContain('referenceAccountIban');
    expect(runbook).toContain('referenceAccountReceive');
    expect(runbook).toContain('stop new Frick personal-IBAN issuance');
    expect(runbook).toContain('Reconciliation never switches an in-flight or historical issuance');
    expect(runbook).not.toContain('newest row always wins');
  });

  it('documents park-swap ownership moves as event-logged transitions', () => {
    expect(serviceSource).toContain('Each intermediate and final ownership move appends its');
    expect(serviceSource).not.toContain('Plain ownership moves only — no event log');
  });

  it.each([
    ['operations runbook', runbook],
    ['infrastructure deployment guide', deploymentGuide],
  ])('documents the irreversible personal-IBAN API rollback floor in the %s', (_name, document) => {
    expect(document).toContain('provider-aware');
    expect(document).toContain('FRICK_VBAN_API_URL');
    expect(document).toContain('FROM virtual_iban AS vi');
    expect(document).toContain('INNER JOIN virtual_iban_issuance_event AS vie ON vie."nextVirtualIbanId" = vi.id');
    expect(document).toContain("WHERE vie.provider = 'Bank Frick'");
    expect(document).not.toContain('INNER JOIN bank AS b ON b.id = vi."bankId"');
    expect(document).not.toContain("WHERE b.name = 'Bank Frick'");
    expect(document).toContain('frickPersonalIbanHasExisted');
  });

  it.each([
    ['operations runbook', runbook],
    ['infrastructure deployment guide', deploymentGuide],
  ])('rollback-floor query in the %s survives a Bank-row replacement', (_name, document) => {
    const query = document.match(/```sql\n(SELECT EXISTS \([\s\S]*?AS "frickPersonalIbanHasExisted";)\n```/)?.[1];
    expect(query).toBeDefined();

    const db = newDb();
    db.public.none(`
      CREATE TABLE bank (id integer PRIMARY KEY, name text NOT NULL);
      CREATE TABLE virtual_iban (id integer PRIMARY KEY, "bankId" integer NOT NULL);
      CREATE TABLE virtual_iban_issuance_event (
        id integer PRIMARY KEY,
        "nextVirtualIbanId" integer,
        provider text NOT NULL
      );
      INSERT INTO bank (id, name) VALUES (99, 'Replacement Bank');
      INSERT INTO virtual_iban (id, "bankId") VALUES (42, 99);
      INSERT INTO virtual_iban_issuance_event (id, "nextVirtualIbanId", provider)
      VALUES (7, 42, 'Bank Frick');
    `);

    expect(db.public.one(query!).frickPersonalIbanHasExisted).toBe(true);
  });
});
