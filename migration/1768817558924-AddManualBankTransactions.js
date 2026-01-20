/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Add manual bank transactions for Märki Baumann:
 *
 * 1. Interest charge (Sollzins) - DocID 42675306
 *    - Amount: CHF 1.11 (Debit)
 *    - Date: 31.12.2025
 *    - Account: CH34 0857 3177 9752 0000 1 (CHF)
 *
 * 2. Payment return (Zahlungsrückweisung) - DocID 42675333
 *    - Amount: EUR 57'399.75 (Credit, net after EUR 28.71 fee)
 *    - Date: 08.12.2025
 *    - Account: CH68 0857 3177 9752 0181 4 (EUR)
 *    - Original payment to: Jelly Labs AG, Vaduz
 *    - DFX Payment: 754427747
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddManualBankTransactions1768817558924 {
    name = 'AddManualBankTransactions1768817558924'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        // === 1. Interest charge (Sollzins) ===
        const existingInterest = await queryRunner.query(`
            SELECT "id" FROM "dbo"."bank_tx"
            WHERE "accountServiceRef" = '42675306'
        `);

        if (existingInterest.length > 0) {
            console.log('Bank transaction 42675306 (interest charge) already exists, skipping');
        } else {
            await queryRunner.query(`
                INSERT INTO "dbo"."bank_tx" (
                    "accountServiceRef",
                    "bookingDate",
                    "valueDate",
                    "amount",
                    "currency",
                    "creditDebitIndicator",
                    "instructedAmount",
                    "instructedCurrency",
                    "txAmount",
                    "txCurrency",
                    "name",
                    "accountIban",
                    "remittanceInfo",
                    "type"
                ) VALUES (
                    '42675306',
                    '2025-12-31T00:00:00.000Z',
                    '2025-12-31T00:00:00.000Z',
                    1.11,
                    'CHF',
                    'DBIT',
                    1.11,
                    'CHF',
                    1.11,
                    'CHF',
                    'Maerki Baumann & Co. AG',
                    'CH3408573177975200001',
                    'Sollzins',
                    'BankAccountFee'
                )
            `);
            console.log('Inserted interest charge transaction 42675306');
        }

        // === 2. Payment return (Zahlungsrückweisung) ===
        const existingReturn = await queryRunner.query(`
            SELECT "id" FROM "dbo"."bank_tx"
            WHERE "accountServiceRef" = '42675333'
        `);

        if (existingReturn.length > 0) {
            console.log('Bank transaction 42675333 (payment return) already exists, skipping');
        } else {
            await queryRunner.query(`
                INSERT INTO "dbo"."bank_tx" (
                    "accountServiceRef",
                    "bookingDate",
                    "valueDate",
                    "amount",
                    "currency",
                    "creditDebitIndicator",
                    "instructedAmount",
                    "instructedCurrency",
                    "txAmount",
                    "txCurrency",
                    "chargeAmount",
                    "chargeCurrency",
                    "name",
                    "addressLine1",
                    "country",
                    "accountIban",
                    "remittanceInfo",
                    "type"
                ) VALUES (
                    '42675333',
                    '2025-12-08T00:00:00.000Z',
                    '2025-12-08T00:00:00.000Z',
                    57399.75,
                    'EUR',
                    'CRDT',
                    57428.46,
                    'EUR',
                    57399.75,
                    'EUR',
                    28.71,
                    'EUR',
                    'BADEN-WUERTTEMBERGISCHE BANK',
                    'STUTTGART',
                    'DE',
                    'CH6808573177975201814',
                    'Rueckverguetung Zahlung z.G. Jelly Labs AG - DFX Payment: 754427747',
                    'Pending'
                )
            `);
            console.log('Inserted payment return transaction 42675333');
        }
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`
            DELETE FROM "dbo"."bank_tx"
            WHERE "accountServiceRef" IN ('42675306', '42675333')
        `);

        console.log('Deleted manual bank transactions 42675306, 42675333');
    }
}
