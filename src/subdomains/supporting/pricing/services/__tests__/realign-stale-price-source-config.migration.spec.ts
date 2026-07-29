import { newDb } from 'pg-mem';
import { DataSource, QueryRunner } from 'typeorm';

// The reporting block is PL/pgSQL, which pg-mem does not implement, so the suite below covers the
// guards against pg-mem and the reporting against a real Postgres when one is provided. Without a
// connection string that second suite skips, keeping CI (which has no DB) green.
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
  // expected configuration in exactly one column, so every predicate of the guard is load-bearing:
  // drop any one of them and the corresponding case starts matching.
  const singleColumnDeviations = (
    asset: string,
    reference: string,
    limit: number,
  ): { label: string; asset: string; reference: string; limit: number }[] => [
    { label: 'a re-pointed check asset', asset: `${asset}X`, reference, limit },
    { label: 'a re-pointed check reference', asset, reference: `${reference}X`, limit },
    { label: 'a widened check tolerance', asset, reference, limit: limit + 0.02 },
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

    it('restores the original configuration on down', async () => {
      await migration.up({ query });
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

  describe.each([
    { id: 17, source: 'Binance', asset: 'MKR', reference: 'USDT', limit: 0.03 },
    { id: 42, source: 'Kucoin', asset: 'ISLM', reference: 'USDT', limit: 0.03 },
  ])('against a hand-modified rule $id', ({ id, source, asset, reference, limit }) => {
    it.each(singleColumnDeviations(asset, reference, limit))('is left untouched when it has $label', async (d) => {
      insertRule(id, source, d.asset, d.reference, d.limit);
      const before = rules();

      await migration.up({ query });
      expect(rules()).toEqual(before);

      await migration.down({ query });
      expect(rules()).toEqual(before);
    });
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
    await qr.query(`
      INSERT INTO "price_rule" ("id", "check1Source", "check1Asset", "check1Reference", "check1Limit")
      VALUES (17, 'Binance', 'MKR', 'USDT', 0.03), (42, 'Kucoin', 'ISLM', 'USDT', 0.03)
    `);

    const notices = await captureNotices(() => migration.up(qr));

    expect(driftNotices(notices)).toEqual([]);
  });

  it('stays silent when the rules already hold the intended state', async () => {
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
});
