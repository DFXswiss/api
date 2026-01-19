/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Add yearlyBalances column to bank table and populate with historical balances.
 *
 * Format: { "2024": 2437.57, "2025": 0 }
 * - Each year stores the closing balance (Endbestand) for that year
 * - Opening balance (Anfangsbestand) is calculated as previous year's closing balance
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddBankYearlyBalances1768841352156 {
    name = 'AddBankYearlyBalances1768841352156'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        // Add yearlyBalances column
        await queryRunner.query(`
            ALTER TABLE "dbo"."bank" ADD "yearlyBalances" nvarchar(MAX) NULL
        `);

        // Update each bank with their yearly balances
        // Format: { "YYYY": closingBalance } - opening is previous year's closing
        const bankBalances = [
            // Maerki Baumann EUR (ID: 5)
            // 2025: opening 3617.58 (from 2024), closing 0
            {
                id: 5,
                balances: { "2024": 3617.58, "2025": 0 }
            },
            // Maerki Baumann CHF (ID: 6)
            // 2025: opening 2437.57 (from 2024), closing 0
            {
                id: 6,
                balances: { "2024": 2437.57, "2025": 0 }
            },
            // Raiffeisen CHF (ID: 13)
            // 2025: opening 0, closing 1161.67
            {
                id: 13,
                balances: { "2025": 1161.67 }
            },
            // Yapeal CHF (ID: 15)
            // 2025: opening 0, closing 1557.73
            {
                id: 15,
                balances: { "2025": 1557.73 }
            },
            // Yapeal EUR (ID: 16)
            // 2025: opening 0, closing 2568.79
            {
                id: 16,
                balances: { "2025": 2568.79 }
            },
        ];

        for (const bank of bankBalances) {
            const jsonValue = JSON.stringify(bank.balances).replace(/'/g, "''");
            await queryRunner.query(`
                UPDATE "dbo"."bank"
                SET "yearlyBalances" = '${jsonValue}'
                WHERE "id" = ${bank.id}
            `);
        }
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`
            ALTER TABLE "dbo"."bank" DROP COLUMN "yearlyBalances"
        `);
    }
}
