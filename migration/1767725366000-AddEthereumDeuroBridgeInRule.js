const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddEthereumDeuroBridgeInRule1767725366000 {
    name = 'AddEthereumDeuroBridgeInRule1767725366000'

    async up(queryRunner) {
        // 1. Create new action for dEURO bridge-in with EURC as source
        await queryRunner.query(`
            INSERT INTO "dbo"."liquidity_management_action" ("system", "command", "params")
            VALUES ('dEURO', 'bridge-in', '{"asset": "EURC"}')
        `);

        // 2. Get the newly created action ID
        const result = await queryRunner.query(`
            SELECT id FROM "dbo"."liquidity_management_action"
            WHERE "system" = 'dEURO' AND "command" = 'bridge-in' AND "params" = '{"asset": "EURC"}'
        `);
        const actionId = result[0].id;

        // 3. Activate rule 259 (Ethereum dEURO) and link to the bridge-in action
        await queryRunner.query(`
            UPDATE "dbo"."liquidity_management_rule"
            SET
                "status" = 'Active',
                "minimal" = 1000,
                "optimal" = 5000,
                "maximal" = 20000,
                "deficitStartActionId" = ${actionId}
            WHERE "id" = 259
        `);
    }

    async down(queryRunner) {
        // 1. Reset rule 259 to inactive state
        await queryRunner.query(`
            UPDATE "dbo"."liquidity_management_rule"
            SET
                "status" = 'Inactive',
                "minimal" = NULL,
                "optimal" = NULL,
                "maximal" = NULL,
                "deficitStartActionId" = NULL
            WHERE "id" = 259
        `);

        // 2. Delete the bridge-in action
        await queryRunner.query(`
            DELETE FROM "dbo"."liquidity_management_action"
            WHERE "system" = 'dEURO' AND "command" = 'bridge-in' AND "params" = '{"asset": "EURC"}'
        `);
    }
}
