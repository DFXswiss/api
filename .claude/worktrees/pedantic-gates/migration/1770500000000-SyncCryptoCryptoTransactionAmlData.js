/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Sync transaction AML data for 114 CryptoCrypto BuyCrypto records.
 *
 * Same root cause as migration 1768900000000-SyncTransactionAmlData:
 * BuyCrypto was completed (isComplete=true) before postProcessing could
 * set the transaction-level fields. All 115 records have bc.amlCheck='Pass'
 * but t.amlCheck/eventDate/amountInChf/assets are NULL.
 *
 * TX 278332 excluded: stuck PaymentLink transaction (isConfirmed=false, status=Created).
 *
 * All affected transactions:
 * - Account: userDataId 259962 (KycFile 3767)
 * - Created: 2025-12-30, batch-completed: 2025-12-31
 * - Type: CryptoCrypto (all output to BTC)
 * - Total volume: ~1,536 CHF (excl. TX 278332 which is stuck in Created status)
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class SyncCryptoCryptoTransactionAmlData1770500000000 {
  name = 'SyncCryptoCryptoTransactionAmlData1770500000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    // Hardcoded transaction data from production DB query (2026-02-06)
    // Format: [txId, amountInChf (null if unknown), assets, eventDate]
    const transactions = [
      [261949, 0.86, 'BTC-BTC', '2025-12-30T08:41:15.583Z'],
      [261950, 1.72, 'BTC-BTC', '2025-12-30T14:08:50.550Z'],
      [262020, 2.16, 'XMR-BTC', '2025-12-30T14:08:30.266Z'],
      [262028, 7.18, 'XMR-BTC', '2025-12-30T14:08:33.106Z'],
      [262143, 2.05, 'XMR-BTC', '2025-12-30T14:08:32.363Z'],
      [262335, 50.55, 'BTC-BTC', '2025-12-30T14:08:31.646Z'],
      [262746, 5.77, 'BTC-BTC', '2025-12-30T14:08:30.973Z'],
      [263544, 42.8, 'BTC-BTC', '2025-12-30T14:08:43.990Z'],
      [263545, 18.87, 'BTC-BTC', '2025-12-30T14:08:38.496Z'],
      [264117, 18.27, 'BTC-BTC', '2025-12-30T14:08:52.546Z'],
      [264418, 15.73, 'BTC-BTC', '2025-12-30T14:09:10.426Z'],
      [264422, 41.4, 'BTC-BTC', '2025-12-30T14:09:03.110Z'],
      [267046, 22.71, 'BTC-BTC', '2025-12-30T14:08:34.233Z'],
      [267066, 11.65, 'BTC-BTC', '2025-12-30T14:08:58.240Z'],
      [267161, 14.94, 'BTC-BTC', '2025-12-30T14:09:00.486Z'],
      [267162, 10.32, 'BTC-BTC', '2025-12-30T14:08:35.756Z'],
      [267170, 26.01, 'BTC-BTC', '2025-12-30T14:08:55.476Z'],
      [267911, 3.79, 'BTC-BTC', '2025-12-30T14:09:23.390Z'],
      [268141, 10.42, 'BTC-BTC', '2025-12-30T14:09:16.463Z'],
      [268507, 7.14, 'BTC-BTC', '2025-12-30T14:09:17.243Z'],
      [268887, 7.39, 'BTC-BTC', '2025-12-30T14:09:08.140Z'],
      [269574, 1.73, 'USDT-BTC', '2025-12-30T14:09:12.926Z'],
      [271252, 2.1, 'BTC-BTC', '2025-12-30T14:09:18.140Z'],
      [271665, 36.98, 'BTC-BTC', '2025-12-30T14:09:24.270Z'],
      [271670, 1.65, 'USDT-BTC', '2025-12-30T14:09:18.883Z'],
      [272117, 15.04, 'USDT-BTC', '2025-12-30T14:09:19.140Z'],
      [273008, 2.51, 'XMR-BTC', '2025-12-30T14:09:15.356Z'],
      [273105, 8.43, 'BTC-BTC', '2025-12-30T14:09:13.386Z'],
      [273395, 23.57, 'BTC-BTC', '2025-12-30T14:08:52.906Z'],
      [273417, 5.68, 'XMR-BTC', '2025-12-30T14:08:58.633Z'],
      [273464, 40.26, 'BTC-BTC', '2025-12-30T14:09:21.756Z'],
      [273724, 8.27, 'BTC-BTC', '2025-12-30T14:09:11.770Z'],
      [273793, 1.06, 'USDT-BTC', '2025-12-30T14:09:09.263Z'],
      [274027, 19.04, 'BTC-BTC', '2025-12-30T14:09:02.880Z'],
      [274062, 2.64, 'BTC-BTC', '2025-12-30T14:08:59.423Z'],
      [274075, 22.13, 'BTC-BTC', '2025-12-30T14:09:09.583Z'],
      [274303, 3.57, 'BTC-BTC', '2025-12-30T14:08:53.306Z'],
      [274360, 10.75, 'USDT-BTC', '2025-12-30T14:08:58.990Z'],
      [274625, 5.41, 'USDT-BTC', '2025-12-30T14:09:22.010Z'],
      [274626, 13.63, 'USDT-BTC', '2025-12-30T14:09:12.246Z'],
      [274657, 3.45, 'BTC-BTC', '2025-12-30T14:09:10.126Z'],
      [274964, 9.74, 'BTC-BTC', '2025-12-30T14:08:29.593Z'],
      [275078, 15.74, 'BTC-BTC', '2025-12-30T14:08:44.456Z'],
      [275079, 19.24, 'BTC-BTC', '2025-12-30T14:08:50.960Z'],
      [275274, 10.74, 'BTC-BTC', '2025-12-30T14:08:30.643Z'],
      [275295, 3.1, 'BTC-BTC', '2025-12-30T14:08:33.460Z'],
      [275367, 15.56, 'USDT-BTC', '2025-12-30T14:08:32.766Z'],
      [275385, 1.55, 'BTC-BTC', '2025-12-30T14:08:32.040Z'],
      [275386, 15.47, 'USDT-BTC', '2025-12-30T14:08:31.316Z'],
      [275388, 9.43, 'BTC-BTC', '2025-12-30T14:08:29.896Z'],
      [275555, 1.55, 'BTC-BTC', '2025-12-30T14:08:49.826Z'],
      [275622, 8.63, 'BTC-BTC', '2025-12-30T14:09:00.223Z'],
      [275650, 1.53, 'BTC-BTC', '2025-12-30T14:08:34.576Z'],
      [275669, 9.32, 'USDT-BTC', '2025-12-30T14:08:54.396Z'],
      [275692, 1.51, 'BTC-BTC', '2025-12-30T14:08:53.680Z'],
      [275838, 31.86, 'BTC-BTC', '2025-12-30T14:08:38.976Z'],
      [275872, 3.05, 'BTC-BTC', '2025-12-30T14:08:37.966Z'],
      [275932, 8.13, 'BTC-BTC', '2025-12-30T14:08:33.813Z'],
      [275943, 11.4, 'BTC-BTC', '2025-12-30T14:08:57.580Z'],
      [276247, 13.92, 'BTC-BTC', '2025-12-30T14:09:19.453Z'],
      [276249, 6.8, 'BTC-BTC', '2025-12-30T14:09:01.566Z'],
      [276257, 21.46, 'BTC-BTC', '2025-12-30T14:09:03.703Z'],
      [276464, 3.16, 'BTC-BTC', '2025-12-30T14:09:22.546Z'],
      [276726, 11.66, 'BTC-BTC', '2025-12-30T14:09:16.210Z'],
      [276963, 11.99, 'BTC-BTC', '2025-12-30T14:09:15.980Z'],
      [277199, 1.61, 'BTC-BTC', '2025-12-30T14:09:07.830Z'],
      [277200, 9.44, 'BTC-BTC', '2025-12-30T14:09:02.636Z'],
      [277244, 9.64, 'BTC-BTC', '2025-12-30T14:09:19.723Z'],
      [277563, 13.62, 'BTC-BTC', '2025-12-30T14:09:04.803Z'],
      [277694, 6.74, 'BTC-BTC', '2025-12-30T14:09:19.960Z'],
      [277784, 3.61, 'BTC-BTC', '2025-12-30T14:09:01.870Z'],
      [277785, 12.78, 'BTC-BTC', '2025-12-30T14:09:14.280Z'],
      [277786, 28.41, 'BTC-BTC', '2025-12-30T14:09:22.850Z'],
      [277993, 9.03, 'BTC-BTC', '2025-12-30T14:08:56.210Z'],
      [278009, 3.02, 'BTC-BTC', '2025-12-30T14:08:51.383Z'],
      [278078, 2.46, 'BTC-BTC', '2025-12-30T14:09:00.743Z'],
      [278165, 3.35, 'BTC-BTC', '2025-12-30T14:09:05.253Z'],
      [278346, 9.04, 'BTC-BTC', '2025-12-30T14:09:02.110Z'],
      [278381, 5.02, 'BTC-BTC', '2025-12-30T14:09:14.563Z'],
      [278392, 6.24, 'BTC-BTC', '2025-12-30T14:09:23.136Z'],
      [278719, 1.43, 'BTC-BTC', '2025-12-30T14:08:56.830Z'],
      [279171, 10.11, 'USDT-BTC', '2025-12-30T14:08:51.740Z'],
      [279375, 3.11, 'BTC-BTC', '2025-12-30T14:09:00.990Z'],
      [280273, 20.76, 'BTC-BTC', '2025-12-30T14:08:54.060Z'],
      [280332, 21.15, 'BTC-BTC', '2025-12-30T14:09:10.706Z'],
      [281625, 6.97, 'BTC-BTC', '2025-12-30T14:09:08.863Z'],
      [281751, 8.82, 'BTC-BTC', '2025-12-30T14:08:52.146Z'],
      [282365, 8.5, 'BTC-BTC', '2025-12-30T14:08:59.890Z'],
      [282608, 24.19, 'BTC-BTC', '2025-12-30T14:09:09.870Z'],
      [283945, 28.6, 'BTC-BTC', '2025-12-30T14:09:01.290Z'],
      [283977, 0.9, 'BTC-BTC', '2025-12-30T14:09:03.360Z'],
      [284056, 10.75, 'BTC-BTC', '2025-12-30T14:09:22.283Z'],
      [284208, 20.36, 'BTC-BTC', '2025-12-30T14:09:12.606Z'],
      [284209, 14.45, 'BTC-BTC', '2025-12-30T14:09:15.733Z'],
      [284453, 9.48, 'USDT-BTC', '2025-12-30T14:09:07.546Z'],
      [284460, 10.23, 'USDT-BTC', '2025-12-30T14:09:02.366Z'],
      [284791, 22.94, 'BTC-BTC', '2025-12-30T14:09:06.803Z'],
      [284874, 7.49, 'BTC-BTC', '2025-12-30T14:09:20.566Z'],
      [284876, 10.36, 'BTC-BTC', '2025-12-30T14:09:13.753Z'],
      [285012, 27.13, 'BTC-BTC', '2025-12-30T14:09:16.726Z'],
      [285085, 6.57, 'BTC-BTC', '2025-12-30T14:09:23.676Z'],
      [285169, 37.02, 'BTC-BTC', '2025-12-30T14:09:18.640Z'],
      [285420, 31.06, 'BTC-BTC', '2025-12-30T14:09:17.516Z'],
      [285461, 6.81, 'BTC-BTC', '2025-12-30T14:09:08.390Z'],
      [285583, 31.95, 'BTC-BTC', '2025-12-30T14:09:07.103Z'],
      [285667, 6.45, 'BTC-BTC', '2025-12-30T14:09:20.973Z'],
      [286099, 30.99, 'BTC-BTC', '2025-12-30T14:09:13.986Z'],
      [286517, 16.24, 'BTC-BTC', '2025-12-30T14:09:16.980Z'],
      [286708, 31.16, 'BTC-BTC', '2025-12-30T14:09:23.963Z'],
      [287341, 22.64, 'BTC-BTC', '2025-12-30T14:09:21.233Z'],
      [288951, 28.7, 'BTC-BTC', '2025-12-30T14:09:14.820Z'],
      [289695, 23.74, 'BTC-BTC', '2025-12-30T14:09:17.770Z'],
      [290951, 45.64, 'BTC-BTC', '2025-12-30T14:09:21.493Z'],
      [292062, 29.3, 'BTC-BTC', '2025-12-30T14:09:15.080Z'],
    ];

    console.log('=== Sync CryptoCrypto Transaction AML Data ===\n');
    console.log(`Transactions to fix: ${transactions.length}`);

    // Verify current state - all should have NULL amlCheck
    const currentState = await queryRunner.query(`
      SELECT COUNT(*) as count
      FROM dbo.[transaction]
      WHERE id IN (${transactions.map((t) => t[0]).join(',')})
        AND amlCheck IS NULL
    `);

    const nullCount = currentState[0].count;
    console.log(`Verified: ${nullCount}/${transactions.length} have amlCheck=NULL\n`);

    if (nullCount !== transactions.length) {
      const alreadyFixed = await queryRunner.query(`
        SELECT id, amlCheck
        FROM dbo.[transaction]
        WHERE id IN (${transactions.map((t) => t[0]).join(',')})
          AND amlCheck IS NOT NULL
      `);
      console.log(`WARNING: ${alreadyFixed.length} transactions already have amlCheck set:`);
      for (const tx of alreadyFixed) {
        console.log(`  - Transaction ${tx.id}: amlCheck=${tx.amlCheck}`);
      }
    }

    // Update each transaction with hardcoded values
    let updated = 0;

    for (const [txId, amountInChf, assets, eventDate] of transactions) {
      const result = await queryRunner.query(
        `
        UPDATE dbo.[transaction]
        SET
          amlCheck = 'Pass',
          assets = '${assets}',
          amountInChf = ${amountInChf === null ? 'NULL' : amountInChf},
          highRisk = 0,
          eventDate = '${eventDate}',
          amlType = 'CryptoCrypto',
          updated = GETDATE()
        WHERE id = ${txId}
          AND amlCheck IS NULL
      `,
      );

      if (result?.rowsAffected?.[0] > 0) updated++;
    }

    console.log(`Updated ${updated}/${transactions.length} transactions\n`);

    // Verify final state
    const finalState = await queryRunner.query(`
      SELECT COUNT(*) as count, SUM(amountInChf) as totalChf
      FROM dbo.[transaction]
      WHERE id IN (${transactions.map((t) => t[0]).join(',')})
        AND amlCheck = 'Pass'
    `);

    console.log(`=== Verification ===`);
    console.log(`  Transactions with amlCheck=Pass: ${finalState[0].count}`);
    console.log(`  Total volume: ${finalState[0].totalChf} CHF`);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    const txIds = [
      261949, 261950, 262020, 262028, 262143, 262335, 262746, 263544, 263545, 264117, 264418, 264422, 267046, 267066,
      267161, 267162, 267170, 267911, 268141, 268507, 268887, 269574, 271252, 271665, 271670, 272117, 273008, 273105,
      273395, 273417, 273464, 273724, 273793, 274027, 274062, 274075, 274303, 274360, 274625, 274626, 274657, 274964,
      275078, 275079, 275274, 275295, 275367, 275385, 275386, 275388, 275555, 275622, 275650, 275669, 275692, 275838,
      275872, 275932, 275943, 276247, 276249, 276257, 276464, 276726, 276963, 277199, 277200, 277244, 277563, 277694,
      277784, 277785, 277786, 277993, 278009, 278078, 278165, 278346, 278381, 278392, 278719, 279171, 279375, 280273,
      280332, 281625, 281751, 282365, 282608, 283945, 283977, 284056, 284208, 284209, 284453, 284460, 284791, 284874,
      284876, 285012, 285085, 285169, 285420, 285461, 285583, 285667, 286099, 286517, 286708, 287341, 288951, 289695,
      290951, 292062,
    ];

    await queryRunner.query(`
      UPDATE dbo.[transaction]
      SET
        amlCheck = NULL,
        assets = NULL,
        amountInChf = NULL,
        highRisk = NULL,
        eventDate = NULL,
        amlType = NULL,
        updated = GETDATE()
      WHERE id IN (${txIds.join(',')})
    `);
  }
};
