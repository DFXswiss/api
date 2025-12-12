/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class WalletAutoTradeApproval1765552247357 {
    name = 'WalletAutoTradeApproval1765552247357'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`
            UPDATE "wallet"
            SET "autoTradeApproval" = 1
            WHERE "name" IN (
                'Bitagent',
                'RealUnit',
                'onchainlabs',
                'PointPay',
                'P2B',
                'FinanceFarm',
                'Aktionariat',
                'FrankencoinWallet',
                'Coinsnap',
                'LegacyNetwork',
                'Multisig',
                'Marc Steiner',
                'Kevin Soell',
                'OnRamper 2.5',
                'OnRamper 2',
                'OnRamper 1.5',
                'OnRamper 1',
                'OnRamper 0.5',
                'OnRamper',
                'OnRamper -0.5',
                'DFX Bitcoin'
            )
        `);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`
            UPDATE "wallet"
            SET "autoTradeApproval" = 0
            WHERE "name" IN (
                'Bitagent',
                'RealUnit',
                'onchainlabs',
                'PointPay',
                'P2B',
                'FinanceFarm',
                'Aktionariat',
                'FrankencoinWallet',
                'Coinsnap',
                'LegacyNetwork',
                'Multisig',
                'Marc Steiner',
                'Kevin Soell',
                'OnRamper 2.5',
                'OnRamper 2',
                'OnRamper 1.5',
                'OnRamper 1',
                'OnRamper 0.5',
                'OnRamper',
                'OnRamper -0.5',
                'DFX Bitcoin'
            )
        `);
    }
}
