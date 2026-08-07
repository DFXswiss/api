import { DataType, newDb } from 'pg-mem';
import { DataSource, QueryRunner } from 'typeorm';

const PG_URL = process.env.MIGRATION_TEST_PG;
const describeDb = PG_URL ? describe : describe.skip;
const SCHEMA = 'prefer_usdt_over_btc_spec';
const AUDIT_SUBSYSTEM = 'PreferUsdtOverBtcForLiquidityTrades1786001000000';

// One pair from the migration's pairs list — ids are fixed identities.
const BTC_ID = 10;
const USDT_ID = 13;
const T_ID = 99;
const W_ID = 50;
const W2_SOURCE_ID = 51;

type Migration = {
  up(queryRunner: QueryRunner): Promise<void>;
  down(queryRunner: QueryRunner): Promise<void>;
  pairs: [number, number][];
};

let PreferUsdtOverBtc: new () => Migration;

async function createTables(queryRunner: QueryRunner): Promise<void> {
  await queryRunner.query(`
    CREATE TABLE "asset" (
      "id" serial PRIMARY KEY,
      "name" text NOT NULL
    )
  `);
  await queryRunner.query(`
    CREATE TABLE "liquidity_management_action" (
      "id" serial PRIMARY KEY,
      "system" text NOT NULL,
      "command" text NOT NULL,
      "tag" text,
      "params" text,
      "onSuccessId" integer,
      "onFailId" integer
    )
  `);
  await queryRunner.query(`
    CREATE TABLE "liquidity_management_rule" (
      "id" serial PRIMARY KEY,
      "deficitStartActionId" integer,
      "redundancyStartActionId" integer,
      "targetAssetId" integer,
      "status" text NOT NULL DEFAULT 'Active'
    )
  `);
  await queryRunner.query(`
    CREATE TABLE "liquidity_management_order" (
      "id" serial PRIMARY KEY,
      "actionId" integer
    )
  `);
  await queryRunner.query(`
    CREATE TABLE "liquidity_management_pipeline" (
      "id" serial PRIMARY KEY,
      "currentActionId" integer,
      "previousActionId" integer
    )
  `);
  await queryRunner.query(`
    CREATE TABLE "log" (
      "id" serial PRIMARY KEY,
      "created" timestamp NOT NULL DEFAULT NOW(),
      "updated" timestamp NOT NULL DEFAULT NOW(),
      "system" text NOT NULL,
      "subsystem" text NOT NULL,
      "severity" text NOT NULL,
      "message" text NOT NULL
    )
  `);
}

async function insertAction(
  queryRunner: QueryRunner,
  row: {
    id: number;
    system?: string;
    command?: string;
    tag?: string | null;
    params?: string | null;
    onSuccessId?: number | null;
    onFailId?: number | null;
  },
): Promise<void> {
  await queryRunner.query(
    `INSERT INTO "liquidity_management_action"
       ("id", "system", "command", "tag", "params", "onSuccessId", "onFailId")
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      row.id,
      row.system ?? 'Binance',
      row.command ?? 'buy',
      row.tag ?? null,
      row.params ?? null,
      row.onSuccessId ?? null,
      row.onFailId ?? null,
    ],
  );
}

async function insertAsset(queryRunner: QueryRunner, id: number, name: string): Promise<void> {
  await queryRunner.query(`INSERT INTO "asset" ("id", "name") VALUES ($1, $2)`, [id, name]);
}

async function insertRule(
  queryRunner: QueryRunner,
  row: {
    id: number;
    deficitStartActionId: number | null;
    targetAssetId: number | null;
    status?: string;
  },
): Promise<void> {
  await queryRunner.query(
    `INSERT INTO "liquidity_management_rule"
       ("id", "deficitStartActionId", "targetAssetId", "status")
     VALUES ($1, $2, $3, $4)`,
    [row.id, row.deficitStartActionId, row.targetAssetId, row.status ?? 'Active'],
  );
}

async function actionOnFail(queryRunner: QueryRunner, id: number): Promise<number | null> {
  const rows = await queryRunner.query(`SELECT "onFailId" FROM "liquidity_management_action" WHERE "id" = $1`, [id]);
  const v = rows.at(0)?.onFailId;
  return v == null ? null : Number(v);
}

async function ruleStart(queryRunner: QueryRunner, id: number): Promise<number | null> {
  const rows = await queryRunner.query(
    `SELECT "deficitStartActionId" FROM "liquidity_management_rule" WHERE "id" = $1`,
    [id],
  );
  const v = rows.at(0)?.deficitStartActionId;
  return v == null ? null : Number(v);
}

async function ruleStatus(queryRunner: QueryRunner, id: number): Promise<string> {
  const rows = await queryRunner.query(`SELECT "status" FROM "liquidity_management_rule" WHERE "id" = $1`, [id]);
  return rows.at(0).status;
}

async function auditMessages(queryRunner: QueryRunner): Promise<unknown[]> {
  const rows = await queryRunner.query(`SELECT "message" FROM "log" WHERE "subsystem" = $1 ORDER BY "id"`, [
    AUDIT_SUBSYSTEM,
  ]);
  return rows.map((row: { message: string }) =>
    typeof row.message === 'string' ? JSON.parse(row.message) : row.message,
  );
}

/** Baseline chain W → B → U → T for a single pair (BTC_ID / USDT_ID). */
async function seedBaselineChain(
  queryRunner: QueryRunner,
  opts: {
    tId?: number | null;
    withW?: boolean;
    extraWIds?: number[];
  } = {},
): Promise<void> {
  const tId = opts.tId === undefined ? T_ID : opts.tId;
  if (tId != null) {
    await insertAction(queryRunner, { id: tId, tag: 'T', onFailId: null });
  }
  await insertAction(queryRunner, { id: USDT_ID, tag: 'buy USDT', onFailId: tId });
  await insertAction(queryRunner, { id: BTC_ID, tag: 'buy BTC', onFailId: USDT_ID });

  if (opts.withW !== false) {
    await insertAction(queryRunner, { id: W_ID, tag: 'withdraw', command: 'withdraw', onFailId: BTC_ID });
  }
  for (const wId of opts.extraWIds ?? []) {
    await insertAction(queryRunner, { id: wId, tag: `withdraw-${wId}`, command: 'withdraw', onFailId: BTC_ID });
  }
}

describe('PreferUsdtOverBtcForLiquidityTrades migration (SQL content)', () => {
  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    PreferUsdtOverBtc = require('../../../../../migration/1786001000000-PreferUsdtOverBtcForLiquidityTrades');
  });

  it('is a no-op when an active apply audit already exists (idempotency gate)', async () => {
    const migration = new PreferUsdtOverBtc();
    const queryRunner = {
      query: jest.fn(async (sql: string) => {
        const s = sql.toLowerCase();
        if (s.includes('from "log"') && s.includes('subsystem')) {
          return [
            {
              id: 1,
              message: JSON.stringify({ action: 'applyPreferUsdtOverBtc', entries: [{ dummy: true }] }),
            },
          ];
        }
        return [];
      }),
    };

    await migration.up(queryRunner as unknown as QueryRunner);

    const calls = queryRunner.query.mock.calls as [string, unknown[]?][];
    // Only the active-apply lookup — no action reads, no inserts, no updates.
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toMatch(/FROM "log"/i);
    expect(calls[0][1]).toEqual([AUDIT_SUBSYSTEM]);
    expect(calls.some(([sql]) => /UPDATE|INSERT INTO "liquidity_management/i.test(sql))).toBe(false);
  });

  it('writes the apply audit with parameters before any column UPDATE', async () => {
    const migration = new PreferUsdtOverBtc();
    let nextActionId = 1000;
    const queryRunner = {
      query: jest.fn(async (sql: string, params?: unknown[]) => {
        const s = sql.toLowerCase();

        if (s.includes('from "log"') && s.includes('subsystem') && !s.includes('insert')) {
          return [];
        }
        if (s.includes('from "liquidity_management_action"') && s.includes(`"id" = $1`)) {
          const id = Number(params?.[0]);
          if (id === BTC_ID) {
            return [
              {
                id: BTC_ID,
                system: 'Binance',
                command: 'buy',
                tag: 'B',
                params: null,
                onSuccessId: null,
                onFailId: USDT_ID,
              },
            ];
          }
          if (id === USDT_ID) {
            return [
              {
                id: USDT_ID,
                system: 'Binance',
                command: 'buy',
                tag: 'U',
                params: null,
                onSuccessId: null,
                onFailId: T_ID,
              },
            ];
          }
          return [];
        }
        if (s.includes('from "liquidity_management_action"') && s.includes('onfailid') && !s.includes('insert')) {
          return [];
        }
        if (s.includes('from "liquidity_management_rule"')) {
          return [];
        }
        if (s.includes('insert into "log"')) {
          return [{ id: 42 }];
        }
        if (s.includes('insert into "liquidity_management_action"')) {
          nextActionId += 1;
          return [{ id: nextActionId }];
        }
        if (s.startsWith('update ')) {
          return [];
        }
        return [];
      }),
    };

    await migration.up(queryRunner as unknown as QueryRunner);

    const calls = queryRunner.query.mock.calls as [string, unknown[]?][];
    const firstUpdateIdx = calls.findIndex(([sql]) => sql.trim().toLowerCase().startsWith('update '));
    const auditInsertIdx = calls.findIndex(([sql]) => /INSERT INTO "log"/i.test(sql));

    expect(auditInsertIdx).toBeGreaterThanOrEqual(0);
    expect(firstUpdateIdx).toBeGreaterThan(auditInsertIdx);

    // Audit insert is parameterized (subsystem + JSON payload).
    expect(calls[auditInsertIdx][1]).toEqual([AUDIT_SUBSYSTEM, expect.stringContaining('applyPreferUsdtOverBtc')]);

    // Every UPDATE uses bound parameters, not interpolated ids.
    for (const [sql, bound] of calls.filter(([statement]) => statement.trim().toLowerCase().startsWith('update '))) {
      expect(sql).toMatch(/\$1/);
      expect(bound).toBeDefined();
      expect(Array.isArray(bound)).toBe(true);
    }
  });

  it('fails closed when the apply audit insert returns no id (no UPDATEs run)', async () => {
    const migration = new PreferUsdtOverBtc();
    const queryRunner = {
      query: jest.fn(async (sql: string, params?: unknown[]) => {
        const s = sql.toLowerCase();

        if (s.includes('from "log"') && !s.includes('insert')) return [];
        if (s.includes('from "liquidity_management_action"') && s.includes(`"id" = $1`)) {
          const id = Number(params?.[0]);
          if (id === BTC_ID) {
            return [
              {
                id: BTC_ID,
                system: 'Binance',
                command: 'buy',
                tag: 'B',
                params: null,
                onSuccessId: null,
                onFailId: USDT_ID,
              },
            ];
          }
          if (id === USDT_ID) {
            return [
              {
                id: USDT_ID,
                system: 'Binance',
                command: 'buy',
                tag: 'U',
                params: null,
                onSuccessId: null,
                onFailId: null,
              },
            ];
          }
          return [];
        }
        if (s.includes('from "liquidity_management_action"') && s.includes('onfailid')) return [];
        if (s.includes('from "liquidity_management_rule"')) return [];
        if (s.includes('insert into "log"')) return []; // no RETURNING id → fail closed
        if (s.startsWith('update ')) {
          throw new Error('UPDATE must not run when audit insert fails');
        }
        return [];
      }),
    };

    await expect(migration.up(queryRunner as unknown as QueryRunner)).rejects.toThrow(/Failed to write audit event/);

    const updates = (queryRunner.query.mock.calls as [string][]).filter(([sql]) =>
      sql.trim().toLowerCase().startsWith('update '),
    );
    expect(updates).toHaveLength(0);
  });

  it('clone INSERTs are parameterized and set onFailId at insert time', async () => {
    const migration = new PreferUsdtOverBtc();
    let nextActionId = 500;
    const queryRunner = {
      query: jest.fn(async (sql: string, params?: unknown[]) => {
        const s = sql.toLowerCase();

        if (s.includes('from "log"') && !s.includes('insert')) return [];
        if (s.includes('from "liquidity_management_action"') && s.includes(`"id" = $1`)) {
          const id = Number(params?.[0]);
          if (id === BTC_ID) {
            return [
              {
                id: BTC_ID,
                system: 'Binance',
                command: 'buy',
                tag: 'buy BTC',
                params: '{}',
                onSuccessId: null,
                onFailId: USDT_ID,
              },
            ];
          }
          if (id === USDT_ID) {
            return [
              {
                id: USDT_ID,
                system: 'Binance',
                command: 'buy',
                tag: 'buy USDT',
                params: '{}',
                onSuccessId: null,
                onFailId: T_ID,
              },
            ];
          }
          return [];
        }
        if (s.includes('from "liquidity_management_action"') && s.includes('onfailid') && !s.includes('insert')) {
          // One W pointing at B
          return [
            {
              id: W_ID,
              system: 'Binance',
              command: 'withdraw',
              tag: 'W',
              params: null,
              onSuccessId: null,
              onFailId: BTC_ID,
            },
          ];
        }
        if (s.includes('from "liquidity_management_rule"') && s.includes(`'wbtc'`)) {
          // WBTC rule starts at W → triggers W2/B2/U2 clones
          if (params?.[0] === W_ID || params?.[0] === BTC_ID) {
            // For BTC_ID direct WBTC query returns empty; for W_ID returns a rule
            if (Number(params?.[0]) === W_ID) return [{ id: 7 }];
            return [];
          }
        }
        if (s.includes('from "liquidity_management_rule"')) return [];
        if (s.includes('insert into "liquidity_management_action"')) {
          nextActionId += 1;
          return [{ id: nextActionId }];
        }
        if (s.includes('insert into "log"')) return [{ id: 1 }];
        return [];
      }),
    };

    await migration.up(queryRunner as unknown as QueryRunner);

    const cloneInserts = (queryRunner.query.mock.calls as [string, unknown[]?][]).filter(([sql]) =>
      /INSERT INTO "liquidity_management_action"/i.test(sql),
    );
    // U2, B2, W2
    expect(cloneInserts.length).toBeGreaterThanOrEqual(3);
    for (const [sql, bound] of cloneInserts) {
      expect(sql).toMatch(/\$1/);
      expect(sql).toMatch(/\$6/);
      expect(bound).toHaveLength(6);
      // Tag is source tag + ' WBTC' (or 'WBTC' alone)
      expect(String(bound![2])).toMatch(/WBTC/);
    }
  });
});

describe('PreferUsdtOverBtcForLiquidityTrades migration (pg-mem semantics)', () => {
  let dataSource: DataSource;
  let queryRunner: QueryRunner;

  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    PreferUsdtOverBtc = require('../../../../../migration/1786001000000-PreferUsdtOverBtcForLiquidityTrades');
  });

  beforeEach(async () => {
    const db = newDb();
    db.public.registerFunction({ name: 'version', returns: DataType.text, implementation: () => 'PostgreSQL 15.0' });
    db.public.registerFunction({ name: 'current_database', returns: DataType.text, implementation: () => 'test' });

    dataSource = (await db.adapters.createTypeormDataSource({ type: 'postgres', entities: [] })) as DataSource;
    await dataSource.initialize();

    queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    await createTables(queryRunner);
  });

  afterEach(async () => {
    await queryRunner.release();
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it('rewires a WBTC-free pair to W → U → B → T', async () => {
    await seedBaselineChain(queryRunner, { withW: true });
    await insertAsset(queryRunner, 1, 'ETH');
    await insertRule(queryRunner, { id: 1, deficitStartActionId: W_ID, targetAssetId: 1 });

    await new PreferUsdtOverBtc().up(queryRunner);

    expect(await actionOnFail(queryRunner, W_ID)).toBe(USDT_ID);
    expect(await actionOnFail(queryRunner, USDT_ID)).toBe(BTC_ID);
    expect(await actionOnFail(queryRunner, BTC_ID)).toBe(T_ID);
    expect(await ruleStart(queryRunner, 1)).toBe(W_ID);

    const events = (await auditMessages(queryRunner)) as Array<{ action: string; entries: unknown[] }>;
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe('applyPreferUsdtOverBtc');
    expect(events[0].entries.length).toBeGreaterThan(0);
  });

  it('rewires every W that points at the same B to U', async () => {
    await seedBaselineChain(queryRunner, { withW: true, extraWIds: [W2_SOURCE_ID] });

    await new PreferUsdtOverBtc().up(queryRunner);

    expect(await actionOnFail(queryRunner, W_ID)).toBe(USDT_ID);
    expect(await actionOnFail(queryRunner, W2_SOURCE_ID)).toBe(USDT_ID);
  });

  it('repoints a non-WBTC rule that starts at B to U', async () => {
    await seedBaselineChain(queryRunner, { withW: false });
    await insertAsset(queryRunner, 1, 'ETH');
    await insertRule(queryRunner, { id: 1, deficitStartActionId: BTC_ID, targetAssetId: 1 });

    await new PreferUsdtOverBtc().up(queryRunner);

    expect(await ruleStart(queryRunner, 1)).toBe(USDT_ID);
  });

  it('repoints a NULL-target rule that starts at B to U (NULL-safe filter)', async () => {
    await seedBaselineChain(queryRunner, { withW: false });
    await insertRule(queryRunner, { id: 1, deficitStartActionId: BTC_ID, targetAssetId: null });

    await new PreferUsdtOverBtc().up(queryRunner);

    expect(await ruleStart(queryRunner, 1)).toBe(USDT_ID);
  });

  it('clones B2/U2 for a WBTC rule that starts directly at B', async () => {
    await seedBaselineChain(queryRunner, { withW: false });
    await insertAsset(queryRunner, 2, 'WBTC');
    await insertRule(queryRunner, { id: 1, deficitStartActionId: BTC_ID, targetAssetId: 2 });

    await new PreferUsdtOverBtc().up(queryRunner);

    const b2Id = await ruleStart(queryRunner, 1);
    expect(b2Id).not.toBe(BTC_ID);
    expect(b2Id).not.toBeNull();

    const b2 = (
      await queryRunner.query(`SELECT "tag", "onFailId" FROM "liquidity_management_action" WHERE "id" = $1`, [b2Id])
    ).at(0);
    expect(b2.tag).toBe('buy BTC WBTC');

    const u2Id = Number(b2.onFailId);
    const u2 = (
      await queryRunner.query(`SELECT "tag", "onFailId" FROM "liquidity_management_action" WHERE "id" = $1`, [u2Id])
    ).at(0);
    expect(u2.tag).toBe('buy USDT WBTC');
    expect(Number(u2.onFailId)).toBe(T_ID);

    // Shared original chain still flips to USDT-first for non-WBTC use.
    expect(await actionOnFail(queryRunner, USDT_ID)).toBe(BTC_ID);
    expect(await actionOnFail(queryRunner, BTC_ID)).toBe(T_ID);
  });

  it('clones W2→B2→U2 for a WBTC rule that starts at W', async () => {
    await seedBaselineChain(queryRunner, { withW: true });
    await insertAsset(queryRunner, 2, 'WBTC');
    await insertRule(queryRunner, { id: 1, deficitStartActionId: W_ID, targetAssetId: 2 });

    await new PreferUsdtOverBtc().up(queryRunner);

    const w2Id = await ruleStart(queryRunner, 1);
    expect(w2Id).not.toBe(W_ID);

    const w2 = (
      await queryRunner.query(`SELECT "tag", "onFailId" FROM "liquidity_management_action" WHERE "id" = $1`, [w2Id])
    ).at(0);
    expect(w2.tag).toBe('withdraw WBTC');

    const b2Id = Number(w2.onFailId);
    const b2 = (
      await queryRunner.query(`SELECT "tag", "onFailId" FROM "liquidity_management_action" WHERE "id" = $1`, [b2Id])
    ).at(0);
    expect(b2.tag).toBe('buy BTC WBTC');

    // Original W still rewired to U (USDT-first for non-WBTC).
    expect(await actionOnFail(queryRunner, W_ID)).toBe(USDT_ID);
  });

  it('supports T = NULL (U.onFailId was already null)', async () => {
    await seedBaselineChain(queryRunner, { tId: null, withW: false });
    await insertAsset(queryRunner, 2, 'WBTC');
    await insertRule(queryRunner, { id: 1, deficitStartActionId: BTC_ID, targetAssetId: 2 });

    await new PreferUsdtOverBtc().up(queryRunner);

    expect(await actionOnFail(queryRunner, BTC_ID)).toBeNull();
    expect(await actionOnFail(queryRunner, USDT_ID)).toBe(BTC_ID);

    const b2Id = await ruleStart(queryRunner, 1);
    const b2 = (
      await queryRunner.query(`SELECT "onFailId" FROM "liquidity_management_action" WHERE "id" = $1`, [b2Id])
    ).at(0);
    const u2 = (
      await queryRunner.query(`SELECT "onFailId" FROM "liquidity_management_action" WHERE "id" = $1`, [
        Number(b2.onFailId),
      ])
    ).at(0);
    expect(u2.onFailId).toBeNull();
  });

  it('throws on unexpected B.onFailId and leaves rows unchanged', async () => {
    await insertAction(queryRunner, { id: T_ID, tag: 'T', onFailId: null });
    await insertAction(queryRunner, { id: USDT_ID, tag: 'U', onFailId: T_ID });
    // B does not point at U — unexpected structure
    await insertAction(queryRunner, { id: BTC_ID, tag: 'B', onFailId: T_ID });

    await expect(new PreferUsdtOverBtc().up(queryRunner)).rejects.toThrow(/expected B\.onFailId = U \(13\), found/);

    expect(await actionOnFail(queryRunner, BTC_ID)).toBe(T_ID);
    expect(await actionOnFail(queryRunner, USDT_ID)).toBe(T_ID);
    expect(await auditMessages(queryRunner)).toHaveLength(0);
  });

  it('throws when T is B or U itself and leaves rows unchanged', async () => {
    // U.onFailId = B → cycle
    await insertAction(queryRunner, { id: USDT_ID, tag: 'U', onFailId: BTC_ID });
    await insertAction(queryRunner, { id: BTC_ID, tag: 'B', onFailId: USDT_ID });

    await expect(new PreferUsdtOverBtc().up(queryRunner)).rejects.toThrow(/T \(\d+\) must not be B or U itself/);

    expect(await actionOnFail(queryRunner, BTC_ID)).toBe(USDT_ID);
    expect(await actionOnFail(queryRunner, USDT_ID)).toBe(BTC_ID);
    expect(await auditMessages(queryRunner)).toHaveLength(0);
  });

  it('second up() is a no-op (no second audit, no further edge changes)', async () => {
    await seedBaselineChain(queryRunner, { withW: true });

    const migration = new PreferUsdtOverBtc();
    await migration.up(queryRunner);
    const afterFirst = {
      w: await actionOnFail(queryRunner, W_ID),
      u: await actionOnFail(queryRunner, USDT_ID),
      b: await actionOnFail(queryRunner, BTC_ID),
    };
    const actionsAfterFirst = await queryRunner.query(`SELECT COUNT(*)::int AS c FROM "liquidity_management_action"`);

    await migration.up(queryRunner);

    expect(await actionOnFail(queryRunner, W_ID)).toBe(afterFirst.w);
    expect(await actionOnFail(queryRunner, USDT_ID)).toBe(afterFirst.u);
    expect(await actionOnFail(queryRunner, BTC_ID)).toBe(afterFirst.b);
    expect(await queryRunner.query(`SELECT COUNT(*)::int AS c FROM "liquidity_management_action"`)).toEqual(
      actionsAfterFirst,
    );
    expect(await auditMessages(queryRunner)).toHaveLength(1);
  });

  it('up() then down() restores edges and deletes unreferenced clones', async () => {
    await seedBaselineChain(queryRunner, { withW: true });
    await insertAsset(queryRunner, 2, 'WBTC');
    await insertRule(queryRunner, { id: 1, deficitStartActionId: W_ID, targetAssetId: 2 });
    await insertAsset(queryRunner, 1, 'ETH');
    await insertRule(queryRunner, { id: 2, deficitStartActionId: BTC_ID, targetAssetId: 1 });

    const migration = new PreferUsdtOverBtc();
    await migration.up(queryRunner);

    const cloneCount = (
      await queryRunner.query(`SELECT COUNT(*)::int AS c FROM "liquidity_management_action" WHERE "tag" LIKE '%WBTC'`)
    ).at(0).c;
    expect(cloneCount).toBeGreaterThan(0);

    await migration.down(queryRunner);

    expect(await actionOnFail(queryRunner, W_ID)).toBe(BTC_ID);
    expect(await actionOnFail(queryRunner, BTC_ID)).toBe(USDT_ID);
    expect(await actionOnFail(queryRunner, USDT_ID)).toBe(T_ID);
    expect(await ruleStart(queryRunner, 1)).toBe(W_ID);
    expect(await ruleStart(queryRunner, 2)).toBe(BTC_ID);

    const clonesLeft = (
      await queryRunner.query(`SELECT COUNT(*)::int AS c FROM "liquidity_management_action" WHERE "tag" LIKE '%WBTC'`)
    ).at(0).c;
    expect(clonesLeft).toBe(0);

    const events = (await auditMessages(queryRunner)) as Array<{ action: string }>;
    expect(events.map((e) => e.action)).toEqual(['applyPreferUsdtOverBtc', 'rollbackPreferUsdtOverBtc']);
  });

  it('down() keeps a clone referenced by liquidity_management_order but rewinds rules', async () => {
    await seedBaselineChain(queryRunner, { withW: true });
    await insertAsset(queryRunner, 2, 'WBTC');
    await insertRule(queryRunner, { id: 1, deficitStartActionId: W_ID, targetAssetId: 2 });

    const migration = new PreferUsdtOverBtc();
    await migration.up(queryRunner);

    const w2Id = await ruleStart(queryRunner, 1);
    await queryRunner.query(`INSERT INTO "liquidity_management_order" ("actionId") VALUES ($1)`, [w2Id]);

    await migration.down(queryRunner);

    expect(await ruleStart(queryRunner, 1)).toBe(W_ID);
    const stillThere = await queryRunner.query(`SELECT "id" FROM "liquidity_management_action" WHERE "id" = $1`, [
      w2Id,
    ]);
    expect(stillThere).toHaveLength(1);

    const events = (await auditMessages(queryRunner)) as Array<{
      action: string;
      keptCloneIds?: number[];
      deletedCloneIds?: number[];
    }>;
    const rollback = events.find((e) => e.action === 'rollbackPreferUsdtOverBtc');
    expect(rollback?.keptCloneIds).toContain(w2Id);
  });

  it('down() keeps a clone referenced by pipeline current/previous action ids', async () => {
    await seedBaselineChain(queryRunner, { withW: false });
    await insertAsset(queryRunner, 2, 'WBTC');
    await insertRule(queryRunner, { id: 1, deficitStartActionId: BTC_ID, targetAssetId: 2 });

    const migration = new PreferUsdtOverBtc();
    await migration.up(queryRunner);

    const b2Id = await ruleStart(queryRunner, 1);
    await queryRunner.query(
      `INSERT INTO "liquidity_management_pipeline" ("currentActionId", "previousActionId") VALUES ($1, NULL)`,
      [b2Id],
    );

    await migration.down(queryRunner);

    expect(await ruleStart(queryRunner, 1)).toBe(BTC_ID);
    expect(
      await queryRunner.query(`SELECT "id" FROM "liquidity_management_action" WHERE "id" = $1`, [b2Id]),
    ).toHaveLength(1);
  });

  it('deactivates Active DAI rules and down() does not reactivate them', async () => {
    await seedBaselineChain(queryRunner, { withW: false });
    await insertAsset(queryRunner, 3, 'DAI');
    await insertRule(queryRunner, { id: 10, deficitStartActionId: USDT_ID, targetAssetId: 3, status: 'Active' });
    await insertRule(queryRunner, {
      id: 11,
      deficitStartActionId: USDT_ID,
      targetAssetId: 3,
      status: 'Inactive',
    });

    const migration = new PreferUsdtOverBtc();
    await migration.up(queryRunner);

    expect(await ruleStatus(queryRunner, 10)).toBe('Inactive');
    expect(await ruleStatus(queryRunner, 11)).toBe('Inactive');

    await migration.down(queryRunner);

    // down() deliberately does not reverse status changes (DeactivateTradingRules precedent).
    expect(await ruleStatus(queryRunner, 10)).toBe('Inactive');
    expect(await ruleStatus(queryRunner, 11)).toBe('Inactive');
  });

  it('fails closed when the apply audit insert returns no id', async () => {
    await seedBaselineChain(queryRunner, { withW: false });

    const originalQuery = queryRunner.query.bind(queryRunner);
    const querySpy = jest.spyOn(queryRunner, 'query').mockImplementation((query, parameters) => {
      if (typeof query === 'string' && query.startsWith('INSERT INTO "log"')) {
        return Promise.resolve([]);
      }
      return originalQuery(query, parameters);
    });

    try {
      await expect(new PreferUsdtOverBtc().up(queryRunner)).rejects.toThrow(/Failed to write audit event/);
    } finally {
      querySpy.mockRestore();
    }

    // Without a surrounding TypeORM migration transaction, clone INSERTs (if any) may remain —
    // pin only that no audit was recorded and the original chain edges are still pre-up.
    expect(await auditMessages(queryRunner)).toHaveLength(0);
    expect(await actionOnFail(queryRunner, BTC_ID)).toBe(USDT_ID);
    expect(await actionOnFail(queryRunner, USDT_ID)).toBe(T_ID);
  });

  it('supports two apply/rollback cycles without deleting audit history', async () => {
    await seedBaselineChain(queryRunner, { withW: true });

    const migration = new PreferUsdtOverBtc();
    await migration.up(queryRunner);
    await migration.down(queryRunner);
    await migration.up(queryRunner);
    await migration.down(queryRunner);

    const events = (await auditMessages(queryRunner)) as Array<{ action: string }>;
    expect(events.map((e) => e.action)).toEqual([
      'applyPreferUsdtOverBtc',
      'rollbackPreferUsdtOverBtc',
      'applyPreferUsdtOverBtc',
      'rollbackPreferUsdtOverBtc',
    ]);

    expect(await actionOnFail(queryRunner, W_ID)).toBe(BTC_ID);
    expect(await actionOnFail(queryRunner, BTC_ID)).toBe(USDT_ID);
    expect(await actionOnFail(queryRunner, USDT_ID)).toBe(T_ID);
  });

  it('is a pure no-op on an empty database (no pairs, no DAI) without writing audit', async () => {
    await new PreferUsdtOverBtc().up(queryRunner);

    expect(await auditMessages(queryRunner)).toHaveLength(0);
    expect(await queryRunner.query(`SELECT "id" FROM "liquidity_management_action"`)).toEqual([]);
  });
});

describeDb('PreferUsdtOverBtcForLiquidityTrades migration (real Postgres)', () => {
  let dataSource: DataSource;
  let queryRunner: QueryRunner;

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    PreferUsdtOverBtc = require('../../../../../migration/1786001000000-PreferUsdtOverBtcForLiquidityTrades');
    dataSource = new DataSource({ type: 'postgres', url: PG_URL });
    await dataSource.initialize();
  });

  beforeEach(async () => {
    queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await queryRunner.query(`CREATE SCHEMA "${SCHEMA}"`);
    await queryRunner.query(`SET search_path TO "${SCHEMA}"`);

    await queryRunner.query(`
      CREATE TABLE "asset" (
        "id" SERIAL PRIMARY KEY,
        "name" text NOT NULL
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "liquidity_management_action" (
        "id" SERIAL PRIMARY KEY,
        "system" text NOT NULL,
        "command" text NOT NULL,
        "tag" text,
        "params" text,
        "onSuccessId" integer,
        "onFailId" integer
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "liquidity_management_rule" (
        "id" SERIAL PRIMARY KEY,
        "deficitStartActionId" integer,
        "redundancyStartActionId" integer,
        "targetAssetId" integer,
        "status" text NOT NULL DEFAULT 'Active'
      )
    `);
    // Real FK ON DELETE NO ACTION — mirrors InitialSchema constraints on actionId references.
    await queryRunner.query(`
      CREATE TABLE "liquidity_management_order" (
        "id" SERIAL PRIMARY KEY,
        "actionId" integer REFERENCES "liquidity_management_action"("id") ON DELETE NO ACTION
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "liquidity_management_pipeline" (
        "id" SERIAL PRIMARY KEY,
        "currentActionId" integer REFERENCES "liquidity_management_action"("id") ON DELETE NO ACTION,
        "previousActionId" integer REFERENCES "liquidity_management_action"("id") ON DELETE NO ACTION
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "log" (
        "id" SERIAL PRIMARY KEY,
        "created" TIMESTAMP NOT NULL DEFAULT now(),
        "updated" TIMESTAMP NOT NULL DEFAULT now(),
        "system" text NOT NULL,
        "subsystem" text NOT NULL,
        "severity" text NOT NULL,
        "message" text NOT NULL
      )
    `);
  });

  afterEach(async () => {
    if (queryRunner.isTransactionActive) await queryRunner.rollbackTransaction();
    await queryRunner.query(`SET search_path TO public`);
    await queryRunner.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await queryRunner.release();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it('NULL-safe non-WBTC filter rewires NULL-target rules; WBTC rules are cloned separately', async () => {
    await seedBaselineChain(queryRunner, { withW: false });
    await insertAsset(queryRunner, 2, 'WBTC');
    await insertRule(queryRunner, { id: 1, deficitStartActionId: BTC_ID, targetAssetId: null });
    await insertRule(queryRunner, { id: 2, deficitStartActionId: BTC_ID, targetAssetId: 2 });

    await new PreferUsdtOverBtc().up(queryRunner);

    expect(await ruleStart(queryRunner, 1)).toBe(USDT_ID);
    const wbtcStart = await ruleStart(queryRunner, 2);
    expect(wbtcStart).not.toBe(BTC_ID);
    expect(wbtcStart).not.toBe(USDT_ID);
  });

  it('down() does not DELETE a clone that is FK-referenced by order.actionId', async () => {
    await seedBaselineChain(queryRunner, { withW: true });
    await insertAsset(queryRunner, 2, 'WBTC');
    await insertRule(queryRunner, { id: 1, deficitStartActionId: W_ID, targetAssetId: 2 });

    const migration = new PreferUsdtOverBtc();
    await migration.up(queryRunner);

    const w2Id = await ruleStart(queryRunner, 1);
    await queryRunner.query(`INSERT INTO "liquidity_management_order" ("actionId") VALUES ($1)`, [w2Id]);

    // Would throw under ON DELETE NO ACTION if down() tried a blind DELETE.
    await expect(migration.down(queryRunner)).resolves.toBeUndefined();

    expect(await ruleStart(queryRunner, 1)).toBe(W_ID);
    expect(
      await queryRunner.query(`SELECT "id" FROM "liquidity_management_action" WHERE "id" = $1`, [w2Id]),
    ).toHaveLength(1);
  });

  it('down() does not DELETE a clone referenced by pipeline.previousActionId', async () => {
    await seedBaselineChain(queryRunner, { withW: false });
    await insertAsset(queryRunner, 2, 'WBTC');
    await insertRule(queryRunner, { id: 1, deficitStartActionId: BTC_ID, targetAssetId: 2 });

    const migration = new PreferUsdtOverBtc();
    await migration.up(queryRunner);

    const b2Id = await ruleStart(queryRunner, 1);
    await queryRunner.query(
      `INSERT INTO "liquidity_management_pipeline" ("currentActionId", "previousActionId") VALUES (NULL, $1)`,
      [b2Id],
    );

    await expect(migration.down(queryRunner)).resolves.toBeUndefined();
    expect(
      await queryRunner.query(`SELECT "id" FROM "liquidity_management_action" WHERE "id" = $1`, [b2Id]),
    ).toHaveLength(1);
  });

  it('up() then down() restores a full chain on real Postgres', async () => {
    await seedBaselineChain(queryRunner, { withW: true });
    await insertAsset(queryRunner, 1, 'ETH');
    await insertRule(queryRunner, { id: 1, deficitStartActionId: BTC_ID, targetAssetId: 1 });

    const migration = new PreferUsdtOverBtc();
    await migration.up(queryRunner);
    await migration.down(queryRunner);

    expect(await actionOnFail(queryRunner, W_ID)).toBe(BTC_ID);
    expect(await actionOnFail(queryRunner, BTC_ID)).toBe(USDT_ID);
    expect(await actionOnFail(queryRunner, USDT_ID)).toBe(T_ID);
    expect(await ruleStart(queryRunner, 1)).toBe(BTC_ID);
  });
});
