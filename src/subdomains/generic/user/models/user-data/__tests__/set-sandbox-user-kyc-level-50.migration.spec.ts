import { DataType, IMemoryTable, newDb } from 'pg-mem';

type UserDataRow = {
  id: number;
  updated: Date;
  kycHash: string | null;
  kycLevel: number;
};

type SettingRow = {
  id: number;
  updated: Date;
  created: Date;
  key: string;
  value: string;
};

const TARGET_KYC_HASH = '628CDA30-9E81-4294-997A-DB79E3B4DB36';
const BACKUP_KEY = 'sandboxKycLevelBackup:1785929412000:628CDA30-9E81-4294-997A-DB79E3B4DB36';
const FOREIGN_KYC_HASH = 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE';
const FOREIGN_SETTING_KEY = 'unrelatedSettingKey';
const ORIGIN_MARKER = '1785929412000';
const BACKUP_VALUE_FOR_20 = `20|${ORIGIN_MARKER}`;

let SetSandboxUserKycLevel50: new () => {
  up(queryRunner: { query(sql: string): Promise<void> }): Promise<void>;
  down(queryRunner: { query(sql: string): Promise<void> }): Promise<void>;
};

describe('SetSandboxUserKycLevel50 migration', () => {
  let db: ReturnType<typeof newDb>;
  let query: jest.Mock<Promise<void>, [string]>;
  let migration: InstanceType<typeof SetSandboxUserKycLevel50>;
  const originalEnvironment = process.env.ENVIRONMENT;

  beforeAll(() => {
    // The migration is intentionally a plain CommonJS module, matching TypeORM's runtime loader.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    SetSandboxUserKycLevel50 = require('../../../../../../../migration/1785929412000-SetSandboxUserKycLevel50');
  });

  beforeEach(() => {
    db = newDb();
    // pg-mem does not ship split_part; register a PostgreSQL-compatible implementation so the
    // migration SQL runs as written (no query rewrites that change semantics).
    db.public.registerFunction({
      name: 'split_part',
      args: [DataType.text, DataType.text, DataType.integer],
      returns: DataType.text,
      implementation: (str: string | null, delim: string, field: number): string | null => {
        if (str == null) return null;
        const parts = String(str).split(String(delim));
        const idx = field - 1;
        if (idx < 0 || idx >= parts.length) return '';
        return parts[idx];
      },
    });
    db.public.none(`
      CREATE TABLE "user_data" (
        "id" SERIAL PRIMARY KEY,
        "updated" TIMESTAMP NOT NULL,
        "kycHash" character varying(256),
        "kycLevel" integer NOT NULL DEFAULT '0'
      )
    `);
    db.public.none(`
      CREATE TABLE "setting" (
        "id" SERIAL PRIMARY KEY,
        "updated" TIMESTAMP NOT NULL,
        "created" TIMESTAMP NOT NULL,
        "key" character varying(256) NOT NULL UNIQUE,
        "value" text NOT NULL
      )
    `);

    query = jest.fn(async (sql: string) => {
      // pg-mem has no session/transaction LOCAL settings; this is a PostgreSQL session no-op here.
      if (/^\s*SET\s+LOCAL\b/i.test(sql)) return;
      // pg-mem rejects NOW() (timestamptz) in INSERT...SELECT into TIMESTAMP columns; real
      // PostgreSQL coerces. Cast only to match that coercion — INSERT/ON CONFLICT/UPDATE still run.
      const executable = sql.replace(/\bNOW\s*\(\s*\)/gi, '(NOW()::timestamp)');
      db.public.none(executable);
    });
    migration = new SetSandboxUserKycLevel50();
  });

  afterEach(() => {
    if (originalEnvironment === undefined) {
      delete process.env.ENVIRONMENT;
    } else {
      process.env.ENVIRONMENT = originalEnvironment;
    }
  });

  const getUserDataTable = () => db.public.getTable('user_data') as IMemoryTable<UserDataRow>;
  const getSettingTable = () => db.public.getTable('setting') as IMemoryTable<SettingRow>;

  // Insert via SQL so SERIAL sequences stay aligned (IMemoryTable.insert with a manual id desyncs them).
  const insertUser = (kycHash: string, kycLevel: number): void => {
    db.public.none(
      `INSERT INTO "user_data" ("updated", "kycHash", "kycLevel")
       VALUES ('2024-01-01T00:00:00.000Z', '${kycHash}', ${kycLevel})`,
    );
  };

  const insertSetting = (key: string, value: string): void => {
    db.public.none(
      `INSERT INTO "setting" ("updated", "created", "key", "value")
       VALUES ('2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z', '${key}', '${value}')`,
    );
  };

  const getUserByHash = (kycHash: string): UserDataRow | undefined => getUserDataTable().find({ kycHash })[0];

  const getSettingByKey = (key: string): SettingRow | undefined => getSettingTable().find({ key })[0];

  it("ENVIRONMENT='prd': up() leaves kycLevel unchanged and creates no setting row", async () => {
    process.env.ENVIRONMENT = 'prd';
    insertUser(TARGET_KYC_HASH, 20);

    await migration.up({ query });

    expect(getUserByHash(TARGET_KYC_HASH)?.kycLevel).toBe(20);
    expect(getSettingTable().find()).toHaveLength(0);
    expect(query).not.toHaveBeenCalled();
  });

  it("ENVIRONMENT='loc': up() leaves kycLevel unchanged and creates no setting row", async () => {
    process.env.ENVIRONMENT = 'loc';
    insertUser(TARGET_KYC_HASH, 20);

    await migration.up({ query });

    expect(getUserByHash(TARGET_KYC_HASH)?.kycLevel).toBe(20);
    expect(getSettingTable().find()).toHaveLength(0);
    expect(query).not.toHaveBeenCalled();
  });

  it("ENVIRONMENT='dev': up() raises target kycLevel to 50 and stores prior value with origin marker in backup setting", async () => {
    process.env.ENVIRONMENT = 'dev';
    insertUser(TARGET_KYC_HASH, 20);

    await migration.up({ query });

    expect(getUserByHash(TARGET_KYC_HASH)?.kycLevel).toBe(50);
    expect(getSettingByKey(BACKUP_KEY)?.value).toBe(BACKUP_VALUE_FOR_20);
  });

  it("second up() keeps kycLevel at 50 and leaves backup value at '20|1785929412000'", async () => {
    process.env.ENVIRONMENT = 'dev';
    insertUser(TARGET_KYC_HASH, 20);

    await migration.up({ query });
    await migration.up({ query });

    expect(getUserByHash(TARGET_KYC_HASH)?.kycLevel).toBe(50);
    expect(getSettingByKey(BACKUP_KEY)?.value).toBe(BACKUP_VALUE_FOR_20);
  });

  it('up() then down() restores kycLevel to 20 and removes the backup setting', async () => {
    process.env.ENVIRONMENT = 'dev';
    insertUser(TARGET_KYC_HASH, 20);

    await migration.up({ query });
    await migration.down({ query });

    expect(getUserByHash(TARGET_KYC_HASH)?.kycLevel).toBe(20);
    expect(getSettingByKey(BACKUP_KEY)).toBeUndefined();
  });

  it('up()→down() leaves pre-existing foreign user_data and setting rows unchanged', async () => {
    process.env.ENVIRONMENT = 'dev';
    insertUser(TARGET_KYC_HASH, 20);
    insertUser(FOREIGN_KYC_HASH, 30);
    insertSetting(FOREIGN_SETTING_KEY, 'keep-me');
    const foreignUserBefore = { ...getUserByHash(FOREIGN_KYC_HASH)! };
    const foreignSettingBefore = { ...getSettingByKey(FOREIGN_SETTING_KEY)! };

    await migration.up({ query });
    await migration.down({ query });

    expect(getUserByHash(FOREIGN_KYC_HASH)).toEqual(foreignUserBefore);
    expect(getSettingByKey(FOREIGN_SETTING_KEY)).toEqual(foreignSettingBefore);
  });

  it('up() does not throw and creates no setting when the target user is absent', async () => {
    process.env.ENVIRONMENT = 'dev';

    await expect(migration.up({ query })).resolves.toBeUndefined();

    expect(getUserDataTable().find()).toHaveLength(0);
    expect(getSettingTable().find()).toHaveLength(0);
  });

  it('up() does not demote a user already at kycLevel 60', async () => {
    process.env.ENVIRONMENT = 'dev';
    insertUser(TARGET_KYC_HASH, 60);

    await migration.up({ query });

    expect(getUserByHash(TARGET_KYC_HASH)?.kycLevel).toBe(60);
  });

  it('down() without a backup setting leaves kycLevel unchanged', async () => {
    process.env.ENVIRONMENT = 'dev';
    insertUser(TARGET_KYC_HASH, 50);

    await migration.down({ query });

    expect(getUserByHash(TARGET_KYC_HASH)?.kycLevel).toBe(50);
    expect(getSettingTable().find()).toHaveLength(0);
  });

  it('down() leaves pre-existing same-key setting without origin marker and does not restore kycLevel from it (up skips insert via ON CONFLICT)', async () => {
    process.env.ENVIRONMENT = 'dev';
    insertUser(TARGET_KYC_HASH, 20);
    insertSetting(BACKUP_KEY, '99');
    const foreignBackupBefore = { ...getSettingByKey(BACKUP_KEY)! };

    await migration.up({ query });
    // up() raises kycLevel but ON CONFLICT DO NOTHING leaves the foreign backup value as-is.
    expect(getUserByHash(TARGET_KYC_HASH)?.kycLevel).toBe(50);
    expect(getSettingByKey(BACKUP_KEY)?.value).toBe('99');

    await migration.down({ query });

    expect(getSettingByKey(BACKUP_KEY)).toEqual(foreignBackupBefore);
    // Must not have restored 99 from the unmarked foreign row.
    expect(getUserByHash(TARGET_KYC_HASH)?.kycLevel).toBe(50);
  });

  it('down() leaves pre-existing same-key setting with foreign origin marker and does not restore kycLevel from it (up skips insert via ON CONFLICT)', async () => {
    process.env.ENVIRONMENT = 'dev';
    insertUser(TARGET_KYC_HASH, 20);
    insertSetting(BACKUP_KEY, '99|1700000000000');
    const foreignBackupBefore = { ...getSettingByKey(BACKUP_KEY)! };

    await migration.up({ query });
    expect(getUserByHash(TARGET_KYC_HASH)?.kycLevel).toBe(50);
    expect(getSettingByKey(BACKUP_KEY)?.value).toBe('99|1700000000000');

    await migration.down({ query });

    expect(getSettingByKey(BACKUP_KEY)).toEqual(foreignBackupBefore);
    // Must not have restored 99 from the foreign-marker row.
    expect(getUserByHash(TARGET_KYC_HASH)?.kycLevel).toBe(50);
  });
});
