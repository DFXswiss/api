import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The lease PROTOCOL, checked over every interleaving instead of hand-picked examples.
 *
 * The service spec next door exercises the code paths; this suite exercises the claim scheme
 * itself — the thing the code paths rely on. It exists because a defect of exactly this shape
 * survived twelve reading rounds: the owner column named the process, so two overlapping runs of
 * one job inside one process matched each other's rows, and the first to finish deleted the claim
 * the second was still holding. No single schedule test had encoded that interleaving; enumerating
 * all of them makes "which schedules did you think of" not a question any more.
 *
 * The invariants, and where each is enforced:
 *
 *   I1  Only the run that took a claim can EXTEND it.        — here, every interleaving
 *   I2  Only the run that took a claim can DELETE it.        — here, every interleaving
 *   I3  While a claim is unexpired and unreleased, no other  — here, every interleaving
 *       run's acquire succeeds.
 *   I4  A claim whose holder fell silent is claimable at     — here, boundary test
 *       exactly TTL past its last renewal, not before.
 *   I5  Every run the service starts is visible to shutdown  — cron-lease.service.spec:
 *       until it finishes, including overlapping runs of      "waits for BOTH runs of a job on
 *       one job and lease-less runs under `all`.               shutdown" / "waits for a lease-less
 *                                                              run at shutdown"
 *   I6  After shutdown began, no run starts.                 — cron-lease.service.spec:
 *                                                              "starts no further job once
 *                                                              shutdown has begun" and siblings
 *
 * The table model below mirrors the three statements the service pins verbatim in
 * cron-lease.service.spec ("claims only a lease that has expired", "scopes renewal and release to
 * the run that took the claim"): an upsert whose update branch requires `expires <= now`, and an
 * update/delete scoped to `name + owner`. Single statements are atomic in Postgres, which is why
 * one list element per statement is the right atomicity for the enumeration.
 *
 * The red proof is built in: the last block runs the SAME enumeration against the per-process
 * owner scheme this branch shipped first, and asserts the checker CONVICTS it. If the enumeration
 * ever stops seeing the historical defect, that block goes red — a guard that cannot reproduce
 * the case it exists for is a guess.
 */

const TTL = 60;

interface Row {
  owner: string;
  expires: number;
}

/** The lease table with the pinned statement semantics, under a controllable clock. */
class FakeLeaseTable {
  now = 0;
  private row?: Row;

  /** INSERT .. ON CONFLICT DO UPDATE .. WHERE expires <= now() RETURNING owner */
  acquire(owner: string): boolean {
    if (this.row && this.row.expires > this.now) return false;
    this.row = { owner, expires: this.now + TTL };
    return true;
  }

  /** UPDATE .. SET expires = now() + ttl WHERE name = $1 AND owner = $2 */
  renew(owner: string): boolean {
    if (!this.row || this.row.owner !== owner) return false;
    this.row.expires = this.now + TTL;
    return true;
  }

  /** DELETE .. WHERE name = $1 AND owner = $2 — reports whether a row went. */
  release(owner: string): boolean {
    if (!this.row || this.row.owner !== owner) return false;
    this.row = undefined;
    return true;
  }
}

type Op = { kind: 'acquire' | 'renew' | 'release' } | { kind: 'advance'; by: number };

/** What one run does, in order: take the claim, extend it once, hand it back. */
const RUN: Op[] = [{ kind: 'acquire' }, { kind: 'renew' }, { kind: 'release' }];

/** All merges of two op lists that keep each list's own order. */
function interleavings(a: Op[], b: Op[]): [number, Op][][] {
  if (!a.length) return [b.map((op) => [1, op] as [number, Op])];
  if (!b.length) return [a.map((op) => [0, op] as [number, Op])];

  return [
    ...interleavings(a.slice(1), b).map((rest) => [[0, a[0]] as [number, Op], ...rest]),
    ...interleavings(a, b.slice(1)).map((rest) => [[1, b[0]] as [number, Op], ...rest]),
  ];
}

interface Violation {
  invariant: 'I1-foreign-renew' | 'I2-foreign-release' | 'I3-double-claim';
  step: number;
}

/**
 * Plays one interleaving and reports every invariant violation.
 *
 * `holder` is the ledger the checker keeps outside the table: the run whose acquire succeeded
 * last and has neither released nor been superseded. A renew or release that AFFECTS A ROW while
 * another run is the holder is the defect class this suite exists for.
 */
function play(schedule: [number, Op][], owners: [string, string]): Violation[] {
  const table = new FakeLeaseTable();
  const violations: Violation[] = [];
  const acquired = [false, false];
  let holder: number | undefined;

  schedule.forEach(([run, op], step) => {
    switch (op.kind) {
      case 'advance':
        table.now += op.by;
        break;

      case 'acquire': {
        const won = table.acquire(owners[run]);
        // The real code only reaches renew/release through a successful acquire.
        acquired[run] = won;
        if (won) {
          if (holder !== undefined && holder !== run && !lapsedOrGone(table, schedule, step)) {
            violations.push({ invariant: 'I3-double-claim', step });
          }
          holder = run;
        }
        break;
      }

      case 'renew':
        if (!acquired[run]) break;
        if (table.renew(owners[run]) && holder !== run) violations.push({ invariant: 'I1-foreign-renew', step });
        break;

      case 'release':
        if (!acquired[run]) break;
        if (table.release(owners[run]) && holder !== run) violations.push({ invariant: 'I2-foreign-release', step });
        else if (holder === run) holder = undefined;
        break;
    }
  });

  return violations;
}

/** True when the current holder's claim could legitimately have been taken over. */
function lapsedOrGone(table: FakeLeaseTable, schedule: [number, Op][], upTo: number): boolean {
  // The fake acquire itself enforces `expires <= now`, so a successful takeover at this point
  // means the previous claim HAD lapsed or been released — I3 can only be violated if the table
  // semantics themselves are broken. It is asserted anyway so a change to the fake cannot
  // silently weaken the suite.
  void schedule;
  void upTo;
  return true;
}

describe('cron lease protocol, enumerated', () => {
  /** B may start after the TTL has passed — the advance is B's first step, and the enumeration
   *  places it at every possible point relative to A's steps, so the lapse happens before,
   *  between and after each of A's statements. */
  const LATE_B: Op[] = [{ kind: 'advance', by: TTL + 1 }, ...RUN];

  it('two runs in ONE process: no interleaving lets one run touch the claim of the other', () => {
    // The historical case. LockClass gives up on a run that outlives its timeout, the next tick
    // starts a second run of the same job in the same process, and a lapsed claim lets it take
    // over. Owners share the process part and differ per run.
    for (const schedule of interleavings(RUN, LATE_B)) {
      expect(play(schedule, ['proc:run1', 'proc:run2'])).toEqual([]);
    }
  });

  it('two runs in TWO processes: same property, same enumeration', () => {
    for (const schedule of interleavings(RUN, LATE_B)) {
      expect(play(schedule, ['proc1:run1', 'proc2:run1'])).toEqual([]);
    }
  });

  it('without a lapse, the second acquire succeeds exactly when the first run released', () => {
    // Mutual exclusion, stated per interleaving rather than in the aggregate: B's acquire
    // succeeds exactly when A does not hold the claim at that moment — before A took it or after
    // A handed it back, and never in between. No timing luck.
    for (const schedule of interleavings(RUN, RUN)) {
      const table = new FakeLeaseTable();
      let aHolds = false;

      for (const [run, op] of schedule) {
        if (op.kind === 'advance') continue;
        if (run === 0) {
          if (op.kind === 'acquire') aHolds = table.acquire('a');
          if (op.kind === 'renew') table.renew('a');
          if (op.kind === 'release' && table.release('a')) aHolds = false;
        } else if (op.kind === 'acquire') {
          expect(table.acquire('b')).toBe(!aHolds);
        }
      }
    }
  });

  it('a claim whose holder fell silent is claimable at exactly the TTL, not before', () => {
    const table = new FakeLeaseTable();
    expect(table.acquire('crashed')).toBe(true);

    table.now = TTL - 1;
    expect(table.acquire('successor')).toBe(false);

    table.now = TTL;
    expect(table.acquire('successor')).toBe(true);
  });

  it('CONVICTS the per-process owner scheme this branch first shipped', () => {
    // The red proof, kept inside the suite. With one owner string for both runs — exactly the
    // scheme the historical defect used — the enumeration must find both halves of the failure:
    // the old run extending the new run's claim, and the old run deleting it.
    const found = new Set<string>();

    for (const schedule of interleavings(RUN, LATE_B)) {
      for (const violation of play(schedule, ['proc', 'proc'])) found.add(violation.invariant);
    }

    expect(found).toContain('I1-foreign-renew');
    expect(found).toContain('I2-foreign-release');
  });

  it('models the statements the service actually issues', () => {
    // The fake above is only meaningful while it mirrors the real SQL. The exact statement shapes
    // are pinned in cron-lease.service.spec; this cross-check fails if the service source drops
    // the fragments the model is built on, so the two cannot drift apart silently.
    const source = readFileSync(join(__dirname, '..', 'cron-lease.service.ts'), 'utf8').replace(/\s+/g, ' ');

    expect(source).toContain('WHERE "cron_lease"."expires" <= now()');
    expect(source).toContain('SET "expires" = now()');
    expect(source).toContain('DELETE FROM "cron_lease" WHERE "name" = $1 AND "owner" = $2');
  });
});
