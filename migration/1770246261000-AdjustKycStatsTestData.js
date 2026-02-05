/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Adjust KYC stats test data to match target values from PRD compliance report.
 *
 * Use this migration after a fresh PRD import to correct the statistics.
 *
 * Target values (from PRD compliance report 2026-02-04):
 *   2021: newFiles=250, closed=0, endCount=250, highestFileNr=250
 *   2022: newFiles=1947, closed=5, endCount=2192, highestFileNr=2197
 *   2023: newFiles=509, closed=2127, endCount=574, highestFileNr=2706
 *   2024: newFiles=611, reopened=87, closed=253, endCount=1019, highestFileNr=3317
 *   2025: newFiles=2022, reopened=8, closed=2, endCount=3047, highestFileNr=5339
 *
 * PRD state vs target (as of 2026-02-04):
 *   - 2021: 229 newFiles -> 250 (need +21, kycFileId 230-250 belong to 2021)
 *   - 2022: 1968 newFiles -> 1947 (need -21), 0 closed -> 5 (need +5)
 *   - 2023: 2049 closed -> 2127 (need +78, plus 5 moved to 2022 = +83, via 83 new closures)
 *
 * Data source verification:
 *   - Jan 2024 CSV: DFX Kundenliste_SRO inkl. Kypto Stichtag 15. Januar 2024
 *   - 83 records identified as "geschlossen" in CSV but amlListExpiredDate=NULL in PRD
 *   - 23 of these have amlListReactivatedDate (~2024-02-02) - were reopened after closure
 *   - Post-reactivation transactions verified and expected (not a concern)
 *   - 5 business accounts (kycFileId 54,71,374,473,649) need 2022 closing date
 *   - 21 records (kycFileId 230-250) need amlListAddedDate moved to 2021
 *
 * Expected result: 2022=5 closed, 2023=2049-5+83=2127 closed (target 2127).
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AdjustKycStatsTestData1770246261000 {
  name = 'AdjustKycStatsTestData1770246261000';

  // Records with kycFileId 230-250 to move from 2022 to 2021
  // These were processed in early Jan 2022 but belong to 2021 per compliance report (highestFileNr 2021 = 250)
  // Verified: 21 UserDataIds with kycFileId between 230-250
  movedTo2021Ids = [4161, 1202, 4180, 3949, 1137, 2077, 883, 1886, 4022, 3457, 4144, 3725, 1190, 2781, 4081, 3792, 4262, 3249, 4205, 4243, 1220];

  // Business accounts to close in 2022 (change amlListExpiredDate from 2023-12-31 to 2022-12-31)
  // These 5 Organization accounts have no formal Schliessdatum in CSV but were closed
  // kycFileId: 54 -> 1358, 71 -> 1945, 374 -> 998, 473 -> 5365, 649 -> 6617
  closed2022Ids = [1358, 1945, 998, 5365, 6617];

  // Records to close in 2023 (set amlListExpiredDate = 2023-12-31)
  // Verified: These 83 records are "geschlossen" in Jan 2024 CSV AND have amlListExpiredDate=NULL in PRD
  // Cross-referenced PRD NULL list (411 records) with CSV "geschlossen" status
  // 23 of these were reactivated (~2024-02-02, amlListReactivatedDate already set in PRD)
  // Post-reactivation transactions are expected and not a concern
  // Note: id 8968 holds kycFileId 1129 (transferred from id 7698 which CSV references)
  closed2023Ids = [
    803, 914, 915, 979, 983, 984, 1068, 1144, 1161, 1174,
    1200, 1289, 1412, 1437, 1449, 1502, 1508, 1548, 1559, 1599,
    1778, 1797, 1853, 2006, 2053, 2289, 2578, 2591, 2736, 2746,
    2939, 3008, 3057, 3258, 3297, 3365, 3403, 4015, 4485, 4550,
    4801, 4910, 5076, 5128, 5163, 5170, 5213, 5219, 5373, 5427,
    5479, 5615, 5649, 5662, 5733, 5798, 5951, 6230, 6533, 6568,
    6874, 7183, 7274, 7466, 7549, 8419, 8461, 8570, 8879, 8938,
    8968, 9146, 9327, 9388, 11104, 11123, 11195, 11531, 11827, 13566,
    29059, 31928, 185384
  ];

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    console.log('=== Adjusting KYC Stats Test Data ===\n');

    // Get current stats before changes
    const beforeStats = await this.getStats(queryRunner);
    console.log('Before migration:');
    this.printStats(beforeStats);

    // 1. Move 21 records from 2022 to 2021 (kycFileId 230-250)
    console.log('\nStep 1: Moving 21 records with kycFileId 230-250 from 2022 to 2021...');
    const moved = await queryRunner.query(`
      UPDATE dbo.user_data
      SET amlListAddedDate = DATEADD(year, -1, amlListAddedDate),
          updated = GETDATE()
      WHERE id IN (${this.movedTo2021Ids.join(',')})
        AND YEAR(amlListAddedDate) = 2022
    `);
    console.log(`  Affected: ${moved?.rowsAffected?.[0] ?? this.movedTo2021Ids.length} records`);

    // 2. Change 5 business accounts' closing date from 2023 to 2022
    console.log('\nStep 2: Changing 5 business accounts to closed in 2022...');
    const closed2022 = await queryRunner.query(`
      UPDATE dbo.user_data
      SET amlListExpiredDate = '2022-12-31',
          updated = GETDATE()
      WHERE id IN (${this.closed2022Ids.join(',')})
        AND YEAR(amlListExpiredDate) = 2023
    `);
    console.log(`  Affected: ${closed2022?.rowsAffected?.[0] ?? this.closed2022Ids.length} records`);

    // 3. Close 83 records in 2023 (23 of these will also have amlListReactivatedDate set)
    console.log('\nStep 3: Closing 83 records in 2023...');
    const closed2023 = await queryRunner.query(`
      UPDATE dbo.user_data
      SET amlListExpiredDate = '2023-12-31',
          updated = GETDATE()
      WHERE id IN (${this.closed2023Ids.join(',')})
        AND amlListExpiredDate IS NULL
    `);
    console.log(`  Affected: ${closed2023?.rowsAffected?.[0] ?? this.closed2023Ids.length} records`);

    // Get stats after changes
    const afterStats = await this.getStats(queryRunner);
    console.log('\nAfter migration:');
    this.printStats(afterStats);

    console.log('\n=== Migration Complete ===');
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    console.log('=== Reverting KYC Stats Test Data ===\n');

    // 1. Reset amlListExpiredDate for 2023 records back to NULL
    console.log('Step 1: Resetting 83 records back to NULL...');
    await queryRunner.query(`
      UPDATE dbo.user_data
      SET amlListExpiredDate = NULL,
          updated = GETDATE()
      WHERE id IN (${this.closed2023Ids.join(',')})
        AND amlListExpiredDate = '2023-12-31'
    `);

    // 2. Change 5 business accounts back to 2023
    console.log('\nStep 2: Changing 5 business accounts back to 2023...');
    await queryRunner.query(`
      UPDATE dbo.user_data
      SET amlListExpiredDate = '2023-12-31',
          updated = GETDATE()
      WHERE id IN (${this.closed2022Ids.join(',')})
        AND amlListExpiredDate = '2022-12-31'
    `);

    // 3. Move records back from 2021 to 2022
    console.log('\nStep 3: Moving 21 records back from 2021 to 2022...');
    await queryRunner.query(`
      UPDATE dbo.user_data
      SET amlListAddedDate = DATEADD(year, 1, amlListAddedDate),
          updated = GETDATE()
      WHERE id IN (${this.movedTo2021Ids.join(',')})
        AND YEAR(amlListAddedDate) = 2021
    `);

    console.log('\n=== Revert Complete ===');
  }

  async getStats(queryRunner) {
    return queryRunner.query(`
      SELECT YEAR(amlListExpiredDate) as year, COUNT(*) as closed
      FROM dbo.user_data
      WHERE amlListExpiredDate IS NOT NULL
      GROUP BY YEAR(amlListExpiredDate)
      ORDER BY YEAR(amlListExpiredDate)
    `);
  }

  printStats(stats) {
    const targets = { 2022: 5, 2023: 2127, 2024: 253, 2025: 2 };
    for (const row of stats) {
      const target = targets[row.year];
      const marker = target ? (row.closed === target ? '✓' : '✗') : '';
      console.log(`  ${row.year}: ${row.closed} closed ${marker}`);
    }
  }
};
