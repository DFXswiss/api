import { DataSource, QueryRunner } from 'typeorm';

const PG_URL = process.env.MIGRATION_TEST_PG;
const describeDb = PG_URL ? describe : describe.skip;
const SCHEMA = 'align_bitagent_wallet_aml_rules_spec';
const WALLET_NAME = 'Bitagent';
const REFERENCE_WALLET_NAME = 'DFX Bitcoin';
const TARGET_AML_RULES = '3;7;11;16';

let AlignBitagentWalletAmlRules: new () => {
  up(queryRunner: QueryRunner): Promise<void>;
  down(): Promise<void>;
};

function setEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe('AlignBitagentWalletAmlRules migration (SQL content)', () => {
  const originalEnvironment = process.env.ENVIRONMENT;

  beforeAll(() => {
    // The migration is intentionally a plain CommonJS module, matching TypeORM's runtime loader.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    AlignBitagentWalletAmlRules = require('../../../../../../../migration/1786107329636-AlignBitagentWalletAmlRules');
  });

  afterEach(() => setEnv('ENVIRONMENT', originalEnvironment));

  it('audits before it updates, fail-closes the update to the audit, and locks the row', async () => {
    const queryRunner = {
      query: jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ matchCount: 1, driftCount: 0 }]),
    };

    await new AlignBitagentWalletAmlRules().up(queryRunner as unknown as QueryRunner);

    expect(queryRunner.query).toHaveBeenCalledTimes(2);
    const [sql, parameters] = queryRunner.query.mock.calls[0];
    expect(parameters).toEqual([TARGET_AML_RULES, WALLET_NAME]);
    expect(sql).toContain('INSERT INTO "log"');
    expect(sql).toContain("'AlignBitagentWalletAmlRules1786107329636'");
    expect(sql).toContain("'previousAmlRules'");
    expect(sql).toContain("'nextAmlRules'");
    expect(sql).toContain("'previousExceptAmlRules'");
    expect(sql).toContain('FOR UPDATE');
    expect(sql).toContain('EXISTS (SELECT 1 FROM "audit")');
    expect(sql).toContain('HAVING count(*) > 0');
    // The idempotence guard: without IS DISTINCT FROM every deploy would append another audit row.
    expect(sql).toContain('"amlRules" IS DISTINCT FROM $1::varchar');
    // exceptAmlRules is the column that can neutralise the rules written here, so it is pinned too.
    expect(sql).toContain('"exceptAmlRules" = NULL');
    // Neither input may reach the statement as a string literal — the assertion is on the quoted
    // form because the migration name legitimately contains the wallet name as a substring.
    expect(sql).not.toContain(`'${WALLET_NAME}'`);
    expect(sql).not.toContain(`'${TARGET_AML_RULES}'`);
  });

  it('rejects when any matching wallet is left off the target configuration', async () => {
    const queryRunner = {
      query: jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ matchCount: 1, driftCount: 1 }]),
    };

    await expect(new AlignBitagentWalletAmlRules().up(queryRunner as unknown as QueryRunner)).rejects.toThrow(
      `1 '${WALLET_NAME}' wallet(s) did not reach amlRules '${TARGET_AML_RULES}'`,
    );
  });

  it.each([['dev'], ['loc'], ['staging'], [undefined]])(
    'accepts a missing wallet when ENVIRONMENT is %s',
    async (environment) => {
      setEnv('ENVIRONMENT', environment);
      const queryRunner = {
        query: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([{ matchCount: 0, driftCount: 0 }]),
      };

      await expect(
        new AlignBitagentWalletAmlRules().up(queryRunner as unknown as QueryRunner),
      ).resolves.toBeUndefined();
    },
  );

  // A rename would make the name match nothing: the update touches no row, the postcondition on
  // drift is trivially satisfied, and the migration would record itself as executed while the
  // lenient configuration stays live. On PRD that silent no-op is the failure mode worth failing on.
  it('rejects on PRD when no wallet carries the name any more', async () => {
    process.env.ENVIRONMENT = 'prd';
    const queryRunner = {
      query: jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ matchCount: 0, driftCount: 0 }]),
    };

    await expect(new AlignBitagentWalletAmlRules().up(queryRunner as unknown as QueryRunner)).rejects.toThrow(
      `no wallet named '${WALLET_NAME}' found on PRD`,
    );
  });

  it('down() deliberately performs no rollback', async () => {
    const migration = new AlignBitagentWalletAmlRules();

    expect(migration.down).toHaveLength(0);
    await expect(migration.down()).resolves.toBeUndefined();
  });
});

describeDb('AlignBitagentWalletAmlRules migration (real Postgres)', () => {
  const originalEnvironment = process.env.ENVIRONMENT;
  let dataSource: DataSource;
  let queryRunner: QueryRunner;

  beforeAll(async () => {
    // The migration is intentionally a plain CommonJS module, matching TypeORM's runtime loader.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    AlignBitagentWalletAmlRules = require('../../../../../../../migration/1786107329636-AlignBitagentWalletAmlRules');
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

  // The reference wallet is inserted in every case on purpose: it is the row the target must end up
  // equal to, and an unscoped UPDATE would rewrite it (or its `updated`) along the way.
  async function insertWallets(amlRules = '0', exceptAmlRules: string | null = null): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "wallet" ("name", "updated", "amlRules", "exceptAmlRules")
       VALUES ($1, TIMESTAMP '2000-01-01', $3, $4), ($2, TIMESTAMP '2000-01-01', $5, NULL)`,
      [WALLET_NAME, REFERENCE_WALLET_NAME, amlRules, exceptAmlRules, TARGET_AML_RULES],
    );
  }

  async function readWallets(): Promise<{ name: string; amlRules: string; exceptAmlRules: string | null }[]> {
    return queryRunner.query(`SELECT "name", "amlRules", "exceptAmlRules" FROM "wallet" ORDER BY "name"`);
  }

  async function readLogs(): Promise<unknown[]> {
    const rows = (await queryRunner.query(
      `SELECT "message" FROM "log" WHERE "system" = 'Migration' ORDER BY "id"`,
    )) as { message: string }[];
    return rows.map((r) => JSON.parse(r.message));
  }

  it('writes the reference rule set, bumps the timestamp, and records one before/after audit row', async () => {
    await insertWallets();

    await new AlignBitagentWalletAmlRules().up(queryRunner);

    const wallets = (await queryRunner.query(
      `SELECT "name", "amlRules", "exceptAmlRules", "updated" > TIMESTAMP '2000-01-01' AS "wasUpdated"
       FROM "wallet" ORDER BY "name"`,
    )) as { name: string; amlRules: string; exceptAmlRules: string | null; wasUpdated: boolean }[];
    expect(wallets).toEqual([
      { name: WALLET_NAME, amlRules: TARGET_AML_RULES, exceptAmlRules: null, wasUpdated: true },
      { name: REFERENCE_WALLET_NAME, amlRules: TARGET_AML_RULES, exceptAmlRules: null, wasUpdated: false },
    ]);

    expect(await readLogs()).toEqual([
      [
        {
          walletId: expect.any(Number),
          previousAmlRules: '0',
          nextAmlRules: TARGET_AML_RULES,
          previousExceptAmlRules: null,
          nextExceptAmlRules: null,
        },
      ],
    ]);
  });

  // exceptAmlRules is not cosmetic: `amlRuleCheck` filters every entry it lists straight back out,
  // so a stale value would hand the wallet back the exact leniency this migration removes.
  it('clears an exceptAmlRules value that would neutralise the new rules and audits it', async () => {
    await insertWallets(TARGET_AML_RULES, '3;7');

    await new AlignBitagentWalletAmlRules().up(queryRunner);

    expect(await readWallets()).toEqual([
      { name: WALLET_NAME, amlRules: TARGET_AML_RULES, exceptAmlRules: null },
      { name: REFERENCE_WALLET_NAME, amlRules: TARGET_AML_RULES, exceptAmlRules: null },
    ]);
    expect(await readLogs()).toEqual([
      [expect.objectContaining({ previousExceptAmlRules: '3;7', nextExceptAmlRules: null })],
    ]);
  });

  it('is idempotent and appends no second audit row on a rerun', async () => {
    await insertWallets();
    const migration = new AlignBitagentWalletAmlRules();

    await migration.up(queryRunner);
    await migration.up(queryRunner);

    expect(await readLogs()).toHaveLength(1);
    expect(await readWallets()).toEqual([
      { name: WALLET_NAME, amlRules: TARGET_AML_RULES, exceptAmlRules: null },
      { name: REFERENCE_WALLET_NAME, amlRules: TARGET_AML_RULES, exceptAmlRules: null },
    ]);
  });

  it('aligns every wallet carrying the name, not just the first one', async () => {
    await insertWallets();
    await queryRunner.query(`INSERT INTO "wallet" ("name", "amlRules") VALUES ($1, '3')`, [WALLET_NAME]);

    await new AlignBitagentWalletAmlRules().up(queryRunner);

    const targets = (await queryRunner.query(`SELECT "amlRules" FROM "wallet" WHERE "name" = $1`, [WALLET_NAME])) as {
      amlRules: string;
    }[];
    expect(targets).toEqual([{ amlRules: TARGET_AML_RULES }, { amlRules: TARGET_AML_RULES }]);
  });

  it('is a no-op outside PRD when no wallet carries the name', async () => {
    process.env.ENVIRONMENT = 'dev';
    await queryRunner.query(`INSERT INTO "wallet" ("name", "amlRules") VALUES ($1, $2)`, [
      REFERENCE_WALLET_NAME,
      TARGET_AML_RULES,
    ]);

    await expect(new AlignBitagentWalletAmlRules().up(queryRunner)).resolves.toBeUndefined();

    expect(await readLogs()).toHaveLength(0);
  });

  it('changes nothing when a trigger suppresses the audit insert', async () => {
    await insertWallets();
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

    await expect(new AlignBitagentWalletAmlRules().up(queryRunner)).rejects.toThrow(
      `did not reach amlRules '${TARGET_AML_RULES}'`,
    );

    expect(await readWallets()).toEqual([
      { name: WALLET_NAME, amlRules: '0', exceptAmlRules: null },
      { name: REFERENCE_WALLET_NAME, amlRules: TARGET_AML_RULES, exceptAmlRules: null },
    ]);
    expect(await readLogs()).toHaveLength(0);
  });

  it('does not restore the previous rule set on rollback', async () => {
    await insertWallets();
    const migration = new AlignBitagentWalletAmlRules();
    await migration.up(queryRunner);

    await migration.down();

    expect(await readWallets()).toEqual([
      { name: WALLET_NAME, amlRules: TARGET_AML_RULES, exceptAmlRules: null },
      { name: REFERENCE_WALLET_NAME, amlRules: TARGET_AML_RULES, exceptAmlRules: null },
    ]);
  });
});
