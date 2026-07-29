import { newDb } from 'pg-mem';
import { DataSource, QueryRunner } from 'typeorm';

// The reporting block is PL/pgSQL, which pg-mem does not implement, so the suite below covers the
// guards against pg-mem and the reporting against a real Postgres. CI provisions a throwaway
// Postgres and sets the connection string; without one the second suite skips, so a plain local
// run still passes.
const PG_URL = process.env.MIGRATION_TEST_PG;
const describeDb = PG_URL ? describe : describe.skip;

// minimal structural view of the underlying pg client — just enough to observe RAISE NOTICE output
// (TypeORM types QueryRunner.connect() as Promise<any>, so the cast pins a safe surface)
type NoticeListener = (msg: { message?: string }) => void;
interface NoticeEmitter {
  on(event: 'notice', listener: NoticeListener): void;
  removeListener(event: 'notice', listener: NoticeListener): void;
}

type PriceRuleRow = {
  id: number;
  check1Source: string | null;
  check1Asset: string | null;
  check1Reference: string | null;
  check1Limit: number | null;
  updated: Date;
};

let RealignStalePriceSourceConfig: new () => {
  up(queryRunner: { query(sql: string): Promise<void> }): Promise<void>;
  down(queryRunner: { query(sql: string): Promise<void> }): Promise<void>;
};

describe('RealignStalePriceSourceConfig migration', () => {
  let db: ReturnType<typeof newDb>;
  let query: jest.Mock<Promise<void>, [string]>;
  let migration: InstanceType<typeof RealignStalePriceSourceConfig>;

  const EPOCH = new Date('2020-01-01T00:00:00.000Z');

  beforeAll(() => {
    // The migration is intentionally a plain CommonJS module, matching TypeORM's runtime loader.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    RealignStalePriceSourceConfig = require('../../../../../../migration/1785450000000-RealignStalePriceSourceConfig');
  });

  beforeEach(() => {
    db = newDb();
    db.public.none(`
      CREATE TABLE "price_rule" (
        "id" integer PRIMARY KEY,
        "check1Source" character varying(256),
        "check1Asset" character varying(256),
        "check1Reference" character varying(256),
        "check1Limit" double precision,
        "updated" TIMESTAMP NOT NULL
      )
    `);

    query = jest.fn(async (sql: string) => {
      // SET LOCAL is a no-op here, and the reporting block uses PL/pgSQL, which pg-mem does not
      // implement — neither affects the row state these assertions cover.
      if (/^\s*SET\s+LOCAL\b/i.test(sql)) return;
      if (/^\s*DO\s+\$\$/i.test(sql)) return;
      db.public.none(sql);
    });
    migration = new RealignStalePriceSourceConfig();
  });

  const insertRule = (
    id: number,
    check1Source: string | null,
    check1Asset: string | null,
    check1Reference: string | null,
    check1Limit: number | null,
  ): void => {
    db.public.none(`
      INSERT INTO "price_rule" ("id", "check1Source", "check1Asset", "check1Reference", "check1Limit", "updated")
      VALUES (
        ${id},
        ${check1Source === null ? 'NULL' : `'${check1Source}'`},
        ${check1Asset === null ? 'NULL' : `'${check1Asset}'`},
        ${check1Reference === null ? 'NULL' : `'${check1Reference}'`},
        ${check1Limit === null ? 'NULL' : check1Limit},
        '${EPOCH.toISOString()}'
      )
    `);
  };

  const rules = (): PriceRuleRow[] => db.public.many(`SELECT * FROM "price_rule" ORDER BY "id"`) as PriceRuleRow[];
  const rule = (id: number): PriceRuleRow => rules().find((r) => r.id === id);

  // The state this migration was written against.
  const seedProductionLike = (): void => {
    insertRule(17, 'Binance', 'MKR', 'USDT', 0.03);
    insertRule(42, 'Kucoin', 'ISLM', 'USDT', 0.03);
    insertRule(46, 'Kraken', 'EUR', 'USDT', 0.01);
  };

  // migration/seed/price_rule.csv leaves these rules without a check source but with the
  // remaining check columns populated, so neither direction may touch them.
  const seedSeedLike = (): void => {
    insertRule(17, null, 'maker', 'tether', 0.03);
    insertRule(42, null, 'islamic-coin', 'tether', 0.03);
  };

  // A cross-check re-pointed by hand after this migration was written. Each case deviates from the
  // expected configuration in exactly one check column, so every check-column predicate of the
  // up() guard is load-bearing: drop any one of them and the corresponding case starts matching.
  // The id predicates are pinned separately, by the unrelated-rule cases below.
  const singleColumnDeviations = (
    source: string,
    asset: string,
    reference: string,
    limit: number,
  ): { label: string; source: string; asset: string; reference: string; limit: number }[] => [
    { label: 'a re-pointed check source', source: `${source}X`, asset, reference, limit },
    { label: 'a re-pointed check asset', source, asset: `${asset}X`, reference, limit },
    { label: 'a re-pointed check reference', source, asset, reference: `${reference}X`, limit },
    { label: 'a widened check tolerance', source, asset, reference, limit: limit + 0.02 },
  ];

  // Rows where exactly one check column is still populated. down() must leave every one of them
  // alone, which is what makes each of its four IS NULL predicates load-bearing.
  const partiallyClearedStates = (
    source: string,
    asset: string,
    reference: string,
    limit: number,
  ): { label: string; row: [string | null, string | null, string | null, number | null] }[] => [
    { label: 'only a check source', row: [source, null, null, null] },
    { label: 'only a check asset', row: [null, asset, null, null] },
    { label: 'only a check reference', row: [null, null, reference, null] },
    { label: 'only a check tolerance', row: [null, null, null, limit] },
  ];

  const expectNoCheck = (id: number): void => {
    expect(rule(id).check1Source).toBeNull();
    expect(rule(id).check1Asset).toBeNull();
    expect(rule(id).check1Reference).toBeNull();
    expect(rule(id).check1Limit).toBeNull();
  };

  describe('against the expected configuration', () => {
    beforeEach(() => seedProductionLike());

    it('clears the cross-check of both stale rules and bumps updated', async () => {
      await migration.up({ query });

      expectNoCheck(17);
      expectNoCheck(42);
      expect(rule(17).updated.getTime()).toBeGreaterThan(EPOCH.getTime());
      expect(rule(42).updated.getTime()).toBeGreaterThan(EPOCH.getTime());
    });

    it('leaves the rule whose comparison market still trades untouched', async () => {
      await migration.up({ query });

      expect(rule(46)).toMatchObject({
        check1Source: 'Kraken',
        check1Asset: 'EUR',
        check1Reference: 'USDT',
        check1Limit: 0.01,
      });
      expect(rule(46).updated.getTime()).toBe(EPOCH.getTime());
    });

    it('is idempotent — a second run changes nothing', async () => {
      await migration.up({ query });
      // Reset the timestamps the first run bumped, so the assertion cannot pass merely because both
      // runs resolved NOW() to the same instant — an unguarded second run would rewrite them.
      db.public.none(`UPDATE "price_rule" SET "updated" = '${EPOCH.toISOString()}'`);
      const afterFirst = rules();

      await migration.up({ query });

      expect(rules()).toEqual(afterFirst);
      expect(rule(17).updated.getTime()).toBe(EPOCH.getTime());
      expect(rule(42).updated.getTime()).toBe(EPOCH.getTime());
    });

    it('restores the original configuration on down and bumps updated', async () => {
      await migration.up({ query });
      // clear the timestamps up() set, so the assertion below can only pass if down() sets its own
      db.public.none(`UPDATE "price_rule" SET "updated" = '${EPOCH.toISOString()}'`);

      await migration.down({ query });

      expect(rule(17)).toMatchObject({
        check1Source: 'Binance',
        check1Asset: 'MKR',
        check1Reference: 'USDT',
        check1Limit: 0.03,
      });
      expect(rule(42)).toMatchObject({
        check1Source: 'Kucoin',
        check1Asset: 'ISLM',
        check1Reference: 'USDT',
        check1Limit: 0.03,
      });
      expect(rule(17).updated.getTime()).toBeGreaterThan(EPOCH.getTime());
      expect(rule(42).updated.getTime()).toBeGreaterThan(EPOCH.getTime());
      expect(rule(46).updated.getTime()).toBe(EPOCH.getTime());
    });
  });

  describe('against a freshly seeded configuration', () => {
    beforeEach(() => seedSeedLike());

    it('does not modify rules that never carried the retired check source', async () => {
      const before = rules();

      await migration.up({ query });

      expect(rules()).toEqual(before);
    });

    it('does not inject a configuration these rules never had, even on down', async () => {
      const before = rules();

      await migration.up({ query });
      await migration.down({ query });

      expect(rules()).toEqual(before);
    });
  });

  // Both statements are scoped by id as well as by value. Without that scoping down() would stamp
  // a cross-check onto any rule that happens to have none — and a large share of the real table
  // does — so the id predicates need pinning independently of the check-column ones.
  describe('against unrelated rules', () => {
    it('up leaves a rule that merely shares the retired configuration alone', async () => {
      insertRule(98, 'Binance', 'MKR', 'USDT', 0.03);
      insertRule(99, 'Kucoin', 'ISLM', 'USDT', 0.03);
      const before = rules();

      await migration.up({ query });

      expect(rules()).toEqual(before);
    });

    it('down does not stamp a cross-check onto an unrelated rule that has none', async () => {
      insertRule(99, null, null, null, null);
      const before = rules();

      await migration.up({ query });
      await migration.down({ query });

      expect(rules()).toEqual(before);
    });
  });

  describe.each([
    { id: 17, source: 'Binance', asset: 'MKR', reference: 'USDT', limit: 0.03 },
    { id: 42, source: 'Kucoin', asset: 'ISLM', reference: 'USDT', limit: 0.03 },
  ])('against a hand-modified rule $id', ({ id, source, asset, reference, limit }) => {
    it.each(singleColumnDeviations(source, asset, reference, limit))(
      'up leaves it untouched when it has $label',
      async (d) => {
        insertRule(id, d.source, d.asset, d.reference, d.limit);
        const before = rules();

        await migration.up({ query });

        expect(rules()).toEqual(before);
      },
    );

    it.each(partiallyClearedStates(source, asset, reference, limit))(
      'down leaves it untouched when it still has $label',
      async ({ row }) => {
        insertRule(id, row[0], row[1], row[2], row[3]);
        const before = rules();

        await migration.down({ query });

        expect(rules()).toEqual(before);
      },
    );
  });
});

describeDb('RealignStalePriceSourceConfig migration (real Postgres reporting)', () => {
  let dataSource: DataSource;
  let qr: QueryRunner;
  let migration: InstanceType<typeof RealignStalePriceSourceConfig>;

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    RealignStalePriceSourceConfig = require('../../../../../../migration/1785450000000-RealignStalePriceSourceConfig');
    dataSource = new DataSource({ type: 'postgres', url: PG_URL });
    await dataSource.initialize();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DROP SCHEMA IF EXISTS realign_price_rule_spec CASCADE`);
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    qr = dataSource.createQueryRunner();
    await qr.connect();

    // Schema isolation: the real-PG migration specs share one MIGRATION_TEST_PG database and run in
    // parallel jest workers, so unscoped DROP/CREATE of identical table names races on the pg catalog.
    // Every table name here is unqualified, so search_path scopes them into this spec's own schema.
    await qr.query(`CREATE SCHEMA IF NOT EXISTS realign_price_rule_spec`);
    await qr.query(`SET search_path TO realign_price_rule_spec`);
    await qr.query(`DROP TABLE IF EXISTS "price_rule" CASCADE`);
    await qr.query(`
      CREATE TABLE "price_rule" (
        "id" integer PRIMARY KEY,
        "check1Source" character varying(256),
        "check1Asset" character varying(256),
        "check1Reference" character varying(256),
        "check1Limit" double precision,
        "updated" TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    migration = new RealignStalePriceSourceConfig();
  });

  afterEach(async () => {
    await qr.release();
  });

  const captureNotices = async (fn: () => Promise<void>): Promise<string[]> => {
    const client = (await qr.connect()) as NoticeEmitter;
    const notices: string[] = [];
    const onNotice: NoticeListener = (msg) => notices.push(msg.message ?? '');
    client.on('notice', onNotice);
    try {
      await fn();
    } finally {
      client.removeListener('notice', onNotice);
    }
    return notices;
  };

  const driftNotices = (notices: string[]): string[] =>
    notices.filter((n) => n.includes('RealignStalePriceSourceConfig:'));

  it('stays silent when both rules are brought to the intended state', async () => {
    // rule 46 is present and keeps its cross-check throughout: the report must be scoped to the
    // two targeted rules, not to every rule that still has one
    await qr.query(`
      INSERT INTO "price_rule" ("id", "check1Source", "check1Asset", "check1Reference", "check1Limit")
      VALUES (17, 'Binance', 'MKR', 'USDT', 0.03), (42, 'Kucoin', 'ISLM', 'USDT', 0.03),
             (46, 'Kraken', 'EUR', 'USDT', 0.01)
    `);

    const notices = await captureNotices(() => migration.up(qr));

    expect(driftNotices(notices)).toEqual([]);
  });

  it('stays silent in an environment that was only ever seeded, where check1Source alone is NULL', async () => {
    // This shape — check1Source NULL, the other three populated — is what pins the report to
    // check1Source: re-keying it to any other check column makes this case report drift.
    await qr.query(`
      INSERT INTO "price_rule" ("id", "check1Source", "check1Asset", "check1Reference", "check1Limit")
      VALUES (17, NULL, 'maker', 'tether', 0.03), (42, NULL, 'islamic-coin', 'tether', 0.03)
    `);

    const notices = await captureNotices(() => migration.up(qr));

    expect(driftNotices(notices)).toEqual([]);
  });

  it('reports the rules left behind when the stored configuration has drifted', async () => {
    // a limit changed out from under the migration: the guards no longer match, so nothing is updated
    await qr.query(`
      INSERT INTO "price_rule" ("id", "check1Source", "check1Asset", "check1Reference", "check1Limit")
      VALUES (17, 'Binance', 'MKR', 'USDT', 0.05), (42, 'Kucoin', 'ISLM', 'USDT', 0.07)
    `);

    const notices = await captureNotices(() => migration.up(qr));

    expect(driftNotices(notices)).toHaveLength(1);
    expect(driftNotices(notices)[0]).toContain('2 of 2 rules still carry a cross-check');
  });

  it('reports a single drifted rule as one of the two', async () => {
    // only rule 17 was hand-edited; 42 still matches. Pins the count, not just its presence.
    await qr.query(`
      INSERT INTO "price_rule" ("id", "check1Source", "check1Asset", "check1Reference", "check1Limit")
      VALUES (17, 'Binance', 'MKR', 'USDT', 0.05), (42, 'Kucoin', 'ISLM', 'USDT', 0.03)
    `);

    const notices = await captureNotices(() => migration.up(qr));

    expect(driftNotices(notices)).toHaveLength(1);
    expect(driftNotices(notices)[0]).toContain('1 of 2 rules still carry a cross-check');
  });

  it('reverts an applied migration without reporting', async () => {
    await qr.query(`
      INSERT INTO "price_rule" ("id", "check1Source", "check1Asset", "check1Reference", "check1Limit")
      VALUES (17, 'Binance', 'MKR', 'USDT', 0.03), (42, 'Kucoin', 'ISLM', 'USDT', 0.03)
    `);
    await migration.up(qr);

    const notices = await captureNotices(() => migration.down(qr));

    const restored = await qr.query(
      `SELECT "id", "check1Source", "check1Asset", "check1Reference", "check1Limit" FROM "price_rule" ORDER BY "id"`,
    );
    expect(restored).toEqual([
      { id: 17, check1Source: 'Binance', check1Asset: 'MKR', check1Reference: 'USDT', check1Limit: 0.03 },
      { id: 42, check1Source: 'Kucoin', check1Asset: 'ISLM', check1Reference: 'USDT', check1Limit: 0.03 },
    ]);
    expect(driftNotices(notices)).toEqual([]);
  });

  it('leaves a seeded environment untouched and silent on down', async () => {
    // down() carries no report precisely because this shape has nothing to revert; an end-state
    // check keyed on check1Source alone would wrongly flag it as drift. The row assertion is what
    // makes the fixture load-bearing — the notice assertion alone would hold for any fixture.
    const seeded = [
      { id: 17, check1Source: null, check1Asset: 'maker', check1Reference: 'tether', check1Limit: 0.03 },
      { id: 42, check1Source: null, check1Asset: 'islamic-coin', check1Reference: 'tether', check1Limit: 0.03 },
    ];
    await qr.query(`
      INSERT INTO "price_rule" ("id", "check1Source", "check1Asset", "check1Reference", "check1Limit")
      VALUES (17, NULL, 'maker', 'tether', 0.03), (42, NULL, 'islamic-coin', 'tether', 0.03)
    `);

    const notices = await captureNotices(() => migration.down(qr));

    const after = await qr.query(
      `SELECT "id", "check1Source", "check1Asset", "check1Reference", "check1Limit" FROM "price_rule" ORDER BY "id"`,
    );
    expect(after).toEqual(seeded);
    expect(driftNotices(notices)).toEqual([]);
  });
});
