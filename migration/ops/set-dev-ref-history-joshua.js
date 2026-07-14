const { Client } = require('pg');

const ACCOUNT_ID = 4770;
const EXPECTED_MAIL = 'joshua.krueger@dfx.swiss';
const MINIMUM_BUY_VOLUME = 1;

function volumes(row) {
  return {
    id: row.id,
    buyVolume: Number(row.buyVolume),
    annualBuyVolume: Number(row.annualBuyVolume),
    monthlyBuyVolume: Number(row.monthlyBuyVolume),
  };
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
      `SELECT "id", "mail", "kycLevel", "tradeApprovalDate",
              "buyVolume", "annualBuyVolume", "monthlyBuyVolume"
       FROM "user_data"
       WHERE "id" = $1
       FOR UPDATE`,
      [ACCOUNT_ID],
    );

    if (accountResult.rowCount !== 1) throw new Error(`Expected exactly one user_data row for ${ACCOUNT_ID}`);

    const account = accountResult.rows[0];
    if (account.mail?.toLowerCase() !== EXPECTED_MAIL) {
      throw new Error(`Account ${ACCOUNT_ID} does not match the expected mail`);
    }
    if (Number(account.kycLevel) < 50) throw new Error(`Account ${ACCOUNT_ID} is below KYC level 50`);
    if (!account.tradeApprovalDate) throw new Error(`Account ${ACCOUNT_ID} has no trade approval date`);

    const usersResult = await client.query(
      `SELECT "id", "buyVolume", "annualBuyVolume", "monthlyBuyVolume"
       FROM "user"
       WHERE "userDataId" = $1
       ORDER BY "id"
       FOR UPDATE`,
      [ACCOUNT_ID],
    );

    if (usersResult.rowCount < 1) throw new Error(`Account ${ACCOUNT_ID} has no linked wallet user`);

    const before = {
      account: volumes(account),
      users: usersResult.rows.map(volumes),
    };

    await client.query(
      `UPDATE "user_data"
       SET "buyVolume" = GREATEST("buyVolume", $2),
           "annualBuyVolume" = GREATEST("annualBuyVolume", $2),
           "monthlyBuyVolume" = GREATEST("monthlyBuyVolume", $2),
           "updated" = NOW()
       WHERE "id" = $1`,
      [ACCOUNT_ID, MINIMUM_BUY_VOLUME],
    );

    await client.query(
      `UPDATE "user"
       SET "buyVolume" = GREATEST("buyVolume", $2),
           "annualBuyVolume" = GREATEST("annualBuyVolume", $2),
           "monthlyBuyVolume" = GREATEST("monthlyBuyVolume", $2),
           "updated" = NOW()
       WHERE "userDataId" = $1`,
      [ACCOUNT_ID, MINIMUM_BUY_VOLUME],
    );

    const afterAccount = await client.query(
      `SELECT "id", "buyVolume", "annualBuyVolume", "monthlyBuyVolume"
       FROM "user_data"
       WHERE "id" = $1`,
      [ACCOUNT_ID],
    );
    const afterUsers = await client.query(
      `SELECT "id", "buyVolume", "annualBuyVolume", "monthlyBuyVolume"
       FROM "user"
       WHERE "userDataId" = $1
       ORDER BY "id"`,
      [ACCOUNT_ID],
    );

    await client.query('COMMIT');

    console.log(
      JSON.stringify({
        accountId: ACCOUNT_ID,
        mail: EXPECTED_MAIL,
        before,
        after: {
          account: volumes(afterAccount.rows[0]),
          users: afterUsers.rows.map(volumes),
        },
      }),
    );
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
