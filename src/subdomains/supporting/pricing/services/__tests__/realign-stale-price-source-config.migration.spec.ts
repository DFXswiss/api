import { newDb } from 'pg-mem';

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
      const afterFirst = rules();

      await migration.up({ query });

      expect(rules()).toEqual(afterFirst);
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
});
