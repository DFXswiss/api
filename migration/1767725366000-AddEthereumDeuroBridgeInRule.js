const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddEthereumDeuroBridgeInRule1767725366000 {
    name = 'AddEthereumDeuroBridgeInRule1767725366000'

    async up(queryRunner) {
        // 1. Find Ethereum dEURO asset
        const assetResult = await queryRunner.query(`
            SELECT id FROM "dbo"."asset"
            WHERE "name" = 'dEURO' AND "blockchain" = 'Ethereum' AND "type" = 'Token'
        `);

        if (!assetResult || assetResult.length === 0) {
            console.log('Ethereum dEURO asset not found - skipping migration');
            return;
        }
        const assetId = assetResult[0].id;

        // 2. Find the liquidity management rule for this asset
        const ruleResult = await queryRunner.query(`
            SELECT id FROM "dbo"."liquidity_management_rule"
            WHERE "targetAssetId" = ${assetId}
        `);

        if (!ruleResult || ruleResult.length === 0) {
            console.log('Liquidity management rule for Ethereum dEURO not found - skipping migration');
            return;
        }
        const ruleId = ruleResult[0].id;

        // 3. Check if bridge-in action already exists
        const existingAction = await queryRunner.query(`
            SELECT id FROM "dbo"."liquidity_management_action"
            WHERE "system" = 'dEURO' AND "command" = 'bridge-in' AND "params" = '{"asset": "EURC"}'
        `);

        let actionId;
        if (existingAction && existingAction.length > 0) {
            actionId = existingAction[0].id;
        } else {
            // 4. Create new action for dEURO bridge-in with EURC as source
            await queryRunner.query(`
                INSERT INTO "dbo"."liquidity_management_action" ("system", "command", "params")
                VALUES ('dEURO', 'bridge-in', '{"asset": "EURC"}')
            `);

            const newActionResult = await queryRunner.query(`
                SELECT id FROM "dbo"."liquidity_management_action"
                WHERE "system" = 'dEURO' AND "command" = 'bridge-in' AND "params" = '{"asset": "EURC"}'
            `);
            actionId = newActionResult[0].id;
        }

        // 5. Activate rule and link to the bridge-in action
        await queryRunner.query(`
            UPDATE "dbo"."liquidity_management_rule"
            SET
                "status" = 'Active',
                "minimal" = 1000,
                "optimal" = 5000,
                "maximal" = 20000,
                "deficitStartActionId" = ${actionId}
            WHERE "id" = ${ruleId}
        `);
    }

    async down(queryRunner) {
        // 1. Find Ethereum dEURO asset
        const assetResult = await queryRunner.query(`
            SELECT id FROM "dbo"."asset"
            WHERE "name" = 'dEURO' AND "blockchain" = 'Ethereum' AND "type" = 'Token'
        `);

        if (!assetResult || assetResult.length === 0) {
            return;
        }
        const assetId = assetResult[0].id;

        // 2. Reset the rule to inactive state
        await queryRunner.query(`
            UPDATE "dbo"."liquidity_management_rule"
            SET
                "status" = 'Inactive',
                "minimal" = NULL,
                "optimal" = NULL,
                "maximal" = NULL,
                "deficitStartActionId" = NULL
            WHERE "targetAssetId" = ${assetId}
        `);

        // 3. Delete the bridge-in action
        await queryRunner.query(`
            DELETE FROM "dbo"."liquidity_management_action"
            WHERE "system" = 'dEURO' AND "command" = 'bridge-in' AND "params" = '{"asset": "EURC"}'
        `);
    }
}
