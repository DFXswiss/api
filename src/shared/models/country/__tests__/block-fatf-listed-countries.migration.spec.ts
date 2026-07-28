import { DataSource, QueryRunner } from 'typeorm';

// Real Postgres required: the migration uses a PL/pgSQL DO block that pg-mem cannot execute.
// CI provides MIGRATION_TEST_PG via the postgres:16 service in api-pr.yaml.
const PG_URL = process.env.MIGRATION_TEST_PG;
const describeDb = PG_URL ? describe : describe.skip;

const SCHEMA = 'country_policy_migration_spec';
const TARGET_SYMBOLS = ['BA', 'CD', 'IQ', 'KW', 'PG'] as const;
const FIXED_UPDATED = '2024-01-01T00:00:00.000Z';

let BlockFatfListedCountries: new () => {
  up(qr: QueryRunner): Promise<void>;
  down(qr: QueryRunner): Promise<void>;
};

type CountryFlags = {
  symbol: string;
  fatfEnable: boolean;
  dfxEnable: boolean;
  nationalityStepEnable: boolean;
  bankEnable: boolean;
  checkoutEnable: boolean;
  cryptoEnable: boolean;
  ipEnable: boolean;
  updated: Date;
};

describeDb('BlockFatfListedCountries20260619 migration (real Postgres)', () => {
  let dataSource: DataSource;
  let qr: QueryRunner;

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    BlockFatfListedCountries = require('../../../../../migration/1785229100000-BlockFatfListedCountries20260619');
    dataSource = new DataSource({ type: 'postgres', url: PG_URL });
    await dataSource.initialize();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    qr = dataSource.createQueryRunner();
    await qr.connect();

    // Schema isolation: several real-PG migration specs share one MIGRATION_TEST_PG database and
    // may run in parallel workers. Unqualified table names resolve via search_path into this schema.
    await qr.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
    await qr.query(`SET search_path TO ${SCHEMA}`);

    await qr.query(`DROP TABLE IF EXISTS "log" CASCADE`);
    await qr.query(`DROP TABLE IF EXISTS "country" CASCADE`);

    // Column definitions taken literally from migration/1779121160124-InitialSchema.js
    await qr.query(
      `CREATE TABLE "country" ("id" SERIAL NOT NULL, "updated" TIMESTAMP NOT NULL DEFAULT now(), "created" TIMESTAMP NOT NULL DEFAULT now(), "symbol" character varying(10) NOT NULL, "symbol3" character varying(10) NOT NULL, "name" character varying(256) NOT NULL, "foreignName" character varying(256), "dfxEnable" boolean NOT NULL DEFAULT true, "dfxOrganizationEnable" boolean NOT NULL DEFAULT false, "lockEnable" boolean NOT NULL DEFAULT true, "ipEnable" boolean NOT NULL DEFAULT true, "yapealEnable" boolean NOT NULL DEFAULT false, "fatfEnable" boolean NOT NULL DEFAULT true, "nationalityEnable" boolean NOT NULL DEFAULT true, "nationalityStepEnable" boolean NOT NULL DEFAULT true, "bankTransactionVerificationEnable" boolean NOT NULL DEFAULT false, "bankEnable" boolean NOT NULL DEFAULT true, "cryptoEnable" boolean NOT NULL DEFAULT true, "checkoutEnable" boolean NOT NULL DEFAULT true, "amlRule" integer NOT NULL DEFAULT '0', "manualReviewRequired" boolean NOT NULL DEFAULT false, "manualReviewRequiredOrganization" boolean NOT NULL DEFAULT false, "enabledKycDocuments" text, CONSTRAINT "UQ_country_symbol_spec" UNIQUE ("symbol"), CONSTRAINT "UQ_country_symbol3_spec" UNIQUE ("symbol3"), CONSTRAINT "PK_country_spec" PRIMARY KEY ("id"))`,
    );
    await qr.query(
      `CREATE TABLE "log" ("id" SERIAL NOT NULL, "updated" TIMESTAMP NOT NULL DEFAULT now(), "created" TIMESTAMP NOT NULL DEFAULT now(), "system" character varying(256) NOT NULL, "subsystem" character varying(256) NOT NULL, "severity" character varying(256) NOT NULL, "message" text NOT NULL, "category" character varying(256), "valid" boolean, CONSTRAINT "PK_log_spec" PRIMARY KEY ("id"))`,
    );
  });

  afterEach(async () => {
    if (qr?.isTransactionActive) await qr.rollbackTransaction();
    await qr.release();
  });

  const runUp = (): Promise<void> => new BlockFatfListedCountries().up(qr);
  const runDown = (): Promise<void> => new BlockFatfListedCountries().down(qr);

  const insertCountry = async (opts: {
    symbol: string;
    name?: string;
    fatfEnable?: boolean;
    dfxEnable?: boolean;
    nationalityStepEnable?: boolean;
    bankEnable?: boolean;
    checkoutEnable?: boolean;
    cryptoEnable?: boolean;
    ipEnable?: boolean;
    updated?: string;
  }): Promise<void> => {
    await qr.query(
      `INSERT INTO "country" (
        "symbol", "symbol3", "name",
        "fatfEnable", "dfxEnable", "nationalityStepEnable",
        "bankEnable", "checkoutEnable", "cryptoEnable", "ipEnable",
        "updated", "created"
      ) VALUES (
        $1, $2, $3,
        $4, $5, $6,
        $7, $8, $9, $10,
        $11::timestamp, $11::timestamp
      )`,
      [
        opts.symbol,
        `${opts.symbol}3`,
        opts.name ?? opts.symbol,
        opts.fatfEnable ?? true,
        opts.dfxEnable ?? true,
        opts.nationalityStepEnable ?? true,
        opts.bankEnable ?? true,
        opts.checkoutEnable ?? true,
        opts.cryptoEnable ?? true,
        opts.ipEnable ?? true,
        opts.updated ?? FIXED_UPDATED,
      ],
    );
  };

  /** Production-like before state for the five target countries (measured 2026-07-27). */
  const seedTargetsFromProduction = async (): Promise<void> => {
    await insertCountry({ symbol: 'CD', fatfEnable: true, dfxEnable: false, nationalityStepEnable: true });
    await insertCountry({ symbol: 'KW', fatfEnable: true, dfxEnable: false, nationalityStepEnable: true });
    await insertCountry({ symbol: 'PG', fatfEnable: true, dfxEnable: false, nationalityStepEnable: true });
    await insertCountry({ symbol: 'BA', fatfEnable: true, dfxEnable: true, nationalityStepEnable: true });
    await insertCountry({ symbol: 'IQ', fatfEnable: true, dfxEnable: false, nationalityStepEnable: true });
  };

  const seedBystanders = async (): Promise<void> => {
    await insertCountry({
      symbol: 'PA',
      fatfEnable: true,
      dfxEnable: true,
      nationalityStepEnable: true,
      bankEnable: true,
      checkoutEnable: true,
      cryptoEnable: true,
      ipEnable: true,
    });
    await insertCountry({
      symbol: 'CH',
      fatfEnable: true,
      dfxEnable: true,
      nationalityStepEnable: true,
    });
    // CG is an intentional over-block in production; this migration must not touch it.
    await insertCountry({
      symbol: 'CG',
      fatfEnable: false,
      dfxEnable: false,
      nationalityStepEnable: false,
    });
  };

  const getCountry = async (symbol: string): Promise<CountryFlags> => {
    const rows = await qr.query(
      `SELECT "symbol", "fatfEnable", "dfxEnable", "nationalityStepEnable",
              "bankEnable", "checkoutEnable", "cryptoEnable", "ipEnable", "updated"
       FROM "country" WHERE "symbol" = $1`,
      [symbol],
    );
    expect(rows.length).toBe(1);
    return rows.at(0) as CountryFlags;
  };

  const auditLogs = async (): Promise<{ symbol: string; message: Record<string, unknown> }[]> => {
    const rows = await qr.query(
      `SELECT "message" FROM "log"
       WHERE "system" = 'Compliance'
         AND "subsystem" = 'CountryPolicy'
         AND "category" = 'FatfSnapshot20260619'
       ORDER BY "id"`,
    );
    return rows.map((r: { message: string }) => {
      const message = JSON.parse(r.message) as Record<string, unknown>;
      return { symbol: message.symbol as string, message };
    });
  };

  const logCount = async (): Promise<number> => {
    const rows = await qr.query(
      `SELECT count(*)::int AS count FROM "log"
       WHERE "system" = 'Compliance'
         AND "subsystem" = 'CountryPolicy'
         AND "category" = 'FatfSnapshot20260619'`,
    );
    return Number(rows.at(0).count);
  };

  it('blocks all five target countries and touches updated', async () => {
    await seedTargetsFromProduction();
    await seedBystanders();

    await runUp();

    for (const symbol of TARGET_SYMBOLS) {
      const row = await getCountry(symbol);
      expect(row).toMatchObject({
        fatfEnable: false,
        dfxEnable: false,
        nationalityStepEnable: false,
      });
      expect(new Date(row.updated).getTime()).toBeGreaterThan(new Date(FIXED_UPDATED).getTime());
    }
  });

  it('flips dfxEnable only for BA among the five targets', async () => {
    await seedTargetsFromProduction();

    await runUp();

    expect((await getCountry('BA')).dfxEnable).toBe(false);
    // The other four already had dfxEnable=false; still false, and audit previous proves the before-state.
    const logs = await auditLogs();
    const bySymbol = Object.fromEntries(logs.map((l) => [l.symbol, l.message]));
    expect((bySymbol.BA.previous as { dfxEnable: boolean }).dfxEnable).toBe(true);
    expect((bySymbol.CD.previous as { dfxEnable: boolean }).dfxEnable).toBe(false);
    expect((bySymbol.KW.previous as { dfxEnable: boolean }).dfxEnable).toBe(false);
    expect((bySymbol.PG.previous as { dfxEnable: boolean }).dfxEnable).toBe(false);
    expect((bySymbol.IQ.previous as { dfxEnable: boolean }).dfxEnable).toBe(false);
  });

  it('writes exactly one audit log per changed country with previous/next and metadata', async () => {
    await seedTargetsFromProduction();

    await runUp();

    const logs = await auditLogs();
    expect(logs).toHaveLength(5);

    for (const { symbol, message } of logs) {
      expect(message.action).toBe('fatfPolicySnapshot');
      expect(message.migration).toBe('BlockFatfListedCountries202606191785229100000');
      expect(message.effectiveDate).toBe('2026-06-19');
      expect(message.source).toBe('https://www.fatf-gafi.org/en/countries/black-and-grey-lists.html');
      expect(message.next).toEqual({
        fatfEnable: false,
        dfxEnable: false,
        nationalityStepEnable: false,
      });
      expect(typeof message.countryId).toBe('number');
      expect(message.symbol).toBe(symbol);
    }

    const ba = logs.find((l) => l.symbol === 'BA')!.message;
    expect(ba.previous).toEqual({
      fatfEnable: true,
      dfxEnable: true,
      nationalityStepEnable: true,
    });
    expect(ba.changedFields).toEqual(expect.arrayContaining(['fatfEnable', 'dfxEnable', 'nationalityStepEnable']));
    expect((ba.changedFields as string[]).length).toBe(3);

    const cd = logs.find((l) => l.symbol === 'CD')!.message;
    expect(cd.previous).toEqual({
      fatfEnable: true,
      dfxEnable: false,
      nationalityStepEnable: true,
    });
    expect(cd.changedFields).toEqual(expect.arrayContaining(['fatfEnable', 'nationalityStepEnable']));
    expect(cd.changedFields).not.toContain('dfxEnable');
  });

  it('is idempotent: second up() changes nothing and writes no extra log rows', async () => {
    await seedTargetsFromProduction();
    await runUp();

    const afterFirst = await Promise.all(TARGET_SYMBOLS.map((s) => getCountry(s)));
    const logsAfterFirst = await logCount();
    expect(logsAfterFirst).toBe(5);

    await runUp();

    const afterSecond = await Promise.all(TARGET_SYMBOLS.map((s) => getCountry(s)));
    expect(await logCount()).toBe(5);

    for (let i = 0; i < TARGET_SYMBOLS.length; i++) {
      expect(afterSecond[i].updated).toEqual(afterFirst[i].updated);
      expect(afterSecond[i]).toMatchObject({
        fatfEnable: false,
        dfxEnable: false,
        nationalityStepEnable: false,
      });
    }
  });

  it('skips an already fully blocked target without writing an audit row for it', async () => {
    await insertCountry({
      symbol: 'CD',
      fatfEnable: false,
      dfxEnable: false,
      nationalityStepEnable: false,
    });
    await insertCountry({ symbol: 'KW', fatfEnable: true, dfxEnable: false, nationalityStepEnable: true });
    await insertCountry({ symbol: 'PG', fatfEnable: true, dfxEnable: false, nationalityStepEnable: true });
    await insertCountry({ symbol: 'BA', fatfEnable: true, dfxEnable: true, nationalityStepEnable: true });
    await insertCountry({ symbol: 'IQ', fatfEnable: true, dfxEnable: false, nationalityStepEnable: true });

    const cdBefore = await getCountry('CD');

    await runUp();

    const logs = await auditLogs();
    expect(logs.map((l) => l.symbol).sort()).toEqual(['BA', 'IQ', 'KW', 'PG']);
    expect(logs.find((l) => l.symbol === 'CD')).toBeUndefined();

    const cdAfter = await getCountry('CD');
    expect(cdAfter.updated).toEqual(cdBefore.updated);
  });

  it('throws when a target row is missing and leaves other rows unchanged (transactional)', async () => {
    // All targets except CD — identity check must fail closed.
    await insertCountry({ symbol: 'KW', fatfEnable: true, dfxEnable: false, nationalityStepEnable: true });
    await insertCountry({ symbol: 'PG', fatfEnable: true, dfxEnable: false, nationalityStepEnable: true });
    await insertCountry({ symbol: 'BA', fatfEnable: true, dfxEnable: true, nationalityStepEnable: true });
    await insertCountry({ symbol: 'IQ', fatfEnable: true, dfxEnable: false, nationalityStepEnable: true });
    await insertCountry({ symbol: 'CH', fatfEnable: true, dfxEnable: true, nationalityStepEnable: true });

    const baBefore = await getCountry('BA');
    const chBefore = await getCountry('CH');

    await qr.startTransaction();
    await expect(runUp()).rejects.toThrow(/identity check failed for symbol CD/);
    await qr.rollbackTransaction();

    const baAfter = await getCountry('BA');
    const chAfter = await getCountry('CH');
    expect(baAfter).toEqual(baBefore);
    expect(chAfter).toEqual(chBefore);
    expect(await logCount()).toBe(0);
  });

  it('is a clean no-op on an empty country table (fresh local setup before seed)', async () => {
    await expect(runUp()).resolves.toBeUndefined();
    expect(await logCount()).toBe(0);
  });

  it('does not touch PA, CH, or CG (flags and updated byte-stable)', async () => {
    await seedTargetsFromProduction();
    await seedBystanders();

    const paBefore = await getCountry('PA');
    const chBefore = await getCountry('CH');
    const cgBefore = await getCountry('CG');

    await runUp();

    expect(await getCountry('PA')).toEqual(paBefore);
    expect(await getCountry('CH')).toEqual(chBefore);
    expect(await getCountry('CG')).toEqual(cgBefore);
  });

  it('leaves unrelated columns on target countries unchanged', async () => {
    await insertCountry({
      symbol: 'CD',
      fatfEnable: true,
      dfxEnable: false,
      nationalityStepEnable: true,
      bankEnable: true,
      checkoutEnable: false,
      cryptoEnable: true,
      ipEnable: true,
    });
    await insertCountry({
      symbol: 'KW',
      fatfEnable: true,
      dfxEnable: false,
      nationalityStepEnable: true,
      bankEnable: false,
      checkoutEnable: true,
      cryptoEnable: false,
      ipEnable: true,
    });
    await insertCountry({
      symbol: 'PG',
      fatfEnable: true,
      dfxEnable: false,
      nationalityStepEnable: true,
      bankEnable: true,
      checkoutEnable: true,
      cryptoEnable: true,
      ipEnable: false,
    });
    await insertCountry({
      symbol: 'BA',
      fatfEnable: true,
      dfxEnable: true,
      nationalityStepEnable: true,
      bankEnable: true,
      checkoutEnable: true,
      cryptoEnable: true,
      ipEnable: true,
    });
    await insertCountry({
      symbol: 'IQ',
      fatfEnable: true,
      dfxEnable: false,
      nationalityStepEnable: true,
      bankEnable: true,
      checkoutEnable: true,
      cryptoEnable: true,
      ipEnable: true,
    });

    await runUp();

    expect(await getCountry('CD')).toMatchObject({
      checkoutEnable: false,
      bankEnable: true,
      cryptoEnable: true,
      ipEnable: true,
    });
    expect(await getCountry('KW')).toMatchObject({
      checkoutEnable: true,
      bankEnable: false,
      cryptoEnable: false,
      ipEnable: true,
    });
    expect(await getCountry('PG')).toMatchObject({
      checkoutEnable: true,
      bankEnable: true,
      cryptoEnable: true,
      ipEnable: false,
    });
  });

  it('down() is a no-op: flags stay false and no query is issued', async () => {
    await seedTargetsFromProduction();
    await runUp();

    const querySpy = jest.spyOn(qr, 'query');
    await runDown();
    expect(querySpy).not.toHaveBeenCalled();
    querySpy.mockRestore();

    for (const symbol of TARGET_SYMBOLS) {
      expect(await getCountry(symbol)).toMatchObject({
        fatfEnable: false,
        dfxEnable: false,
        nationalityStepEnable: false,
      });
    }
  });
});
