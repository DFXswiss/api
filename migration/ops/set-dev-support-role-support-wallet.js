const { Client } = require('pg');

const ACCOUNT_ID = 4770;
const EXPECTED_MAIL = 'joshua.krueger@dfx.swiss';
// This address currently has no user on DEV (verified via GET /v2/user: account 4770 has
// exactly one active address, and it is a different one). This script deliberately does not
// create a user — signature and wallet invariants belong in the login path. It takes effect
// once this wallet has logged in once on dev.app.dfx.swiss.
const WALLET_ADDRESS = '0x3e0004935eAD42cefB1ecf461847bdB1591f337f';
const TARGET_ROLE = 'Support';

// Mirrors UserActiveGuard defaults (user-active.guard.ts) — values that yield 403 on staff endpoints.
const BLOCKED_USER_STATUS = ['Blocked', 'Deleted'];
const BLOCKED_ACCOUNT_STATUS = ['Blocked', 'Deactivated'];
const BLOCKED_RISK_STATUS = ['Blocked', 'Suspicious'];

// Roles that already satisfy RoleGuard(UserRole.SUPPORT) via additionalRoles in role.guard.ts.
// Do not downgrade these.
function satisfiesSupport(role) {
  return role === 'Support' || role === 'Compliance' || role === 'Admin' || role === 'SuperAdmin';
}

function maskAddress(address) {
  if (!address || address.length < 12) return '***';
  return address.slice(0, 6) + '\u2026' + address.slice(-5);
}

function sanitizedUser(row) {
  return {
    id: row.id,
    address: maskAddress(row.address),
    role: row.role,
  };
}

function findBlockingStatus(user, account) {
  if (BLOCKED_USER_STATUS.includes(user.status)) {
    return { field: 'user.status', value: user.status };
  }
  if (BLOCKED_ACCOUNT_STATUS.includes(account.status)) {
    return { field: 'user_data.status', value: account.status };
  }
  if (account.riskStatus && BLOCKED_RISK_STATUS.includes(account.riskStatus)) {
    return { field: 'user_data.riskStatus', value: account.riskStatus };
  }
  return null;
}

async function main() {
  if (process.env.ENVIRONMENT !== 'dev') throw new Error('Refusing to run outside the DEV environment');

  const client = new Client({
    host: process.env.SQL_HOST,
    port: Number(process.env.SQL_PORT),
    user: process.env.SQL_USERNAME,
    password: process.env.SQL_PASSWORD,
    database: process.env.SQL_DB,
  });

  await client.connect();

  try {
    await client.query('BEGIN');

    const accountResult = await client.query(
      `SELECT "id", "mail", "status", "riskStatus"
       FROM "user_data"
       WHERE "id" = $1
       FOR UPDATE`,
      [ACCOUNT_ID],
    );

    if (accountResult.rowCount !== 1) {
      throw new Error('Expected exactly one user_data row for account ' + ACCOUNT_ID);
    }

    const account = accountResult.rows.at(0);
    if (account.mail?.toLowerCase() !== EXPECTED_MAIL) {
      throw new Error('Account ' + ACCOUNT_ID + ' does not match the expected mail');
    }

    const userResult = await client.query(
      `SELECT "id", "address", "role", "status", "userDataId"
       FROM "user"
       WHERE LOWER("address") = LOWER($1)
       FOR UPDATE`,
      [WALLET_ADDRESS],
    );

    // Missing wallet user is "nothing to do", not a hard failure: this script is chained in the
    // container CMD before the API starts. Exit 1 would crash-loop DEV (likely first-run state
    // before the wallet has ever logged in). Real anomalies (mismatch / foreign ownership /
    // ambiguous rows) still fail closed with exit 1 below.
    if (userResult.rowCount === 0) {
      await client.query('COMMIT');
      console.warn(
        JSON.stringify({
          status: 'nothing to do: wallet user not found',
          message:
            'Wallet ' +
            maskAddress(WALLET_ADDRESS) +
            ' hat auf DEV keinen User. Einmal mit dieser Wallet auf dev.app.dfx.swiss ' +
            'einloggen (das legt den User an), danach dieses Skript erneut ausführen.',
        }),
      );
      return;
    }

    if (userResult.rowCount !== 1) {
      throw new Error('Expected exactly one user for wallet ' + maskAddress(WALLET_ADDRESS));
    }

    const user = userResult.rows.at(0);

    if (Number(user.userDataId) !== ACCOUNT_ID) {
      throw new Error(
        'Wallet ' +
          maskAddress(WALLET_ADDRESS) +
          ' belongs to userDataId=' +
          user.userDataId +
          ', expected ' +
          ACCOUNT_ID +
          ' — refusing to take over a foreign user',
      );
    }

    const before = sanitizedUser(user);
    const currentRole = user.role;

    if (currentRole === TARGET_ROLE) {
      await client.query('COMMIT');
      console.log(
        JSON.stringify({
          status: 'already Support, no change',
          user: before,
        }),
      );
      return;
    }

    if (satisfiesSupport(currentRole)) {
      await client.query('COMMIT');
      console.log(
        JSON.stringify({
          status: 'role already satisfies Support, no change',
          user: before,
        }),
      );
      return;
    }

    // UserActiveGuard would still 403 after a role-only update — skip write, leave statuses alone.
    const blocked = findBlockingStatus(user, account);
    if (blocked) {
      await client.query('COMMIT');
      console.warn(
        JSON.stringify({
          status: 'nothing to do: account or user is blocked for staff access',
          user: before,
          blockedField: blocked.field,
          blockedValue: blocked.value,
          message:
            'Role not updated because ' +
            blocked.field +
            '=' +
            blocked.value +
            ' would keep Support endpoints returning 403. Status values are left unchanged.',
        }),
      );
      return;
    }

    await client.query(
      `UPDATE "user"
       SET "role" = $2,
           "updated" = NOW()
       WHERE "id" = $1`,
      [user.id, TARGET_ROLE],
    );

    const afterResult = await client.query(
      `SELECT "id", "address", "role"
       FROM "user"
       WHERE "id" = $1`,
      [user.id],
    );

    if (afterResult.rowCount !== 1) {
      throw new Error('User disappeared after role update');
    }

    const after = sanitizedUser(afterResult.rows.at(0));

    await client.query('COMMIT');

    console.log(
      JSON.stringify({
        status: 'role updated',
        before,
        after,
      }),
    );
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Keep the original error; a failed ROLLBACK must not replace it.
    }
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
