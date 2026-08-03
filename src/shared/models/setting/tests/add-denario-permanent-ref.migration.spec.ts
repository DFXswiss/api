import { DataType, newDb } from 'pg-mem';
import { DataSource, QueryRunner } from 'typeorm';

type Migration = {
  up(queryRunner: QueryRunner): Promise<void>;
  down(queryRunner: QueryRunner): Promise<void>;
};

const APPLY_ACTION = 'applyDenarioReferralAlias';
const ROLLBACK_ACTION = 'rollbackDenarioReferralAlias';

type AuditLog = {
  id: number;
  message: string;
};

type MigrationHarness = {
  queryRunner: QueryRunner;
  query: jest.Mock;
  getSetting(key?: string): string | undefined;
  getLogs(): AuditLog[];
};

function createHarness(refs: unknown[] = ['123-456'], initialSetting?: string): MigrationHarness {
  const settings = new Map<string, string>();
  const logs: AuditLog[] = [];
  if (initialSetting !== undefined) settings.set('ref-keys', initialSetting);

  const query = jest.fn(async (sql: string, parameters: unknown[] = []) => {
    // Migrations set lock_timeout after the prd guard; the harness only mocks data statements.
    if (sql.startsWith('SET LOCAL lock_timeout')) return [];
    if (sql.startsWith('SELECT pg_advisory_xact_lock')) return [];
    if (sql.includes('FROM "user" u')) return refs.map((ref) => ({ ref }));
    if (sql.startsWith('SELECT "id", "message" FROM "log"')) return logs;
    if (sql.startsWith('SELECT "value" FROM "setting"')) {
      const key = parameters[0] as string;
      return settings.has(key) ? [{ value: settings.get(key) }] : [];
    }
    if (sql.startsWith('UPDATE "setting"')) {
      settings.set(parameters[1] as string, parameters[0] as string);
      return [];
    }
    if (sql.startsWith('INSERT INTO "log"')) {
      const message = parameters[1] as string;
      const id = logs.length + 1;
      logs.push({ id, message });
      return [{ id }];
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
    getLogs: () => logs,
  };
}

let AddDenarioPermanentRef: new () => Migration;

// The migration under test is prod-gated (ENVIRONMENT === 'prd'); force it so up()/down() execute.
const originalEnvironment = process.env.ENVIRONMENT;
beforeEach(() => {
  process.env.ENVIRONMENT = 'prd';
});
afterEach(() => {
  if (originalEnvironment === undefined) delete process.env.ENVIRONMENT;
  else process.env.ENVIRONMENT = originalEnvironment;
});

describe('AddDenarioPermanentRef migration', () => {
  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    AddDenarioPermanentRef = require('../../../../../migration/1785600100000-AddDenarioPermanentRef');
  });

  it('adds the environment-specific Denario ref while preserving existing aliases', async () => {
    const harness = createHarness(['123-456'], JSON.stringify({ cakewallet: '111-222', eternl: '222-333' }));

    await new AddDenarioPermanentRef().up(harness.queryRunner);

    expect(JSON.parse(harness.getSetting()!)).toEqual({
      cakewallet: '111-222',
      eternl: '222-333',
      denario: '123-456',
    });
    expect(harness.query).toHaveBeenCalledWith(expect.stringContaining('ud."id" = $1'), [408808]);
  });

  it('writes an append-only before -> after audit event before overwriting ref-keys', async () => {
    const previous = JSON.stringify({ cakewallet: '111-222' });
    const harness = createHarness(['123-456'], previous);

    await new AddDenarioPermanentRef().up(harness.queryRunner);

    expect(harness.getLogs().map((log) => JSON.parse(log.message))).toEqual([
      {
        action: APPLY_ACTION,
        settingKey: 'ref-keys',
        existed: true,
        previous,
        next: JSON.stringify({ cakewallet: '111-222', denario: '123-456' }),
        ownedRef: '123-456',
      },
    ]);
    const insertAuditCall = harness.query.mock.calls.findIndex(([sql]) => /^INSERT INTO "log"/.test(sql));
    const updateRefKeysCall = harness.query.mock.calls.findIndex(([sql]) => /^UPDATE "setting"/.test(sql));
    expect(insertAuditCall).toBeGreaterThanOrEqual(0);
    expect(insertAuditCall).toBeLessThan(updateRefKeysCall);
  });

  it('creates ref-keys when the setting does not exist and audits existed=false', async () => {
    const harness = createHarness();

    await new AddDenarioPermanentRef().up(harness.queryRunner);

    expect(JSON.parse(harness.getSetting()!)).toEqual({ denario: '123-456' });
    expect(JSON.parse(harness.getLogs().at(0)!.message)).toEqual({
      action: APPLY_ACTION,
      settingKey: 'ref-keys',
      existed: false,
      previous: null,
      next: JSON.stringify({ denario: '123-456' }),
      ownedRef: '123-456',
    });
  });

  it('is idempotent and writes no audit event when the alias already targets the same account', async () => {
    const initialSetting = JSON.stringify({ denario: '123-456' });
    const harness = createHarness(['123-456'], initialSetting);

    await new AddDenarioPermanentRef().up(harness.queryRunner);

    expect(harness.getSetting()).toBe(initialSetting);
    expect(harness.getLogs()).toEqual([]);
  });

  it('treats a direct reapply as a no-op while its active ownership still matches', async () => {
    const harness = createHarness(['123-456'], JSON.stringify({ cakewallet: '111-222' }));
    const migration = new AddDenarioPermanentRef();

    await migration.up(harness.queryRunner);
    await migration.up(harness.queryRunner);

    expect(JSON.parse(harness.getSetting()!)).toEqual({ cakewallet: '111-222', denario: '123-456' });
    expect(harness.getLogs().map((event) => JSON.parse(event.message).action)).toEqual([APPLY_ACTION]);
  });

  it('fails closed instead of creating a second apply when owned state changed before reapply', async () => {
    const harness = createHarness(['123-456'], JSON.stringify({ cakewallet: '111-222' }));
    const migration = new AddDenarioPermanentRef();
    await migration.up(harness.queryRunner);
    await harness.queryRunner.query(`UPDATE "setting" SET "value" = $1, "updated" = NOW() WHERE "key" = $2`, [
      JSON.stringify({ cakewallet: '111-222' }),
      'ref-keys',
    ]);

    await expect(migration.up(harness.queryRunner)).rejects.toThrow('ownership event no longer matches');

    expect(JSON.parse(harness.getSetting()!)).toEqual({ cakewallet: '111-222' });
    expect(harness.getLogs().map((event) => JSON.parse(event.message).action)).toEqual([APPLY_ACTION]);
  });

  it('refuses to overwrite a conflicting Denario alias and writes no audit event', async () => {
    const harness = createHarness(['123-456'], JSON.stringify({ denario: '999-999' }));

    await expect(new AddDenarioPermanentRef().up(harness.queryRunner)).rejects.toThrow('conflicting');
    expect(JSON.parse(harness.getSetting()!)).toEqual({ denario: '999-999' });
    expect(harness.getLogs()).toEqual([]);
  });

  it.each([
    { refs: [], error: 'No usable referral code found for the Denario organization account' },
    { refs: ['123-456', '234-567'], error: 'ambiguous' },
    { refs: ['1234-56'], error: 'invalid referral code' },
  ])('rejects an unusable target: $error', async ({ refs, error }) => {
    const harness = createHarness(refs);

    await expect(new AddDenarioPermanentRef().up(harness.queryRunner)).rejects.toThrow(error);
    expect(harness.getSetting()).toBeUndefined();
    expect(harness.getLogs()).toEqual([]);
  });

  it.each(['not-json', '[]', 'null'])('rejects corrupt ref-keys configuration: %s', async (value) => {
    const harness = createHarness(['123-456'], value);

    await expect(new AddDenarioPermanentRef().up(harness.queryRunner)).rejects.toThrow("Setting 'ref-keys'");
    expect(harness.getSetting()).toBe(value);
    expect(harness.getLogs()).toEqual([]);
  });

  it('removes only the Denario alias and retains apply plus rollback audit events', async () => {
    const harness = createHarness(['123-456'], JSON.stringify({ cakewallet: '111-222' }));
    await new AddDenarioPermanentRef().up(harness.queryRunner);

    await new AddDenarioPermanentRef().down(harness.queryRunner);

    expect(JSON.parse(harness.getSetting()!)).toEqual({ cakewallet: '111-222' });
    const events = harness.getLogs().map((log) => JSON.parse(log.message));
    expect(events).toHaveLength(2);
    expect(events.at(0)).toMatchObject({ action: APPLY_ACTION });
    expect(events.at(1)).toMatchObject({
      action: ROLLBACK_ACTION,
      applyLogId: 1,
      previous: JSON.stringify({ cakewallet: '111-222', denario: '123-456' }),
      next: JSON.stringify({ cakewallet: '111-222' }),
      outcome: 'reverted',
    });
  });

  it('removes an otherwise empty ref-keys setting on rollback when it did not exist before', async () => {
    const harness = createHarness(['123-456']);
    await new AddDenarioPermanentRef().up(harness.queryRunner);

    await new AddDenarioPermanentRef().down(harness.queryRunner);

    expect(harness.getSetting()).toBeUndefined();
    expect(harness.getLogs()).toHaveLength(2);
    expect(JSON.parse(harness.getLogs().at(1)!.message)).toMatchObject({ next: null, outcome: 'reverted' });
  });

  it('is a no-op on rollback when up() never owned a change', async () => {
    const harness = createHarness(['123-456'], JSON.stringify({ cakewallet: '111-222' }));

    await new AddDenarioPermanentRef().down(harness.queryRunner);

    expect(JSON.parse(harness.getSetting()!)).toEqual({ cakewallet: '111-222' });
  });

  it('records a skipped rollback when the setting disappeared after apply', async () => {
    const harness = createHarness(['123-456'], JSON.stringify({ cakewallet: '111-222' }));
    await new AddDenarioPermanentRef().up(harness.queryRunner);
    await harness.queryRunner.query(`DELETE FROM "setting" WHERE "key" = $1`, ['ref-keys']);

    await new AddDenarioPermanentRef().down(harness.queryRunner);

    expect(harness.getSetting()).toBeUndefined();
    expect(JSON.parse(harness.getLogs().at(1)!.message)).toMatchObject({
      outcome: 'skippedSettingMissing',
      previous: null,
      next: null,
    });
  });

  it('does not mutate ref-keys when the apply audit insert fails', async () => {
    const initial = JSON.stringify({ cakewallet: '111-222' });
    const harness = createHarness(['123-456'], initial);
    const implementation = harness.query.getMockImplementation()!;
    harness.query.mockImplementation(async (sql: string, parameters: unknown[]) => {
      if (sql.startsWith('INSERT INTO "log"')) throw new Error('audit unavailable');
      return implementation(sql, parameters);
    });

    await expect(new AddDenarioPermanentRef().up(harness.queryRunner)).rejects.toThrow('audit unavailable');

    expect(harness.getSetting()).toBe(initial);
    expect(harness.getLogs()).toEqual([]);
  });

  it('does not mutate ref-keys when the apply audit insert returns no id', async () => {
    const initial = JSON.stringify({ cakewallet: '111-222' });
    const harness = createHarness(['123-456'], initial);
    const implementation = harness.query.getMockImplementation()!;
    harness.query.mockImplementation(async (sql: string, parameters: unknown[]) => {
      // INSERT succeeds from the driver's point of view but yields no RETURNING row — the
      // fail-closed id check must abort before the setting is rewritten.
      if (sql.startsWith('INSERT INTO "log"')) return [];
      return implementation(sql, parameters);
    });

    await expect(new AddDenarioPermanentRef().up(harness.queryRunner)).rejects.toThrow(/Failed to write audit event/);

    expect(harness.getSetting()).toBe(initial);
    expect(harness.getLogs()).toEqual([]);
  });

  it('fails closed on corrupt or ambiguous audit history', async () => {
    const harness = createHarness(['123-456'], JSON.stringify({ cakewallet: '111-222' }));
    harness.getLogs().push({ id: 1, message: 'not-json' });
    await expect(new AddDenarioPermanentRef().down(harness.queryRunner)).rejects.toThrow('Corrupt audit event');

    harness.getLogs().splice(
      0,
      1,
      {
        id: 1,
        message: JSON.stringify({
          action: APPLY_ACTION,
          settingKey: 'ref-keys',
          existed: true,
          previous: harness.getSetting(),
          next: JSON.stringify({ cakewallet: '111-222', denario: '123-456' }),
          ownedRef: '123-456',
        }),
      },
      {
        id: 2,
        message: JSON.stringify({
          action: APPLY_ACTION,
          settingKey: 'ref-keys',
          existed: true,
          previous: harness.getSetting(),
          next: JSON.stringify({ cakewallet: '111-222', denario: '123-456' }),
          ownedRef: '123-456',
        }),
      },
    );
    await expect(new AddDenarioPermanentRef().down(harness.queryRunner)).rejects.toThrow('Ambiguous audit state');
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
    expect(JSON.parse(harness.getLogs().at(1)!.message)).toMatchObject({
      action: ROLLBACK_ACTION,
      outcome: 'skippedAliasRepointed',
      previous: JSON.stringify({ cakewallet: '111-222', denario: '555-666' }),
      next: JSON.stringify({ cakewallet: '111-222', denario: '555-666' }),
    });
  });

  it('retains four distinct events across two complete apply/rollback cycles', async () => {
    const harness = createHarness(['123-456'], JSON.stringify({ cakewallet: '111-222' }));
    const migration = new AddDenarioPermanentRef();

    await migration.up(harness.queryRunner);
    await migration.down(harness.queryRunner);
    await migration.up(harness.queryRunner);
    await migration.down(harness.queryRunner);

    expect(harness.getLogs().map((log) => JSON.parse(log.message).action)).toEqual([
      APPLY_ACTION,
      ROLLBACK_ACTION,
      APPLY_ACTION,
      ROLLBACK_ACTION,
    ]);
  });
});

describe('AddDenarioPermanentRef migration (postgres semantics)', () => {
  let dataSource: DataSource;

  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    AddDenarioPermanentRef = require('../../../../../migration/1785600100000-AddDenarioPermanentRef');
  });

  beforeEach(async () => {
    const db = newDb();
    db.public.registerFunction({ name: 'version', returns: DataType.text, implementation: () => 'PostgreSQL 15.0' });
    db.public.registerFunction({ name: 'current_database', returns: DataType.text, implementation: () => 'test' });
    db.public.registerFunction({
      name: 'pg_advisory_xact_lock',
      args: [DataType.bigint],
      returns: DataType.null,
      implementation: () => null,
    });

    dataSource = (await db.adapters.createTypeormDataSource({
      type: 'postgres',
      entities: [],
    })) as DataSource;
    await dataSource.initialize();
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
    await dataSource.query(`
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
  });

  afterEach(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it('resolves the organization ref for an Active pinned account and applies a reversible, auditable setting update', async () => {
    // 408808 is the pinned Denario account. Rows 2 and 3 are same-named impostors ("Denario AG") that the
    // old organizationName match would have hit — the id pin must ignore them.
    await dataSource.query(
      `INSERT INTO "user_data" ("id", "organizationName", "accountType", "status") VALUES
        (408808, 'Denario AG', 'Organization', 'Active'),
        (2, 'Denario AG', 'Organization', 'Active'),
        (3, 'Denario AG', 'Organization', 'Blocked')`,
    );
    await dataSource.query(
      `INSERT INTO "user" ("id", "userDataId", "status", "ref") VALUES
        (1, 408808, 'Active', '123-456'),
        (2, 2, 'Active', '999-999'),
        (3, 3, 'Active', '888-888'),
        (4, 408808, 'Deleted', '777-777')`,
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
      const applyLogs = await queryRunner.query(`SELECT "message" FROM "log" ORDER BY "id"`);
      expect(JSON.parse(applyLogs.at(0).message)).toMatchObject({
        action: APPLY_ACTION,
        previous: JSON.stringify({ cakewallet: '111-222' }),
        next: JSON.stringify({ cakewallet: '111-222', denario: '123-456' }),
      });

      await migration.down(queryRunner);
      const afterDown = await queryRunner.query(`SELECT "value" FROM "setting" WHERE "key" = 'ref-keys'`);
      expect(JSON.parse(afterDown.at(0).value)).toEqual({ cakewallet: '111-222' });
      const logsAfterDown = await queryRunner.query(`SELECT "message" FROM "log" ORDER BY "id"`);
      expect(logsAfterDown).toHaveLength(2);
      expect(JSON.parse(logsAfterDown.at(1).message)).toMatchObject({
        action: ROLLBACK_ACTION,
        outcome: 'reverted',
      });
    } finally {
      await queryRunner.release();
    }
  });

  it('resolves the ref for the normal post-first-login state (user_data NA, user NA)', async () => {
    // Mirrors UserService: a KycOnly user_data flips to 'NA' on first wallet login and the ref is
    // granted immediately at kycLevel >= 50, so the pinned account regularly sits at NA, not Active.
    await dataSource.query(
      `INSERT INTO "user_data" ("id", "organizationName", "accountType", "status") VALUES
        (408808, 'Denario AG', 'Organization', 'NA')`,
    );
    await dataSource.query(
      `INSERT INTO "user" ("id", "userDataId", "status", "ref") VALUES
        (1, 408808, 'NA', '123-456')`,
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
    } finally {
      await queryRunner.release();
    }
  });

  it('throws when the pinned account is KycOnly and has no user with a referral code', async () => {
    await dataSource.query(
      `INSERT INTO "user_data" ("id", "organizationName", "accountType", "status") VALUES
        (408808, 'Denario AG', 'Organization', 'KycOnly')`,
    );

    const migration = new AddDenarioPermanentRef();
    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();

    try {
      await expect(migration.up(queryRunner)).rejects.toThrow('No usable referral code found');
    } finally {
      await queryRunner.release();
    }
  });

  it('ignores Blocked and Deleted users and throws when they are the only ones with a referral code', async () => {
    await dataSource.query(
      `INSERT INTO "user_data" ("id", "organizationName", "accountType", "status") VALUES
        (408808, 'Denario AG', 'Organization', 'Active')`,
    );
    await dataSource.query(
      `INSERT INTO "user" ("id", "userDataId", "status", "ref") VALUES
        (1, 408808, 'Blocked', '123-456'),
        (2, 408808, 'Deleted', '234-567')`,
    );

    const migration = new AddDenarioPermanentRef();
    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();

    try {
      await expect(migration.up(queryRunner)).rejects.toThrow('No usable referral code found');
    } finally {
      await queryRunner.release();
    }
  });

  it.each(['Blocked', 'Merged', 'Deactivated'])('throws when the pinned account status is %s', async (status) => {
    await dataSource.query(
      `INSERT INTO "user_data" ("id", "organizationName", "accountType", "status") VALUES (408808, 'Denario AG', 'Organization', $1)`,
      [status],
    );
    await dataSource.query(
      `INSERT INTO "user" ("id", "userDataId", "status", "ref") VALUES (1, 408808, 'Active', '123-456')`,
    );

    const migration = new AddDenarioPermanentRef();
    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();

    try {
      await expect(migration.up(queryRunner)).rejects.toThrow('No usable referral code found');
    } finally {
      await queryRunner.release();
    }
  });
});
