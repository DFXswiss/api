/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Fix kycFileId for user_data entries from 2025.
 *
 * Some entries have amlListAddedDate but no kycFileId assigned.
 * This migration renumbers all kycFileIds from 2025-01-01 onwards
 * to maintain chronological order based on amlListAddedDate.
 *
 * The starting kycFileId is dynamically determined as:
 * MAX(kycFileId) from entries BEFORE 2025-01-01
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class FixKycFileIds20251769100000000 {
  name = 'FixKycFileIds20251769100000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    console.log('=== Fix kycFileId for 2025 entries ===\n');

    // Get the last kycFileId that is NOT from 2025 (this will be our starting point)
    // Includes entries with amlListAddedDate IS NULL for safety
    const lastBefore2025 = await queryRunner.query(`
      SELECT MAX(kycFileId) as maxId
      FROM dbo.user_data
      WHERE kycFileId > 0
        AND (amlListAddedDate IS NULL OR amlListAddedDate < '2025-01-01')
    `);
    const startId = lastBefore2025[0]?.maxId ?? 0;
    console.log(`Last kycFileId before 2025: ${startId}`);

    if (startId === 0) {
      console.log('ERROR: Could not determine starting kycFileId. Aborting.');
      return;
    }

    // Count entries to process
    const entriesToProcess = await queryRunner.query(`
      SELECT COUNT(*) as count
      FROM dbo.user_data
      WHERE amlListAddedDate >= '2025-01-01'
    `);
    console.log(`Entries from 2025 to renumber: ${entriesToProcess[0].count}`);

    // Check how many are missing kycFileId before fix
    const missingBefore = await queryRunner.query(`
      SELECT id, amlListAddedDate
      FROM dbo.user_data
      WHERE amlListAddedDate >= '2025-01-01'
        AND (kycFileId IS NULL OR kycFileId = 0)
      ORDER BY amlListAddedDate
    `);
    console.log(`\nMissing kycFileId before fix: ${missingBefore.length}`);

    if (missingBefore.length === 0) {
      console.log('No missing entries found. Skipping.\n');
      return;
    }

    // Show the missing entries
    console.log('Missing entries to fix:');
    for (const entry of missingBefore) {
      console.log(`  - ID ${entry.id}: ${entry.amlListAddedDate}`);
    }

    // Renumber all 2025 entries, starting after the last pre-2025 kycFileId
    const result = await queryRunner.query(`
      WITH NewIds AS (
        SELECT id, ${startId} + ROW_NUMBER() OVER (ORDER BY amlListAddedDate ASC, id ASC) as new_kycFileId
        FROM dbo.user_data
        WHERE amlListAddedDate >= '2025-01-01'
      )
      UPDATE ud
      SET ud.kycFileId = n.new_kycFileId, ud.updated = GETDATE()
      FROM dbo.user_data ud
      INNER JOIN NewIds n ON ud.id = n.id
    `);

    const rowsUpdated = result?.rowsAffected ?? entriesToProcess[0].count;
    console.log(`\nUpdated ${rowsUpdated} rows`);

    // Verify fix
    const missingAfter = await queryRunner.query(`
      SELECT COUNT(*) as count
      FROM dbo.user_data
      WHERE amlListAddedDate >= '2025-01-01'
        AND (kycFileId IS NULL OR kycFileId = 0)
    `);

    if (missingAfter[0].count > 0) {
      console.log(`\nWARNING: Still ${missingAfter[0].count} entries missing kycFileId!`);
    } else {
      console.log('\nVerification: All entries now have kycFileId');
    }

    // Show the fixed entries with their new kycFileIds
    const fixedIds = missingBefore.map((e) => e.id);
    const fixedEntries = await queryRunner.query(`
      SELECT id, amlListAddedDate, kycFileId
      FROM dbo.user_data
      WHERE id IN (${fixedIds.join(',')})
      ORDER BY kycFileId
    `);
    console.log('\nFixed entries:');
    for (const entry of fixedEntries) {
      console.log(`  - ID ${entry.id}: kycFileId=${entry.kycFileId}`);
    }

    console.log('\n=== SUMMARY ===');
    console.log(`  Start kycFileId: ${startId + 1}`);
    console.log(`  End kycFileId: ${startId + entriesToProcess[0].count}`);
    console.log(`  Fixed missing: ${missingBefore.length} entries`);
    console.log(`  Total renumbered: ${rowsUpdated} entries`);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    // Rolling back would require storing the original kycFileId values.
    // If needed, identify affected entries from migration logs and handle manually.
    console.log('Down migration is not supported. Manual intervention required if rollback needed.');
  }
};
