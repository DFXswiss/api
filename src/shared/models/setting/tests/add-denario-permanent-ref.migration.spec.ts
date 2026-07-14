import { DataType, newDb } from 'pg-mem';
import { DataSource, QueryRunner } from 'typeorm';

type Migration = {
  up(queryRunner: QueryRunner): Promise<void>;
  down(queryRunner: QueryRunner): Promise<void>;
};

type MigrationHarness = {
  queryRunner: QueryRunner;
  query: jest.Mock;
  getSetting(): string | undefined;
};

let AddDenarioPermanentRef: new () => Migration;

function createHarness(refs: unknown[] = ['123-456'], initialSetting?: string): MigrationHarness {
  let setting = initialSetting;
  const query = jest.fn(async (sql: string, parameters: unknown[] = []) => {
    if (sql.includes('FROM "user" u')) return refs.map((ref) => ({ ref }));
    if (sql.startsWith('SELECT "value" FROM "setting"')) return setting === undefined ? [] : [{ value: setting }];
    if (sql.startsWith('UPDATE "setting"')) {
      setting = parameters[0] as string;
      return [];
    }
    if (sql.startsWith('INSERT INTO "setting"')) {
      setting = parameters[1] as string;
      return [];
    }
    if (sql.startsWith('DELETE FROM "setting"')) {
      setting = undefined;
      return [];
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  return {
    queryRunner: { query } as unknown as QueryRunner,
    query,
    getSetting: () => setting,
  };
}

describe('AddDenarioPermanentRef migration', () => {
  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    AddDenarioPermanentRef = require('../../../../../migration/1784037000000-AddDenarioPermanentRef');
  });

  it('adds the environment-specific Denario ref while preserving existing aliases', async () => {
    const harness = createHarness(['123-456'], JSON.stringify({ cakewallet: '111-222', eternl: '222-333' }));

    await new AddDenarioPermanentRef().up(harness.queryRunner);

    expect(JSON.parse(harness.getSetting()!)).toEqual({
      cakewallet: '111-222',
      eternl: '222-333',
      denario: '123-456',
    });
    expect(harness.query).toHaveBeenCalledWith(expect.stringContaining('LOWER(BTRIM(ud."organizationName"))'), [
      'denario',
      'denario ag',
    ]);
  });

  it('creates ref-keys when the setting does not exist', async () => {
    const harness = createHarness();

    await new AddDenarioPermanentRef().up(harness.queryRunner);

    expect(JSON.parse(harness.getSetting()!)).toEqual({ denario: '123-456' });
    expect(harness.query).toHaveBeenCalledWith(expect.stringMatching(/^INSERT INTO "setting"/), [
      'ref-keys',
      JSON.stringify({ denario: '123-456' }),
    ]);
  });

  it('is idempotent when the alias already targets the same account', async () => {
    const initialSetting = JSON.stringify({ denario: '123-456' });
    const harness = createHarness(['123-456'], initialSetting);

    await new AddDenarioPermanentRef().up(harness.queryRunner);

    expect(harness.getSetting()).toBe(initialSetting);
    expect(harness.query).toHaveBeenCalledTimes(2);
  });

  it('refuses to overwrite a conflicting Denario alias', async () => {
    const harness = createHarness(['123-456'], JSON.stringify({ denario: '999-999' }));

    await expect(new AddDenarioPermanentRef().up(harness.queryRunner)).rejects.toThrow('conflicting');
    expect(JSON.parse(harness.getSetting()!)).toEqual({ denario: '999-999' });
  });

  it.each([
    { refs: [], error: 'No active Denario organization user' },
    { refs: ['123-456', '234-567'], error: 'ambiguous' },
    { refs: ['1234-56'], error: 'invalid referral code' },
  ])('rejects an unusable target: $error', async ({ refs, error }) => {
    const harness = createHarness(refs);

    await expect(new AddDenarioPermanentRef().up(harness.queryRunner)).rejects.toThrow(error);
    expect(harness.getSetting()).toBeUndefined();
  });

  it.each(['not-json', '[]', 'null'])('rejects corrupt ref-keys configuration: %s', async (value) => {
    const harness = createHarness(['123-456'], value);

    await expect(new AddDenarioPermanentRef().up(harness.queryRunner)).rejects.toThrow("Setting 'ref-keys'");
    expect(harness.getSetting()).toBe(value);
  });

  it('removes only the Denario alias on rollback', async () => {
    const harness = createHarness([], JSON.stringify({ cakewallet: '111-222', denario: '123-456' }));

    await new AddDenarioPermanentRef().down(harness.queryRunner);

    expect(JSON.parse(harness.getSetting()!)).toEqual({ cakewallet: '111-222' });
  });

  it('removes an otherwise empty ref-keys setting on rollback', async () => {
    const harness = createHarness([], JSON.stringify({ denario: '123-456' }));

    await new AddDenarioPermanentRef().down(harness.queryRunner);

    expect(harness.getSetting()).toBeUndefined();
  });

  it.each([undefined, JSON.stringify({ cakewallet: '111-222' })])(
    'leaves unrelated configuration untouched on rollback: %s',
    async (value) => {
      const harness = createHarness([], value);

      await new AddDenarioPermanentRef().down(harness.queryRunner);

      expect(harness.getSetting()).toBe(value);
      expect(harness.query).toHaveBeenCalledTimes(1);
    },
  );
});

describe('AddDenarioPermanentRef migration (postgres semantics)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    const db = newDb();
    db.public.registerFunction({ name: 'version', returns: DataType.text, implementation: () => 'PostgreSQL 15.0' });
    db.public.registerFunction({ name: 'current_database', returns: DataType.text, implementation: () => 'test' });
    db.public.registerFunction({
      name: 'btrim',
      args: [DataType.text],
      returns: DataType.text,
      implementation: (value: string) => value.trim(),
    });

    dataSource = (await db.adapters.createTypeormDataSource({
      type: 'postgres',
      entities: [],
    })) as DataSource;
    await dataSource.initialize();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query(`DROP TABLE IF EXISTS "setting"`);
    await dataSource.query(`DROP TABLE IF EXISTS "user"`);
    await dataSource.query(`DROP TABLE IF EXISTS "user_data"`);
    await dataSource.query(`
      CREATE TABLE "user_data" (
        "id" integer PRIMARY KEY,
        "organizationName" text,
        "accountType" text NOT NULL,
        "status" text NOT NULL
      )
    `);
    await dataSource.query(`
      CREATE TABLE "user" (
        "id" integer PRIMARY KEY,
        "userDataId" integer NOT NULL,
        "status" text NOT NULL,
        "ref" text
      )
    `);
    await dataSource.query(`
      CREATE TABLE "setting" (
        "key" text PRIMARY KEY,
        "value" text NOT NULL,
        "created" timestamp NOT NULL DEFAULT NOW(),
        "updated" timestamp NOT NULL DEFAULT NOW()
      )
    `);
  });

  it('resolves the active organization ref and applies a reversible setting update', async () => {
    await dataSource.query(
      `INSERT INTO "user_data" ("id", "organizationName", "accountType", "status") VALUES
        (1, '  DeNaRiO AG  ', 'Organization', 'Active'),
        (2, 'Other AG', 'Organization', 'Active'),
        (3, 'Denario AG', 'Organization', 'Blocked')`,
    );
    await dataSource.query(
      `INSERT INTO "user" ("id", "userDataId", "status", "ref") VALUES
        (1, 1, 'Active', '123-456'),
        (2, 2, 'Active', '999-999'),
        (3, 3, 'Active', '888-888'),
        (4, 1, 'Deleted', '777-777')`,
    );
    await dataSource.query(`INSERT INTO "setting" ("key", "value") VALUES ($1, $2)`, [
      'ref-keys',
      JSON.stringify({ cakewallet: '111-222' }),
    ]);

    const migration = new AddDenarioPermanentRef();
    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();

    try {
      await migration.up(queryRunner);
      const afterUp = await queryRunner.query(`SELECT "value" FROM "setting" WHERE "key" = 'ref-keys'`);
      expect(JSON.parse(afterUp.at(0).value)).toEqual({ cakewallet: '111-222', denario: '123-456' });

      await migration.down(queryRunner);
      const afterDown = await queryRunner.query(`SELECT "value" FROM "setting" WHERE "key" = 'ref-keys'`);
      expect(JSON.parse(afterDown.at(0).value)).toEqual({ cakewallet: '111-222' });
    } finally {
      await queryRunner.release();
    }
  });
});
