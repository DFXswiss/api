const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addYapealBanks1765356993462 {
    name = 'addYapealBanks1765356993462'

    async up(queryRunner) {
        // Add Yapeal CHF bank entry (send=false, receive=false - not active yet)
        await queryRunner.query(`
            INSERT INTO "dbo"."bank" ("name", "iban", "bic", "currency", "receive", "send", "sctInst", "amlEnabled")
            VALUES ('Yapeal', 'CH7489144562527626887', 'YAPECHZZXXX', 'CHF', 0, 0, 0, 1)
        `);

        // Add Yapeal EUR bank entry (send=false, receive=false - not active yet)
        await queryRunner.query(`
            INSERT INTO "dbo"."bank" ("name", "iban", "bic", "currency", "receive", "send", "sctInst", "amlEnabled")
            VALUES ('Yapeal', 'CH1489144171823255648', 'YAPECHZZXXX', 'EUR', 0, 0, 0, 1)
        `);
    }

    async down(queryRunner) {
        await queryRunner.query(`DELETE FROM "dbo"."bank" WHERE "name" = 'Yapeal' AND "currency" = 'CHF' AND "iban" = 'CH7489144562527626887'`);
        await queryRunner.query(`DELETE FROM "dbo"."bank" WHERE "name" = 'Yapeal' AND "currency" = 'EUR' AND "iban" = 'CH1489144171823255648'`);
    }
}
