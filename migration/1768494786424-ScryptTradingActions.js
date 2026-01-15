/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Add Scrypt SELL actions for CHF->USDT and EUR->USDT trading
 * and link them to existing rules 312 (CHF) and 313 (EUR)
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class ScryptTradingActions1768494786424 {
    name = 'ScryptTradingActions1768494786424'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        // Create Scrypt SELL action for CHF -> USDT
        await queryRunner.query(`
            INSERT INTO "dbo"."liquidity_management_action" ("system", "command", "params")
            VALUES ('Scrypt', 'sell', '{"tradeAsset":"USDT"}')
        `);

        // Get the ID of the newly created CHF action
        const chfActionResult = await queryRunner.query(`
            SELECT TOP 1 "id" FROM "dbo"."liquidity_management_action"
            WHERE "system" = 'Scrypt' AND "command" = 'sell'
            ORDER BY "id" DESC
        `);
        const chfActionId = chfActionResult[0].id;

        // Update Rule 312 (Scrypt CHF) with maximal=1000 and link to SELL action
        await queryRunner.query(`
            UPDATE "dbo"."liquidity_management_rule"
            SET "minimal" = 0,
                "optimal" = 0,
                "maximal" = 1000,
                "redundancyStartActionId" = ${chfActionId}
            WHERE "id" = 312
        `);

        // Create Scrypt SELL action for EUR -> USDT (separate action for clarity)
        await queryRunner.query(`
            INSERT INTO "dbo"."liquidity_management_action" ("system", "command", "params")
            VALUES ('Scrypt', 'sell', '{"tradeAsset":"USDT"}')
        `);

        // Get the ID of the newly created EUR action
        const eurActionResult = await queryRunner.query(`
            SELECT TOP 1 "id" FROM "dbo"."liquidity_management_action"
            WHERE "system" = 'Scrypt' AND "command" = 'sell'
            ORDER BY "id" DESC
        `);
        const eurActionId = eurActionResult[0].id;

        // Update Rule 313 (Scrypt EUR) with maximal=1000 and link to SELL action
        await queryRunner.query(`
            UPDATE "dbo"."liquidity_management_rule"
            SET "minimal" = 0,
                "optimal" = 0,
                "maximal" = 1000,
                "redundancyStartActionId" = ${eurActionId}
            WHERE "id" = 313
        `);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        // Get action IDs linked to rules 312 and 313
        const rule312 = await queryRunner.query(`
            SELECT "redundancyStartActionId" FROM "dbo"."liquidity_management_rule" WHERE "id" = 312
        `);
        const rule313 = await queryRunner.query(`
            SELECT "redundancyStartActionId" FROM "dbo"."liquidity_management_rule" WHERE "id" = 313
        `);

        // Remove action links from rules and reset values
        await queryRunner.query(`
            UPDATE "dbo"."liquidity_management_rule"
            SET "minimal" = NULL,
                "optimal" = NULL,
                "maximal" = NULL,
                "redundancyStartActionId" = NULL
            WHERE "id" IN (312, 313)
        `);

        // Delete actions if they exist
        if (rule312[0]?.redundancyStartActionId) {
            await queryRunner.query(`
                DELETE FROM "dbo"."liquidity_management_action" WHERE "id" = ${rule312[0].redundancyStartActionId}
            `);
        }
        if (rule313[0]?.redundancyStartActionId && rule313[0].redundancyStartActionId !== rule312[0]?.redundancyStartActionId) {
            await queryRunner.query(`
                DELETE FROM "dbo"."liquidity_management_action" WHERE "id" = ${rule313[0].redundancyStartActionId}
            `);
        }
    }
}
