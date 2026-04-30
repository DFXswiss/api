/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class SetFinanceFarmAmlRules1768503536967 {
    name = 'SetFinanceFarmAmlRules1768503536967'

    /**
     * Add RULE_15 (Force Manual Check) to FinanceFarm wallet (ID 42).
     *
     * Current state: amlRules = '2' (RULE_2: KycLevel 30)
     * New state: amlRules = '2;15' (RULE_2 + RULE_15: Force Manual Check)
     *
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        // Only add RULE_15 if it's not already present
        // Check for exact match: '15', '15;...', '...;15', '...;15;...'
        await queryRunner.query(`
            UPDATE "dbo"."wallet"
            SET "amlRules" = CASE
                WHEN "amlRules" IS NULL OR "amlRules" = '' OR "amlRules" = '0' THEN '15'
                WHEN "amlRules" = '15' THEN "amlRules"
                WHEN "amlRules" LIKE '15;%' THEN "amlRules"
                WHEN "amlRules" LIKE '%;15' THEN "amlRules"
                WHEN "amlRules" LIKE '%;15;%' THEN "amlRules"
                ELSE "amlRules" + ';15'
            END
            WHERE "id" = 42 AND "name" = 'FinanceFarm'
        `);
    }

    /**
     * Remove RULE_15 from FinanceFarm wallet.
     *
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        // Remove RULE_15 from amlRules (handles: '15', '2;15', '15;2', '2;15;3')
        await queryRunner.query(`
            UPDATE "dbo"."wallet"
            SET "amlRules" = CASE
                WHEN "amlRules" = '15' THEN '0'
                WHEN "amlRules" LIKE '15;%' THEN STUFF("amlRules", 1, 3, '')
                WHEN "amlRules" LIKE '%;15' THEN LEFT("amlRules", LEN("amlRules") - 3)
                WHEN "amlRules" LIKE '%;15;%' THEN REPLACE("amlRules", ';15;', ';')
                ELSE "amlRules"
            END
            WHERE "id" = 42 AND "name" = 'FinanceFarm'
        `);
    }
}
