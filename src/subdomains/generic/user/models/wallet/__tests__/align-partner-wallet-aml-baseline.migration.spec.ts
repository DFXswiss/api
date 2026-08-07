import { DataSource, QueryRunner } from 'typeorm';

const PG_URL = process.env.MIGRATION_TEST_PG;
const describeDb = PG_URL ? describe : describe.skip;
const SCHEMA = 'align_partner_wallet_aml_baseline_spec';
const TARGET_AML_RULES = '3;7';
const BASELINE_WALLET_NAMES = [
  'NBZ',
  'Multisig',
  'Coinsnap',
  'Arkade',
  'Faceless',
  'Youtrust',
  'Edge',
  'Eternl',
  'Denario',
];
const BASELINE_WALLET_IDS = [24, 25];
const REQUIRED_CURRENT_AML_RULES = '14';
const EXCEPT_CLEAR_WALLET_NAME = 'onchainlabs';
const UNRELATED_DFX_NAME = 'DFX Bitcoin';
const UNRELATED_DFX_RULES = '3;7;11;16';
const UNRELATED_CAKE_NAME = 'CakeWallet';
const UNRELATED_CAKE_RULES = '3';
const SUBSYSTEM = 'AlignPartnerWalletAmlBaseline1786127154000';

let AlignPartnerWalletAmlBaseline: new () => {
  up(queryRunner: QueryRunner): Promise<void>;
  down(): Promise<void>;
};

function setEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function okPostconditionState(
  overrides: Partial<{
    nameDriftCount: number;
    exceptDriftCount: number;
    namePresentCount: number;
    idAtTargetCount: number;
    idDriftCount: number;
    exceptWalletPresentCount: number;
  }> = {},
) {
  return {
    nameDriftCount: 0,
    exceptDriftCount: 0,
    namePresentCount: BASELINE_WALLET_NAMES.length,
    idAtTargetCount: BASELINE_WALLET_IDS.length,
    idDriftCount: 0,
    exceptWalletPresentCount: 1,
    ...overrides,
  };
}

describe('AlignPartnerWalletAmlBaseline migration (SQL content)', () => {
  const originalEnvironment = process.env.ENVIRONMENT;

  beforeAll(() => {
    // The migration is intentionally a plain CommonJS module, matching TypeORM's runtime loader.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    AlignPartnerWalletAmlBaseline = require('../../../../../../../migration/1786127154000-AlignPartnerWalletAmlBaseline');
  });

  afterEach(() => setEnv('ENVIRONMENT', originalEnvironment));

  it('audits before it updates, fail-closes each update to its audit, and locks the rows', async () => {
    const queryRunner = {
      query: jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([okPostconditionState()]),
    };

    await new AlignPartnerWalletAmlBaseline().up(queryRunner as unknown as QueryRunner);

    expect(queryRunner.query).toHaveBeenCalledTimes(3);

    const [baselineSql, baselineParams] = queryRunner.query.mock.calls[0];
    expect(baselineParams).toEqual([
      TARGET_AML_RULES,
      BASELINE_WALLET_NAMES,
      BASELINE_WALLET_IDS,
      REQUIRED_CURRENT_AML_RULES,
    ]);
    expect(baselineSql).toContain('INSERT INTO "log"');
    expect(baselineSql).toContain(`'${SUBSYSTEM}'`);
    expect(baselineSql).toContain("'previousAmlRules'");
    expect(baselineSql).toContain("'nextAmlRules'");
    expect(baselineSql).toContain("'previousExceptAmlRules'");
    expect(baselineSql).toContain("'nextExceptAmlRules'");
    expect(baselineSql).toContain('FOR UPDATE');
    expect(baselineSql).toContain('EXISTS (SELECT 1 FROM "audit")');
    expect(baselineSql).toContain('HAVING count(*) > 0');
    // The idempotence guard: without IS DISTINCT FROM every deploy would append another audit row.
    expect(baselineSql).toContain('"amlRules" IS DISTINCT FROM $1::varchar');
    // exceptAmlRules is the column that can neutralise the rules written here, so it is pinned too.
    expect(baselineSql).toContain('"exceptAmlRules" = NULL');
    expect(baselineSql).toContain('= ANY($2::varchar[])');
    expect(baselineSql).toContain('= ANY($3::int[])');
    // Neither input may reach the statement as a string literal — the assertion is on the quoted
    // form because the subsystem name legitimately contains no wallet name, but rule strings and
    // names must not appear as SQL literals either.
    expect(baselineSql).not.toContain(`'${TARGET_AML_RULES}'`);
    expect(baselineSql).not.toContain(`'${REQUIRED_CURRENT_AML_RULES}'`);
    for (const name of BASELINE_WALLET_NAMES) {
      expect(baselineSql).not.toContain(`'${name}'`);
    }
    expect(baselineSql).not.toContain('24');
    expect(baselineSql).not.toContain('25');

    const [exceptSql, exceptParams] = queryRunner.query.mock.calls[1];
    expect(exceptParams).toEqual([EXCEPT_CLEAR_WALLET_NAME]);
    expect(exceptSql).toContain('INSERT INTO "log"');
    expect(exceptSql).toContain(`'${SUBSYSTEM}'`);
    expect(exceptSql).toContain("'previousExceptAmlRules'");
    expect(exceptSql).toContain("'nextExceptAmlRules'");
    expect(exceptSql).toContain('FOR UPDATE');
    expect(exceptSql).toContain('EXISTS (SELECT 1 FROM "audit")');
    expect(exceptSql).toContain('HAVING count(*) > 0');
    // This leg does not touch amlRules — no SET and no audit keys for it.
    expect(exceptSql).not.toContain("'previousAmlRules'");
    expect(exceptSql).not.toContain("'nextAmlRules'");
    expect(exceptSql).not.toContain('"amlRules" =');
    expect(exceptSql).not.toContain(`'${EXCEPT_CLEAR_WALLET_NAME}'`);

    const [postSql, postParams] = queryRunner.query.mock.calls[2];
    expect(postParams).toEqual([
      TARGET_AML_RULES,
      BASELINE_WALLET_NAMES,
      EXCEPT_CLEAR_WALLET_NAME,
      BASELINE_WALLET_IDS,
      REQUIRED_CURRENT_AML_RULES,
    ]);
    expect(postSql).not.toContain(`'${TARGET_AML_RULES}'`);
    expect(postSql).not.toContain(`'${EXCEPT_CLEAR_WALLET_NAME}'`);
    for (const name of BASELINE_WALLET_NAMES) {
      expect(postSql).not.toContain(`'${name}'`);
    }
    expect(postSql).not.toContain('24');
    expect(postSql).not.toContain('25');
  });

  it('rejects when any named partner wallet is left off the target configuration', async () => {
    const queryRunner = {
      query: jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([okPostconditionState({ nameDriftCount: 1 })]),
    };

    await expect(new AlignPartnerWalletAmlBaseline().up(queryRunner as unknown as QueryRunner)).rejects.toThrow(
      `1 named partner wallet(s) did not reach amlRules '${TARGET_AML_RULES}'`,
    );
  });

  it('rejects when onchainlabs still has a non-empty exceptAmlRules', async () => {
    const queryRunner = {
      query: jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([okPostconditionState({ exceptDriftCount: 1 })]),
    };

    await expect(new AlignPartnerWalletAmlBaseline().up(queryRunner as unknown as QueryRunner)).rejects.toThrow(
      `1 '${EXCEPT_CLEAR_WALLET_NAME}' wallet(s) still have a non-empty exceptAmlRules`,
    );
  });

  it('rejects on dev when an id-matched wallet still carries the RULE_14 pre-state', async () => {
    setEnv('ENVIRONMENT', 'dev');
    const queryRunner = {
      query: jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([okPostconditionState({ idDriftCount: 1 })]),
    };

    await expect(new AlignPartnerWalletAmlBaseline().up(queryRunner as unknown as QueryRunner)).rejects.toThrow(
      'still carry the RULE_14 pre-state',
    );
  });

  it('keeps baseline names and the except-clear name disjoint in the migration module', async () => {
    const queryRunner = {
      query: jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([okPostconditionState()]),
    };

    await new AlignPartnerWalletAmlBaseline().up(queryRunner as unknown as QueryRunner);

    const baselineNames = queryRunner.query.mock.calls[0][1][1] as string[];
    const exceptClearName = queryRunner.query.mock.calls[1][1][0] as string;
    expect(baselineNames).not.toContain(exceptClearName);
  });

  it.each([['dev'], ['loc'], ['staging'], [undefined]])(
    'accepts missing partner wallets when ENVIRONMENT is %s',
    async (environment) => {
      setEnv('ENVIRONMENT', environment);
      const queryRunner = {
        query: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([
            okPostconditionState({
              namePresentCount: 0,
              idAtTargetCount: 0,
              exceptWalletPresentCount: 0,
            }),
          ]),
      };

      await expect(
        new AlignPartnerWalletAmlBaseline().up(queryRunner as unknown as QueryRunner),
      ).resolves.toBeUndefined();
    },
  );

  // A rename would make the name match nothing: the update touches no row, the postcondition on
  // drift is trivially satisfied, and the migration would record itself as executed while the
  // lenient configuration stays live. On PRD that silent no-op is the failure mode worth failing on.
  it('rejects on PRD when a named partner wallet is missing', async () => {
    process.env.ENVIRONMENT = 'prd';
    const queryRunner = {
      query: jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([okPostconditionState({ namePresentCount: BASELINE_WALLET_NAMES.length - 1 })]),
    };

    await expect(new AlignPartnerWalletAmlBaseline().up(queryRunner as unknown as QueryRunner)).rejects.toThrow(
      `expected ${BASELINE_WALLET_NAMES.length} named partner wallets on PRD`,
    );
  });

  it('rejects on PRD when an id-matched wallet is missing or off target', async () => {
    process.env.ENVIRONMENT = 'prd';
    const queryRunner = {
      query: jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([okPostconditionState({ idAtTargetCount: 1 })]),
    };

    await expect(new AlignPartnerWalletAmlBaseline().up(queryRunner as unknown as QueryRunner)).rejects.toThrow(
      `expected ${BASELINE_WALLET_IDS.length} id-matched partner wallet(s) at amlRules '${TARGET_AML_RULES}'`,
    );
  });

  it('rejects on PRD when onchainlabs is missing', async () => {
    process.env.ENVIRONMENT = 'prd';
    const queryRunner = {
      query: jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([okPostconditionState({ exceptWalletPresentCount: 0 })]),
    };

    await expect(new AlignPartnerWalletAmlBaseline().up(queryRunner as unknown as QueryRunner)).rejects.toThrow(
      `no wallet named '${EXCEPT_CLEAR_WALLET_NAME}' found on PRD`,
    );
  });

  it('down() deliberately performs no rollback', async () => {
    const migration = new AlignPartnerWalletAmlBaseline();

    expect(migration.down).toHaveLength(0);
    await expect(migration.down()).resolves.toBeUndefined();
  });
});

describeDb('AlignPartnerWalletAmlBaseline migration (real Postgres)', () => {
  // These suites call up() on a bare query runner, so assertions see each statement's effect in
  // isolation — including partial states after a postcondition throw. A real migration run wraps
  // up() in one transaction (TypeORM default migrationsTransactionMode is "all"; config.ts sets
  // no override), so a postcondition failure rolls back every change in production. The
  // per-statement view here is deliberate: it exercises each leg's fail-close behaviour alone.
  const originalEnvironment = process.env.ENVIRONMENT;
  let dataSource: DataSource;
  let queryRunner: QueryRunner;

  beforeAll(async () => {
    // The migration is intentionally a plain CommonJS module, matching TypeORM's runtime loader.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    AlignPartnerWalletAmlBaseline = require('../../../../../../../migration/1786127154000-AlignPartnerWalletAmlBaseline');
    dataSource = new DataSource({ type: 'postgres', url: PG_URL });
    await dataSource.initialize();
  });

  beforeEach(async () => {
    process.env.ENVIRONMENT = 'prd';
    queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await queryRunner.query(`CREATE SCHEMA "${SCHEMA}"`);
    await queryRunner.query(`SET search_path TO "${SCHEMA}"`);
    await queryRunner.query(`
      CREATE TABLE "wallet" (
        "id" SERIAL PRIMARY KEY,
        "updated" TIMESTAMP NOT NULL DEFAULT now(),
        "name" varchar(256),
        "amlRules" varchar NOT NULL DEFAULT '0',
        "exceptAmlRules" varchar
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "log" (
        "id" SERIAL PRIMARY KEY,
        "created" TIMESTAMP NOT NULL DEFAULT now(),
        "updated" TIMESTAMP NOT NULL DEFAULT now(),
        "system" varchar(256) NOT NULL,
        "subsystem" varchar(256) NOT NULL,
        "severity" varchar(256) NOT NULL,
        "message" text NOT NULL
      )
    `);
  });

  afterEach(async () => {
    setEnv('ENVIRONMENT', originalEnvironment);
    if (queryRunner.isTransactionActive) await queryRunner.rollbackTransaction();
    await queryRunner.query(`SET search_path TO public`);
    await queryRunner.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await queryRunner.release();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  // Unrelated wallets are inserted in every case on purpose: an unscoped UPDATE would rewrite
  // them (or their `updated`) along the way.
  async function insertUnrelatedWallets(): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "wallet" ("name", "updated", "amlRules", "exceptAmlRules")
       VALUES ($1, TIMESTAMP '2000-01-01', $2, NULL), ($3, TIMESTAMP '2000-01-01', $4, NULL)`,
      [UNRELATED_DFX_NAME, UNRELATED_DFX_RULES, UNRELATED_CAKE_NAME, UNRELATED_CAKE_RULES],
    );
  }

  async function insertBaselineNames(
    amlRules: string | ((name: string) => string) = '0',
    exceptAmlRules: string | null = null,
  ): Promise<void> {
    for (const name of BASELINE_WALLET_NAMES) {
      const rules = typeof amlRules === 'function' ? amlRules(name) : amlRules;
      await queryRunner.query(
        `INSERT INTO "wallet" ("name", "updated", "amlRules", "exceptAmlRules")
         VALUES ($1, TIMESTAMP '2000-01-01', $2, $3)`,
        [name, rules, exceptAmlRules],
      );
    }
  }

  async function insertIdWallets(
    rulesById: Record<number, string | { amlRules: string; exceptAmlRules: string | null }> = {
      24: REQUIRED_CURRENT_AML_RULES,
      25: REQUIRED_CURRENT_AML_RULES,
    },
  ): Promise<void> {
    for (const [id, value] of Object.entries(rulesById)) {
      const { amlRules, exceptAmlRules } =
        typeof value === 'string' ? { amlRules: value, exceptAmlRules: null } : value;
      await queryRunner.query(
        `INSERT INTO "wallet" ("id", "name", "updated", "amlRules", "exceptAmlRules")
         VALUES ($1, $2, TIMESTAMP '2000-01-01', $3, $4)`,
        [Number(id), `id-wallet-${id}`, amlRules, exceptAmlRules],
      );
    }
  }

  async function insertOnchainlabs(amlRules = '3', exceptAmlRules: string | null = '13'): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "wallet" ("name", "updated", "amlRules", "exceptAmlRules")
       VALUES ($1, TIMESTAMP '2000-01-01', $2, $3)`,
      [EXCEPT_CLEAR_WALLET_NAME, amlRules, exceptAmlRules],
    );
  }

  async function seedFullPrdFixture(options?: {
    nameRules?: string | ((name: string) => string);
    nameExcept?: string | null;
    idRules?: Record<number, string>;
    onchainlabsRules?: string;
    onchainlabsExcept?: string | null;
  }): Promise<void> {
    await insertUnrelatedWallets();
    await insertBaselineNames(options?.nameRules ?? '0', options?.nameExcept ?? null);
    await insertIdWallets(
      options?.idRules ?? {
        24: REQUIRED_CURRENT_AML_RULES,
        25: REQUIRED_CURRENT_AML_RULES,
      },
    );
    await insertOnchainlabs(
      options?.onchainlabsRules ?? '3',
      options && 'onchainlabsExcept' in options ? (options.onchainlabsExcept ?? null) : '13',
    );
  }

  async function readWalletByName(
    name: string,
  ): Promise<{ name: string; amlRules: string; exceptAmlRules: string | null; wasUpdated: boolean }> {
    const rows = (await queryRunner.query(
      `SELECT "name", "amlRules", "exceptAmlRules", "updated" > TIMESTAMP '2000-01-01' AS "wasUpdated"
       FROM "wallet" WHERE "name" = $1`,
      [name],
    )) as { name: string; amlRules: string; exceptAmlRules: string | null; wasUpdated: boolean }[];
    return rows[0];
  }

  async function readWalletById(
    id: number,
  ): Promise<{ id: number; amlRules: string; exceptAmlRules: string | null; wasUpdated: boolean }> {
    const rows = (await queryRunner.query(
      `SELECT "id", "amlRules", "exceptAmlRules", "updated" > TIMESTAMP '2000-01-01' AS "wasUpdated"
       FROM "wallet" WHERE "id" = $1`,
      [id],
    )) as { id: number; amlRules: string; exceptAmlRules: string | null; wasUpdated: boolean }[];
    return rows[0];
  }

  async function readUnrelated(): Promise<{ name: string; amlRules: string; exceptAmlRules: string | null }[]> {
    return queryRunner.query(
      `SELECT "name", "amlRules", "exceptAmlRules" FROM "wallet"
       WHERE "name" IN ($1, $2) ORDER BY "name"`,
      [UNRELATED_CAKE_NAME, UNRELATED_DFX_NAME],
    );
  }

  async function readLogs(): Promise<unknown[]> {
    const rows = (await queryRunner.query(
      `SELECT "message" FROM "log" WHERE "system" = 'Migration' ORDER BY "id"`,
    )) as { message: string }[];
    return rows.map((r) => JSON.parse(r.message));
  }

  it('writes the baseline onto a name-matched wallet at 0, bumps the timestamp, and records one before/after audit row', async () => {
    await seedFullPrdFixture({ nameRules: '0' });

    await new AlignPartnerWalletAmlBaseline().up(queryRunner);

    const multisig = await readWalletByName('Multisig');
    expect(multisig).toEqual({
      name: 'Multisig',
      amlRules: TARGET_AML_RULES,
      exceptAmlRules: null,
      wasUpdated: true,
    });

    const logs = await readLogs();
    // Baseline leg produces one audit row covering all affected baseline wallets; except-clear
    // produces a second row for onchainlabs.
    expect(logs).toHaveLength(2);
    const baselineAudit = logs[0] as {
      walletId: number;
      previousAmlRules: string;
      nextAmlRules: string;
      previousExceptAmlRules: string | null;
      nextExceptAmlRules: string | null;
    }[];
    expect(baselineAudit.length).toBe(BASELINE_WALLET_NAMES.length + BASELINE_WALLET_IDS.length);
    expect(baselineAudit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          walletId: expect.any(Number),
          previousAmlRules: '0',
          nextAmlRules: TARGET_AML_RULES,
          previousExceptAmlRules: null,
          nextExceptAmlRules: null,
        }),
      ]),
    );

    expect(await readUnrelated()).toEqual([
      { name: UNRELATED_CAKE_NAME, amlRules: UNRELATED_CAKE_RULES, exceptAmlRules: null },
      { name: UNRELATED_DFX_NAME, amlRules: UNRELATED_DFX_RULES, exceptAmlRules: null },
    ]);
  });

  it('writes the baseline onto an NBZ-shaped wallet carrying the RULE_14 relaxation', async () => {
    await seedFullPrdFixture({
      nameRules: (name) => (name === 'NBZ' ? '3;7;14' : '0'),
    });

    await new AlignPartnerWalletAmlBaseline().up(queryRunner);

    expect(await readWalletByName('NBZ')).toEqual({
      name: 'NBZ',
      amlRules: TARGET_AML_RULES,
      exceptAmlRules: null,
      wasUpdated: true,
    });
  });

  it('updates an id-matched row with the expected pre-state 14', async () => {
    await seedFullPrdFixture();

    await new AlignPartnerWalletAmlBaseline().up(queryRunner);

    expect(await readWalletById(24)).toEqual({
      id: 24,
      amlRules: TARGET_AML_RULES,
      exceptAmlRules: null,
      wasUpdated: true,
    });
    expect(await readWalletById(25)).toEqual({
      id: 25,
      amlRules: TARGET_AML_RULES,
      exceptAmlRules: null,
      wasUpdated: true,
    });
  });

  it('lifts an id-matched wallet carrying RULE_14 plus a neutralising exceptAmlRules', async () => {
    await insertUnrelatedWallets();
    await insertBaselineNames();
    await insertIdWallets({
      24: { amlRules: REQUIRED_CURRENT_AML_RULES, exceptAmlRules: '13' },
      25: REQUIRED_CURRENT_AML_RULES,
    });
    await insertOnchainlabs();

    await new AlignPartnerWalletAmlBaseline().up(queryRunner);

    expect(await readWalletById(24)).toEqual({
      id: 24,
      amlRules: TARGET_AML_RULES,
      exceptAmlRules: null,
      wasUpdated: true,
    });
    expect(await readWalletById(25)).toEqual({
      id: 25,
      amlRules: TARGET_AML_RULES,
      exceptAmlRules: null,
      wasUpdated: true,
    });

    // id 24 matches the baseline leg's id-branch condition
    // ("id" = ANY($3::int[]) AND "amlRules" = $4::varchar), which does not look at exceptAmlRules
    // at all — yet the single UPDATE's SET "exceptAmlRules" = NULL still clears it, because that
    // SET clause applies uniformly to the whole "affected" set regardless of which OR-branch
    // matched a given row; this proves that specific branch-independence against real Postgres
    // (the id branch), matching the existing coverage for the name branch elsewhere in the file.
    const logs = await readLogs();
    const baselineAudit = logs[0] as {
      walletId: number;
      previousAmlRules: string;
      nextAmlRules: string;
      previousExceptAmlRules: string | null;
      nextExceptAmlRules: string | null;
    }[];
    expect(baselineAudit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          walletId: 24,
          previousAmlRules: REQUIRED_CURRENT_AML_RULES,
          nextAmlRules: TARGET_AML_RULES,
          previousExceptAmlRules: '13',
          nextExceptAmlRules: null,
        }),
      ]),
    );
  });

  it('leaves an id-matched row with unexpected pre-state untouched and rejects on PRD', async () => {
    await seedFullPrdFixture({
      idRules: { 24: '14;5', 25: REQUIRED_CURRENT_AML_RULES },
    });

    await expect(new AlignPartnerWalletAmlBaseline().up(queryRunner)).rejects.toThrow(
      `expected ${BASELINE_WALLET_IDS.length} id-matched partner wallet(s) at amlRules '${TARGET_AML_RULES}'`,
    );

    expect(await readWalletById(24)).toEqual({
      id: 24,
      amlRules: '14;5',
      exceptAmlRules: null,
      wasUpdated: false,
    });
    // id 25 matched the guard and was updated before the postcondition failed. Visible here only
    // because this suite runs without the production transaction wrapper; a real migration run
    // would roll that update back when the postcondition fails.
    expect(await readWalletById(25)).toEqual({
      id: 25,
      amlRules: TARGET_AML_RULES,
      exceptAmlRules: null,
      wasUpdated: true,
    });
  });

  it('resolves on dev when an id-matched row has unexpected pre-state', async () => {
    process.env.ENVIRONMENT = 'dev';
    await insertUnrelatedWallets();
    await insertIdWallets({ 24: '14;5' });

    await expect(new AlignPartnerWalletAmlBaseline().up(queryRunner)).resolves.toBeUndefined();

    expect(await readWalletById(24)).toEqual({
      id: 24,
      amlRules: '14;5',
      exceptAmlRules: null,
      wasUpdated: false,
    });
    expect(await readLogs()).toHaveLength(0);
    expect(await readUnrelated()).toEqual([
      { name: UNRELATED_CAKE_NAME, amlRules: UNRELATED_CAKE_RULES, exceptAmlRules: null },
      { name: UNRELATED_DFX_NAME, amlRules: UNRELATED_DFX_RULES, exceptAmlRules: null },
    ]);
  });

  it('clears onchainlabs exceptAmlRules without touching amlRules and audits without amlRules keys', async () => {
    await seedFullPrdFixture({
      nameRules: TARGET_AML_RULES,
      idRules: { 24: TARGET_AML_RULES, 25: TARGET_AML_RULES },
      onchainlabsRules: '3',
      onchainlabsExcept: '13',
    });

    await new AlignPartnerWalletAmlBaseline().up(queryRunner);

    expect(await readWalletByName(EXCEPT_CLEAR_WALLET_NAME)).toEqual({
      name: EXCEPT_CLEAR_WALLET_NAME,
      amlRules: '3',
      exceptAmlRules: null,
      wasUpdated: true,
    });

    const logs = await readLogs();
    expect(logs).toHaveLength(1);
    const exceptAudit = logs[0] as {
      walletId: number;
      previousExceptAmlRules: string;
      nextExceptAmlRules: string | null;
      previousAmlRules?: string;
      nextAmlRules?: string;
    }[];
    expect(exceptAudit).toEqual([
      {
        walletId: expect.any(Number),
        previousExceptAmlRules: '13',
        nextExceptAmlRules: null,
      },
    ]);
    expect(exceptAudit[0]).not.toHaveProperty('previousAmlRules');
    expect(exceptAudit[0]).not.toHaveProperty('nextAmlRules');
  });

  it('is a no-op for wallets already at the target and appends no audit row', async () => {
    await seedFullPrdFixture({
      nameRules: TARGET_AML_RULES,
      idRules: { 24: TARGET_AML_RULES, 25: TARGET_AML_RULES },
      onchainlabsRules: '3',
      onchainlabsExcept: null,
    });

    await new AlignPartnerWalletAmlBaseline().up(queryRunner);

    expect(await readLogs()).toHaveLength(0);
    expect(await readWalletByName('Multisig')).toEqual({
      name: 'Multisig',
      amlRules: TARGET_AML_RULES,
      exceptAmlRules: null,
      wasUpdated: false,
    });
    expect(await readWalletById(24)).toEqual({
      id: 24,
      amlRules: TARGET_AML_RULES,
      exceptAmlRules: null,
      wasUpdated: false,
    });
    expect(await readWalletByName(EXCEPT_CLEAR_WALLET_NAME)).toEqual({
      name: EXCEPT_CLEAR_WALLET_NAME,
      amlRules: '3',
      exceptAmlRules: null,
      wasUpdated: false,
    });
  });

  it('is idempotent and appends no second audit row on a rerun', async () => {
    await seedFullPrdFixture();
    const migration = new AlignPartnerWalletAmlBaseline();

    await migration.up(queryRunner);
    const logsAfterFirst = await readLogs();
    await migration.up(queryRunner);

    expect(await readLogs()).toHaveLength(logsAfterFirst.length);
    expect(await readWalletByName('NBZ')).toEqual({
      name: 'NBZ',
      amlRules: TARGET_AML_RULES,
      exceptAmlRules: null,
      wasUpdated: true,
    });
  });

  it('is a no-op outside PRD when the database has no partner wallets', async () => {
    process.env.ENVIRONMENT = 'dev';
    await insertUnrelatedWallets();

    await expect(new AlignPartnerWalletAmlBaseline().up(queryRunner)).resolves.toBeUndefined();

    expect(await readLogs()).toHaveLength(0);
    expect(await readUnrelated()).toEqual([
      { name: UNRELATED_CAKE_NAME, amlRules: UNRELATED_CAKE_RULES, exceptAmlRules: null },
      { name: UNRELATED_DFX_NAME, amlRules: UNRELATED_DFX_RULES, exceptAmlRules: null },
    ]);
  });

  it('rejects on PRD when one named partner wallet is missing', async () => {
    await insertUnrelatedWallets();
    for (const name of BASELINE_WALLET_NAMES.filter((n) => n !== 'Denario')) {
      await queryRunner.query(
        `INSERT INTO "wallet" ("name", "updated", "amlRules", "exceptAmlRules")
         VALUES ($1, TIMESTAMP '2000-01-01', $2, NULL)`,
        [name, TARGET_AML_RULES],
      );
    }
    await insertIdWallets({ 24: TARGET_AML_RULES, 25: TARGET_AML_RULES });
    await insertOnchainlabs('3', null);

    await expect(new AlignPartnerWalletAmlBaseline().up(queryRunner)).rejects.toThrow(
      `expected ${BASELINE_WALLET_NAMES.length} named partner wallets on PRD`,
    );
  });

  it('rejects on PRD when id 25 is missing', async () => {
    await insertUnrelatedWallets();
    await insertBaselineNames(TARGET_AML_RULES);
    await insertIdWallets({ 24: TARGET_AML_RULES });
    await insertOnchainlabs('3', null);

    await expect(new AlignPartnerWalletAmlBaseline().up(queryRunner)).rejects.toThrow(
      `expected ${BASELINE_WALLET_IDS.length} id-matched partner wallet(s) at amlRules '${TARGET_AML_RULES}'`,
    );
  });

  it('changes nothing when a trigger suppresses the audit insert', async () => {
    await seedFullPrdFixture({ nameRules: '0' });
    await queryRunner.query(`
      CREATE FUNCTION suppress_log_insert() RETURNS trigger AS $fn$
      BEGIN
        RETURN NULL;
      END;
      $fn$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER suppress_log_insert_trigger
      BEFORE INSERT ON "log"
      FOR EACH ROW
      EXECUTE FUNCTION suppress_log_insert()
    `);

    await expect(new AlignPartnerWalletAmlBaseline().up(queryRunner)).rejects.toThrow(
      `did not reach amlRules '${TARGET_AML_RULES}'`,
    );

    expect(await readWalletByName('Multisig')).toEqual({
      name: 'Multisig',
      amlRules: '0',
      exceptAmlRules: null,
      wasUpdated: false,
    });
    expect(await readWalletById(24)).toEqual({
      id: 24,
      amlRules: REQUIRED_CURRENT_AML_RULES,
      exceptAmlRules: null,
      wasUpdated: false,
    });
    expect(await readWalletByName(EXCEPT_CLEAR_WALLET_NAME)).toEqual({
      name: EXCEPT_CLEAR_WALLET_NAME,
      amlRules: '3',
      exceptAmlRules: '13',
      wasUpdated: false,
    });
    expect(await readLogs()).toHaveLength(0);
    expect(await readUnrelated()).toEqual([
      { name: UNRELATED_CAKE_NAME, amlRules: UNRELATED_CAKE_RULES, exceptAmlRules: null },
      { name: UNRELATED_DFX_NAME, amlRules: UNRELATED_DFX_RULES, exceptAmlRules: null },
    ]);
  });

  it('rejects when a trigger suppresses only the except-clear audit', async () => {
    await seedFullPrdFixture({
      nameRules: TARGET_AML_RULES,
      idRules: { 24: TARGET_AML_RULES, 25: TARGET_AML_RULES },
      onchainlabsRules: '3',
      onchainlabsExcept: '13',
    });
    await queryRunner.query(`
      CREATE FUNCTION suppress_log_insert() RETURNS trigger AS $fn$
      BEGIN
        RETURN NULL;
      END;
      $fn$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER suppress_log_insert_trigger
      BEFORE INSERT ON "log"
      FOR EACH ROW
      EXECUTE FUNCTION suppress_log_insert()
    `);

    await expect(new AlignPartnerWalletAmlBaseline().up(queryRunner)).rejects.toThrow(
      'still have a non-empty exceptAmlRules',
    );

    expect(await readWalletByName(EXCEPT_CLEAR_WALLET_NAME)).toEqual({
      name: EXCEPT_CLEAR_WALLET_NAME,
      amlRules: '3',
      exceptAmlRules: '13',
      wasUpdated: false,
    });
    expect(await readLogs()).toHaveLength(0);
  });

  it('does not restore the previous rule set on rollback', async () => {
    await seedFullPrdFixture();
    const migration = new AlignPartnerWalletAmlBaseline();
    await migration.up(queryRunner);

    await migration.down();

    expect(await readWalletByName('Multisig')).toEqual({
      name: 'Multisig',
      amlRules: TARGET_AML_RULES,
      exceptAmlRules: null,
      wasUpdated: true,
    });
    expect(await readWalletById(24)).toEqual({
      id: 24,
      amlRules: TARGET_AML_RULES,
      exceptAmlRules: null,
      wasUpdated: true,
    });
    expect(await readWalletByName(EXCEPT_CLEAR_WALLET_NAME)).toEqual({
      name: EXCEPT_CLEAR_WALLET_NAME,
      amlRules: '3',
      exceptAmlRules: null,
      wasUpdated: true,
    });
  });

  it('aligns every wallet carrying a baseline name, not just the first one', async () => {
    await seedFullPrdFixture();
    await queryRunner.query(
      `INSERT INTO "wallet" ("name", "updated", "amlRules", "exceptAmlRules")
       VALUES ($1, TIMESTAMP '2000-01-01', $2, NULL)`,
      ['Edge', '3'],
    );

    await new AlignPartnerWalletAmlBaseline().up(queryRunner);

    const targets = (await queryRunner.query(`SELECT "amlRules" FROM "wallet" WHERE "name" = $1`, ['Edge'])) as {
      amlRules: string;
    }[];
    expect(targets).toEqual([{ amlRules: TARGET_AML_RULES }, { amlRules: TARGET_AML_RULES }]);
  });

  it('clears a neutralising exceptAmlRules on a name-matched wallet already at the target', async () => {
    await seedFullPrdFixture({
      nameRules: TARGET_AML_RULES,
      nameExcept: '3;7',
      idRules: { 24: TARGET_AML_RULES, 25: TARGET_AML_RULES },
    });

    await new AlignPartnerWalletAmlBaseline().up(queryRunner);

    for (const name of BASELINE_WALLET_NAMES) {
      expect(await readWalletByName(name)).toEqual({
        name,
        amlRules: TARGET_AML_RULES,
        exceptAmlRules: null,
        wasUpdated: true,
      });
    }

    const logs = await readLogs();
    const baselineAudit = logs[0] as {
      walletId: number;
      previousAmlRules: string;
      nextAmlRules: string;
      previousExceptAmlRules: string | null;
      nextExceptAmlRules: string | null;
    }[];
    expect(baselineAudit).toHaveLength(BASELINE_WALLET_NAMES.length);
    expect(baselineAudit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          previousExceptAmlRules: '3;7',
          nextExceptAmlRules: null,
        }),
      ]),
    );
  });

  it('rejects on dev when a trigger suppresses the audit insert for id-matched rows', async () => {
    process.env.ENVIRONMENT = 'dev';
    await insertUnrelatedWallets();
    await insertIdWallets();
    await queryRunner.query(`
      CREATE FUNCTION suppress_log_insert() RETURNS trigger AS $fn$
      BEGIN
        RETURN NULL;
      END;
      $fn$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER suppress_log_insert_trigger
      BEFORE INSERT ON "log"
      FOR EACH ROW
      EXECUTE FUNCTION suppress_log_insert()
    `);

    await expect(new AlignPartnerWalletAmlBaseline().up(queryRunner)).rejects.toThrow(
      'still carry the RULE_14 pre-state',
    );

    expect(await readWalletById(24)).toEqual({
      id: 24,
      amlRules: REQUIRED_CURRENT_AML_RULES,
      exceptAmlRules: null,
      wasUpdated: false,
    });
    expect(await readWalletById(25)).toEqual({
      id: 25,
      amlRules: REQUIRED_CURRENT_AML_RULES,
      exceptAmlRules: null,
      wasUpdated: false,
    });
    expect(await readLogs()).toHaveLength(0);
  });
});
