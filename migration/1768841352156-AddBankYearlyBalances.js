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

        // Update each bank with their yearly balances (closing balances per year)
        // Format: { "YYYY": closingBalance } - opening is previous year's closing
        // Data source: bank anfangsbestände per 1.1.xxxx - Endbestaende.csv
        const bankBalances = [
            // Bank Frick EUR (ID: 1)
            {
                id: 1,
                balances: { "2022": 11407.01, "2023": 0, "2024": 0, "2025": 0 }
            },
            // Bank Frick CHF (ID: 2)
            {
                id: 2,
                balances: { "2022": 116.54, "2023": 0, "2024": 0, "2025": 0 }
            },
            // Bank Frick USD (ID: 3)
            {
                id: 3,
                balances: { "2022": 6670.51, "2023": 0, "2024": 0, "2025": 0 }
            },
            // Olkypay EUR (ID: 4)
            {
                id: 4,
                balances: { "2022": 15702.24, "2023": 35581.94, "2024": 11219.32, "2025": 21814.76 }
            },
            // Maerki Baumann EUR (ID: 5)
            {
                id: 5,
                balances: { "2022": 67230.42, "2023": 26327.80, "2024": 3312.22, "2025": 0 }
            },
            // Maerki Baumann CHF (ID: 6)
            {
                id: 6,
                balances: { "2022": 30549.23, "2023": 8011.98, "2024": 2437.57, "2025": 0 }
            },
            // Revolut EUR (ID: 7)
            {
                id: 7,
                balances: { "2022": 8687.49, "2023": 3303.60, "2024": 0, "2025": 0 }
            },
            // Raiffeisen CHF (ID: 13)
            {
                id: 13,
                balances: { "2022": 0, "2023": 0, "2024": 0, "2025": 1161.67 }
            },
            // Yapeal CHF (ID: 15)
            {
                id: 15,
                balances: { "2022": 0, "2023": 0, "2024": 0, "2025": 1557.73 }
            },
            // Yapeal EUR (ID: 16)
            {
                id: 16,
                balances: { "2022": 0, "2023": 0, "2024": 0, "2025": 2568.79 }
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
