const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class ActivateScryptUsdtLiquidityRule1768479555000 {
    name = 'ActivateScryptUsdtLiquidityRule1768479555000'

    async up(queryRunner) {
        // Create action for Scrypt USDT withdrawal to DFX ETH liquidity wallet
        // When Scrypt/USDT balance exceeds maximal (50,000), withdraw to ETH_WALLET_ADDRESS
        await queryRunner.query(`
            INSERT INTO liquidity_management_action (system, command, params, tag)
            VALUES (
                'Scrypt',
                'withdraw',
                '{"destinationAddress":"ETH_WALLET_ADDRESS","destinationBlockchain":"Ethereum","asset":"USDT"}',
                'Scrypt USDT -> ETH Liq'
            )
        `);

        // Get the ID of the newly created action
        const result = await queryRunner.query(`SELECT SCOPE_IDENTITY() as actionId`);
        const actionId = result[0].actionId;

        // Update Scrypt/USDT rule (ID 315) with thresholds and activate it
        // - optimal: 25,000 USDT (target balance)
        // - maximal: 50,000 USDT (trigger withdrawal when exceeded)
        await queryRunner.query(`
            UPDATE liquidity_management_rule
            SET optimal = 25000,
                maximal = 50000,
                redundancyStartActionId = ${actionId},
                status = 'Active',
                reactivationTime = 60
            WHERE id = 315
        `);
    }

    async down(queryRunner) {
        // Deactivate the rule and remove thresholds
        await queryRunner.query(`
            UPDATE liquidity_management_rule
            SET optimal = NULL,
                maximal = NULL,
                redundancyStartActionId = NULL,
                status = 'Inactive',
                reactivationTime = NULL
            WHERE id = 315
        `);

        // Delete the Scrypt USDT withdrawal action
        await queryRunner.query(`
            DELETE FROM liquidity_management_action
            WHERE system = 'Scrypt' AND command = 'withdraw' AND tag = 'Scrypt USDT -> ETH Liq'
        `);
    }
}
