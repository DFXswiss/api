const ACCOUNT_ID = 4770;
const EXPECTED_MAIL = 'joshua.krueger@dfx.swiss';
// Verified via GET /v2/user on DEV: account 4770 has exactly one (active) address, this one.
const WALLET_ADDRESS = '0xB6cA05F0e3e71B1C5568BD423A6682dc78469Ae8';
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

/**
 * Decision logic for the one-shot DEV ops role update.
 * @param {{ query: Function }} client already-connected client-like object (only query is used)
 * @returns {Promise<object>} result with status and optional before/after/blockedField
 */
async function run(client) {
  await client.query('BEGIN');

  try {
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
      const result = {
        status: 'nothing to do: wallet user not found',
        message:
          'Wallet ' +
          maskAddress(WALLET_ADDRESS) +
          ' hat auf DEV keinen User. Einmal mit dieser Wallet auf dev.app.dfx.swiss ' +
          'einloggen (das legt den User an), danach dieses Skript erneut ausführen.',
      };
      console.warn(JSON.stringify(result));
      return result;
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
      const result = {
        status: 'already Support, no change',
        user: before,
      };
      console.log(JSON.stringify(result));
      return result;
    }

    if (satisfiesSupport(currentRole)) {
      await client.query('COMMIT');
      const result = {
        status: 'role already satisfies Support, no change',
        user: before,
      };
      console.log(JSON.stringify(result));
      return result;
    }

    // UserActiveGuard would still 403 after a role-only update — skip write, leave statuses alone.
    const blocked = findBlockingStatus(user, account);
    if (blocked) {
      await client.query('COMMIT');
      const result = {
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
      };
      console.warn(JSON.stringify(result));
      return result;
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

    const result = {
      status: 'role updated',
      before,
      after,
    };
    console.log(JSON.stringify(result));
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Keep the original error; a failed ROLLBACK must not replace it.
    }
    throw error;
  }
}

async function main() {
  // Merged images run this CMD in every environment. Outside DEV: skip with exit 0 so the API
  // still boots (never open a DB connection). Fail closed only for true anomalies while on DEV.
  if (process.env.ENVIRONMENT !== 'dev') {
    console.error(
      'skipping: ENVIRONMENT=' +
        String(process.env.ENVIRONMENT) +
        ' is not dev, this one-shot DEV ops script does nothing here',
    );
    return;
  }

  // Lazy require: non-dev skip path must not load or connect pg.
  const { Client } = require('pg');

  const client = new Client({
    host: process.env.SQL_HOST,
    port: Number(process.env.SQL_PORT),
    user: process.env.SQL_USERNAME,
    password: process.env.SQL_PASSWORD,
    database: process.env.SQL_DB,
  });

  await client.connect();

  try {
    await run(client);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

module.exports = {
  ACCOUNT_ID,
  EXPECTED_MAIL,
  WALLET_ADDRESS,
  TARGET_ROLE,
  satisfiesSupport,
  findBlockingStatus,
  maskAddress,
  run,
  main,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
