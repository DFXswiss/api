const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class ActivateScryptUsdtLiquidityRule1768479555000 {
    name = 'ActivateScryptUsdtLiquidityRule1768479555000'

    async up(queryRunner) {
        // Create action for Scrypt USDT withdrawal to DFX ETH liquidity wallet
        // When Scrypt/USDT balance exceeds maximal (50,000), withdraw to ETH_WALLET_ADDRESS
        // Use OUTPUT to reliably get the inserted ID
        const result = await queryRunner.query(`
            INSERT INTO liquidity_management_action (system, command, params, tag)
            OUTPUT INSERTED.id as actionId
            VALUES (
                'Scrypt',
                'withdraw',
                '{"destinationAddress":"ETH_WALLET_ADDRESS","destinationBlockchain":"Ethereum","asset":"USDT"}',
                'Scrypt USDT -> ETH Liq'
            )
        `);
        const actionId = result[0].actionId;

        // Update Scrypt/USDT rule (ID 315) with thresholds and activate it
        // - optimal: 100 USDT (target balance after withdrawal)
        // - maximal: 50,000 USDT (trigger withdrawal when exceeded)
        await queryRunner.query(`
            UPDATE liquidity_management_rule
            SET optimal = 100,
                maximal = 50000,
                redundancyStartActionId = ${actionId},
                status = 'Active',
                reactivationTime = 5
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
