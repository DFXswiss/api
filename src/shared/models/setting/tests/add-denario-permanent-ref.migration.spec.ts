import { DataType, newDb } from 'pg-mem';
import { DataSource, QueryRunner } from 'typeorm';

type Migration = {
  up(queryRunner: QueryRunner): Promise<void>;
  down(queryRunner: QueryRunner): Promise<void>;
};

const BACKUP_KEY = 'ref-keys.backup.1784037000000';

type MigrationHarness = {
  queryRunner: QueryRunner;
  query: jest.Mock;
  getSetting(key?: string): string | undefined;
};

function createHarness(refs: unknown[] = ['123-456'], initialSetting?: string): MigrationHarness {
  const settings = new Map<string, string>();
  if (initialSetting !== undefined) settings.set('ref-keys', initialSetting);

  const query = jest.fn(async (sql: string, parameters: unknown[] = []) => {
    if (sql.includes('FROM "user" u')) return refs.map((ref) => ({ ref }));
    if (sql.startsWith('SELECT "value" FROM "setting"')) {
      const key = parameters[0] as string;
      return settings.has(key) ? [{ value: settings.get(key) }] : [];
    }
    if (sql.startsWith('UPDATE "setting"')) {
      settings.set(parameters[1] as string, parameters[0] as string);
      return [];
    }
    if (sql.startsWith('INSERT INTO "setting"')) {
      const key = parameters[0] as string;
      if (settings.has(key)) throw new Error(`duplicate key value violates unique constraint "${key}"`);
      settings.set(key, parameters[1] as string);
      return [];
    }
    if (sql.startsWith('DELETE FROM "setting"')) {
      settings.delete(parameters[0] as string);
      return [];
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  return {
    queryRunner: { query } as unknown as QueryRunner,
    query,
    getSetting: (key = 'ref-keys') => settings.get(key),
  };
}

let AddDenarioPermanentRef: new () => Migration;

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

  it('writes an immutable before-image backup before overwriting ref-keys', async () => {
    const previous = JSON.stringify({ cakewallet: '111-222' });
    const harness = createHarness(['123-456'], previous);

    await new AddDenarioPermanentRef().up(harness.queryRunner);

    expect(JSON.parse(harness.getSetting(BACKUP_KEY)!)).toEqual({ existed: true, previous, ownedRef: '123-456' });
    // backup is inserted before the ref-keys update
    const insertBackupCall = harness.query.mock.calls.findIndex(
      ([sql, params]) => /^INSERT INTO "setting"/.test(sql) && params?.[0] === BACKUP_KEY,
    );
    const updateRefKeysCall = harness.query.mock.calls.findIndex(([sql]) => /^UPDATE "setting"/.test(sql));
    expect(insertBackupCall).toBeGreaterThanOrEqual(0);
    expect(insertBackupCall).toBeLessThan(updateRefKeysCall);
  });

  it('creates ref-keys when the setting does not exist and records existed=false', async () => {
    const harness = createHarness();

    await new AddDenarioPermanentRef().up(harness.queryRunner);

    expect(JSON.parse(harness.getSetting()!)).toEqual({ denario: '123-456' });
    expect(JSON.parse(harness.getSetting(BACKUP_KEY)!)).toEqual({
      existed: false,
      previous: null,
      ownedRef: '123-456',
    });
  });

  it('is idempotent and writes no backup when the alias already targets the same account', async () => {
    const initialSetting = JSON.stringify({ denario: '123-456' });
    const harness = createHarness(['123-456'], initialSetting);

    await new AddDenarioPermanentRef().up(harness.queryRunner);

    expect(harness.getSetting()).toBe(initialSetting);
    expect(harness.getSetting(BACKUP_KEY)).toBeUndefined();
    expect(harness.query).toHaveBeenCalledTimes(2);
  });

  it('refuses to overwrite a conflicting Denario alias and writes no backup', async () => {
    const harness = createHarness(['123-456'], JSON.stringify({ denario: '999-999' }));

    await expect(new AddDenarioPermanentRef().up(harness.queryRunner)).rejects.toThrow('conflicting');
    expect(JSON.parse(harness.getSetting()!)).toEqual({ denario: '999-999' });
    expect(harness.getSetting(BACKUP_KEY)).toBeUndefined();
  });

  it.each([
    { refs: [], error: 'No active Denario organization user' },
    { refs: ['123-456', '234-567'], error: 'ambiguous' },
    { refs: ['1234-56'], error: 'invalid referral code' },
  ])('rejects an unusable target: $error', async ({ refs, error }) => {
    const harness = createHarness(refs);

    await expect(new AddDenarioPermanentRef().up(harness.queryRunner)).rejects.toThrow(error);
    expect(harness.getSetting()).toBeUndefined();
    expect(harness.getSetting(BACKUP_KEY)).toBeUndefined();
  });

  it.each(['not-json', '[]', 'null'])('rejects corrupt ref-keys configuration: %s', async (value) => {
    const harness = createHarness(['123-456'], value);

    await expect(new AddDenarioPermanentRef().up(harness.queryRunner)).rejects.toThrow("Setting 'ref-keys'");
    expect(harness.getSetting()).toBe(value);
    expect(harness.getSetting(BACKUP_KEY)).toBeUndefined();
  });

  it('removes only the Denario alias on rollback and clears the backup', async () => {
    const harness = createHarness(['123-456'], JSON.stringify({ cakewallet: '111-222' }));
    await new AddDenarioPermanentRef().up(harness.queryRunner);

    await new AddDenarioPermanentRef().down(harness.queryRunner);

    expect(JSON.parse(harness.getSetting()!)).toEqual({ cakewallet: '111-222' });
    expect(harness.getSetting(BACKUP_KEY)).toBeUndefined();
  });

  it('removes an otherwise empty ref-keys setting on rollback when it did not exist before', async () => {
    const harness = createHarness(['123-456']);
    await new AddDenarioPermanentRef().up(harness.queryRunner);

    await new AddDenarioPermanentRef().down(harness.queryRunner);

    expect(harness.getSetting()).toBeUndefined();
    expect(harness.getSetting(BACKUP_KEY)).toBeUndefined();
  });

  it('is a no-op on rollback when up() never owned a change (no backup)', async () => {
    const harness = createHarness(['123-456'], JSON.stringify({ cakewallet: '111-222' }));

    await new AddDenarioPermanentRef().down(harness.queryRunner);

    expect(JSON.parse(harness.getSetting()!)).toEqual({ cakewallet: '111-222' });
  });

  it('does not destroy a Denario alias re-pointed after deployment', async () => {
    const harness = createHarness(['123-456'], JSON.stringify({ cakewallet: '111-222' }));
    await new AddDenarioPermanentRef().up(harness.queryRunner);

    // an admin re-points the alias after deployment
    harness.query.mock.calls.length = 0;
    const current = JSON.parse(harness.getSetting()!);
    current.denario = '555-666';
    (harness.queryRunner as unknown as { query: jest.Mock }).query(
      `UPDATE "setting" SET "value" = $1, "updated" = NOW() WHERE "key" = $2`,
      [JSON.stringify(current), 'ref-keys'],
    );

    await new AddDenarioPermanentRef().down(harness.queryRunner);

    expect(JSON.parse(harness.getSetting()!)).toEqual({ cakewallet: '111-222', denario: '555-666' });
    expect(harness.getSetting(BACKUP_KEY)).toBeUndefined();
  });
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

  it('resolves the active organization ref and applies a reversible, auditable setting update', async () => {
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
      const backup = await queryRunner.query(`SELECT "value" FROM "setting" WHERE "key" = '${BACKUP_KEY}'`);
      expect(JSON.parse(backup.at(0).value)).toEqual({
        existed: true,
        previous: JSON.stringify({ cakewallet: '111-222' }),
        ownedRef: '123-456',
      });

      await migration.down(queryRunner);
      const afterDown = await queryRunner.query(`SELECT "value" FROM "setting" WHERE "key" = 'ref-keys'`);
      expect(JSON.parse(afterDown.at(0).value)).toEqual({ cakewallet: '111-222' });
      const backupAfterDown = await queryRunner.query(`SELECT "value" FROM "setting" WHERE "key" = '${BACKUP_KEY}'`);
      expect(backupAfterDown).toHaveLength(0);
    } finally {
      await queryRunner.release();
    }
  });
});
