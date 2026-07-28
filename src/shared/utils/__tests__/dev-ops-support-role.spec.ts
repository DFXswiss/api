/**
 * Pins behaviour of the one-shot DEV ops script that grants Support on a known wallet.
 * Script lives outside src/; Jest only picks up *.spec.ts under src/ (rootDir: src).
 */

// CommonJS ops script — load via require so module.exports is available without ESM interop.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ops = require('../../../../migration/ops/set-dev-support-role-joshua.js') as {
  ACCOUNT_ID: number;
  EXPECTED_MAIL: string;
  WALLET_ADDRESS: string;
  TARGET_ROLE: string;
  satisfiesSupport: (role: string) => boolean;
  findBlockingStatus: (
    user: { status?: string },
    account: { status?: string; riskStatus?: string | null },
  ) => { field: string; value: string } | null;
  maskAddress: (address: string) => string;
  run: (client: { query: (sql: string, params?: unknown[]) => Promise<unknown> }) => Promise<{
    status: string;
    before?: unknown;
    after?: unknown;
    blockedField?: string;
    blockedValue?: string;
    user?: unknown;
    message?: string;
  }>;
  main: () => Promise<void>;
};

const {
  ACCOUNT_ID,
  EXPECTED_MAIL,
  WALLET_ADDRESS,
  TARGET_ROLE,
  satisfiesSupport,
  findBlockingStatus,
  maskAddress,
  run,
} = ops;

type UserRow = {
  id: number;
  address: string;
  role: string;
  status: string;
  userDataId: number;
};

type AccountRow = {
  id: number;
  mail: string;
  status: string;
  riskStatus: string | null;
};

type FakeClient = {
  statements: string[];
  query: (sql: string, params?: unknown[]) => Promise<{ rowCount: number; rows: unknown[] }>;
};

function isRoleUpdateSql(sql: string): boolean {
  return /^\s*UPDATE\b/m.test(sql) && sql.includes('"user"') && sql.includes('"role"');
}

function createFakeClient(options: {
  accountRows?: AccountRow[];
  userRows?: UserRow[];
  /** After UPDATE, optional override for the re-read by id */
  userAfterUpdate?: Partial<UserRow>;
}): FakeClient {
  const accountRows = options.accountRows ?? [];
  const users = (options.userRows ?? []).map((u) => ({ ...u }));
  const statements: string[] = [];

  return {
    statements,
    async query(sql: string, params: unknown[] = []) {
      statements.push(sql);

      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rowCount: 0, rows: [] };
      }

      if (sql.includes('"user_data"')) {
        return { rowCount: accountRows.length, rows: accountRows };
      }

      if (isRoleUpdateSql(sql)) {
        const id = Number(params[0]);
        const role = String(params[1]);
        const target = users.find((u) => u.id === id);
        if (target) target.role = role;
        return { rowCount: target ? 1 : 0, rows: [] };
      }

      // Post-update re-read: WHERE "id" = $1 (not address lookup)
      if (/FROM\s+"user"[\s\S]*WHERE\s+"id"\s*=/.test(sql)) {
        const id = Number(params[0]);
        let row = users.find((u) => u.id === id);
        if (row && options.userAfterUpdate) {
          row = { ...row, ...options.userAfterUpdate };
        }
        return row
          ? { rowCount: 1, rows: [{ id: row.id, address: row.address, role: row.role }] }
          : { rowCount: 0, rows: [] };
      }

      if (/FROM\s+"user"/.test(sql)) {
        const addr = String(params[0] ?? '');
        const matched = users.filter((u) => u.address.toLowerCase() === addr.toLowerCase());
        return { rowCount: matched.length, rows: matched };
      }

      return { rowCount: 0, rows: [] };
    },
  };
}

function defaultAccount(overrides: Partial<AccountRow> = {}): AccountRow {
  return {
    id: ACCOUNT_ID,
    mail: EXPECTED_MAIL,
    status: 'Active',
    riskStatus: null,
    ...overrides,
  };
}

function defaultUser(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: 42,
    address: WALLET_ADDRESS,
    role: 'User',
    status: 'NA',
    userDataId: ACCOUNT_ID,
    ...overrides,
  };
}

function hadRoleUpdate(client: FakeClient): boolean {
  return client.statements.some(isRoleUpdateSql);
}

describe('set-dev-support-role-joshua ops script', () => {
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  describe('satisfiesSupport (role hierarchy for UserRole.SUPPORT)', () => {
    it.each(['Support', 'Compliance', 'Admin', 'SuperAdmin'] as const)('%s satisfies Support access', (role) => {
      expect(satisfiesSupport(role)).toBe(true);
    });

    it.each(['User', 'Account', 'Debug', 'RealUnit', 'Marketing'] as const)(
      '%s does not satisfy Support access',
      (role) => {
        expect(satisfiesSupport(role)).toBe(false);
      },
    );
  });

  describe('findBlockingStatus', () => {
    it('returns null when user and account are active', () => {
      expect(findBlockingStatus({ status: 'NA' }, { status: 'Active', riskStatus: null })).toBeNull();
    });

    it.each(['Blocked', 'Deleted'] as const)('blocks on user.status=%s', (status) => {
      expect(findBlockingStatus({ status }, { status: 'Active', riskStatus: null })).toEqual({
        field: 'user.status',
        value: status,
      });
    });

    it.each(['Blocked', 'Deactivated'] as const)('blocks on user_data.status=%s', (status) => {
      expect(findBlockingStatus({ status: 'NA' }, { status, riskStatus: null })).toEqual({
        field: 'user_data.status',
        value: status,
      });
    });

    it.each(['Blocked', 'Suspicious'] as const)('blocks on user_data.riskStatus=%s', (riskStatus) => {
      expect(findBlockingStatus({ status: 'NA' }, { status: 'Active', riskStatus })).toEqual({
        field: 'user_data.riskStatus',
        value: riskStatus,
      });
    });
  });

  describe('maskAddress', () => {
    it('masks the middle of a full address', () => {
      expect(maskAddress(WALLET_ADDRESS)).toBe('0xB6cA…69Ae8');
    });
  });

  describe('run()', () => {
    it('updates role from User when account and user are active', async () => {
      const client = createFakeClient({
        accountRows: [defaultAccount()],
        userRows: [defaultUser({ role: 'User' })],
      });

      const result = await run(client);

      expect(result.status).toBe('role updated');
      expect(result.before).toEqual({ id: 42, address: maskAddress(WALLET_ADDRESS), role: 'User' });
      expect(result.after).toEqual({ id: 42, address: maskAddress(WALLET_ADDRESS), role: TARGET_ROLE });
      expect(hadRoleUpdate(client)).toBe(true);
    });

    it('does not UPDATE when role is already Support', async () => {
      const client = createFakeClient({
        accountRows: [defaultAccount()],
        userRows: [defaultUser({ role: 'Support' })],
      });

      const result = await run(client);

      expect(result.status).toBe('already Support, no change');
      expect(hadRoleUpdate(client)).toBe(false);
    });

    it.each(['Compliance', 'Admin', 'SuperAdmin'] as const)('does not downgrade when role is %s', async (role) => {
      const client = createFakeClient({
        accountRows: [defaultAccount()],
        userRows: [defaultUser({ role })],
      });

      const result = await run(client);

      expect(result.status).toBe('role already satisfies Support, no change');
      expect(hadRoleUpdate(client)).toBe(false);
    });

    it.each(['Blocked', 'Deleted'] as const)('does not UPDATE when user.status is %s', async (status) => {
      const client = createFakeClient({
        accountRows: [defaultAccount()],
        userRows: [defaultUser({ status })],
      });

      const result = await run(client);

      expect(result.status).toBe('nothing to do: account or user is blocked for staff access');
      expect(result.blockedField).toBe('user.status');
      expect(result.blockedValue).toBe(status);
      expect(hadRoleUpdate(client)).toBe(false);
    });

    it.each(['Blocked', 'Deactivated'] as const)('does not UPDATE when user_data.status is %s', async (status) => {
      const client = createFakeClient({
        accountRows: [defaultAccount({ status })],
        userRows: [defaultUser()],
      });

      const result = await run(client);

      expect(result.status).toBe('nothing to do: account or user is blocked for staff access');
      expect(result.blockedField).toBe('user_data.status');
      expect(result.blockedValue).toBe(status);
      expect(hadRoleUpdate(client)).toBe(false);
    });

    it.each(['Blocked', 'Suspicious'] as const)(
      'does not UPDATE when user_data.riskStatus is %s',
      async (riskStatus) => {
        const client = createFakeClient({
          accountRows: [defaultAccount({ riskStatus })],
          userRows: [defaultUser()],
        });

        const result = await run(client);

        expect(result.status).toBe('nothing to do: account or user is blocked for staff access');
        expect(result.blockedField).toBe('user_data.riskStatus');
        expect(result.blockedValue).toBe(riskStatus);
        expect(hadRoleUpdate(client)).toBe(false);
      },
    );

    it('does not UPDATE when the wallet user does not exist', async () => {
      const client = createFakeClient({
        accountRows: [defaultAccount()],
        userRows: [],
      });

      const result = await run(client);

      expect(result.status).toBe('nothing to do: wallet user not found');
      expect(hadRoleUpdate(client)).toBe(false);
    });

    it('throws and does not UPDATE when the wallet belongs to a foreign userDataId', async () => {
      const client = createFakeClient({
        accountRows: [defaultAccount()],
        userRows: [defaultUser({ userDataId: 9999 })],
      });

      await expect(run(client)).rejects.toThrow(/foreign user/);
      expect(hadRoleUpdate(client)).toBe(false);
    });

    it('throws and does not UPDATE when the user_data row is missing', async () => {
      const client = createFakeClient({
        accountRows: [],
        userRows: [defaultUser()],
      });

      await expect(run(client)).rejects.toThrow(/exactly one user_data row/);
      expect(hadRoleUpdate(client)).toBe(false);
    });

    it('throws and does not UPDATE when the account mail does not match', async () => {
      const client = createFakeClient({
        accountRows: [defaultAccount({ mail: 'other@example.com' })],
        userRows: [defaultUser()],
      });

      await expect(run(client)).rejects.toThrow(/does not match the expected mail/);
      expect(hadRoleUpdate(client)).toBe(false);
    });

    it('finds the wallet when stored address casing differs (case-insensitive lookup)', async () => {
      const client = createFakeClient({
        accountRows: [defaultAccount()],
        userRows: [defaultUser({ address: WALLET_ADDRESS.toLowerCase(), role: 'User' })],
      });

      const result = await run(client);

      expect(result.status).toBe('role updated');
      expect(hadRoleUpdate(client)).toBe(true);
      const addressLookup = client.statements.find(
        (s) => /FROM\s+"user"/.test(s) && /LOWER\s*\(\s*"address"\s*\)/.test(s),
      );
      // The fake client compares case-insensitively itself, so existence proves nothing:
      // pin that the SQL lowers BOTH sides, which is what makes the real lookup case-insensitive.
      expect(addressLookup).toMatch(/LOWER\s*\(\s*"address"\s*\)\s*=\s*LOWER\s*\(\s*\$1\s*\)/);
    });
  });

  describe('main() environment gate', () => {
    const originalEnv = process.env.ENVIRONMENT;

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.ENVIRONMENT;
      } else {
        process.env.ENVIRONMENT = originalEnv;
      }
    });

    it('skips outside dev without throwing and without constructing a pg client', async () => {
      process.env.ENVIRONMENT = 'prd';

      await jest.isolateModulesAsync(async () => {
        const Client = jest.fn();
        jest.doMock('pg', () => ({ Client }));

        // Re-require so the mock is active when main lazy-requires pg
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const isolated = require('../../../../migration/ops/set-dev-support-role-joshua.js');
        const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);

        await expect(isolated.main()).resolves.toBeUndefined();

        expect(Client).not.toHaveBeenCalled();
        expect(err).toHaveBeenCalledWith(
          'skipping: ENVIRONMENT=prd is not dev, this one-shot DEV ops script does nothing here',
        );

        err.mockRestore();
      });
    });
  });
});
