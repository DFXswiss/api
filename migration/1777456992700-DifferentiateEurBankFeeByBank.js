module.exports = class DifferentiateEurBankFeeByBank1777456992700 {
  name = 'DifferentiateEurBankFeeByBank1777456992700';

  async up(queryRunner) {
    // Scope existing 0.5% EUR bank fee to Olkypay (bank id 4)
    await queryRunner.query(`
            UPDATE "dbo"."fee"
            SET "bankId" = 4, "label" = 'Bank Fee EUR Olky 0.5%'
            WHERE "label" = 'Bank Fee EUR 0.5%' AND "type" = 'Bank' AND "bankId" IS NULL
        `);

    // Add Yapeal-specific 2% EUR bank fee (bank id 16)
    await queryRunner.query(`
            INSERT INTO "dbo"."fee" ("label", "type", "rate", "fixed", "blockchainFactor", "payoutRefBonus", "active", "fiats", "bankId")
            VALUES ('Bank Fee EUR Yapeal 2%', 'Bank', 0.02, 0, 1, 1, 1, '2', 16)
        `);

    // Preserve 0.5% EUR bank fee for Raiffeisen (bank id 12)
    await queryRunner.query(`
            INSERT INTO "dbo"."fee" ("label", "type", "rate", "fixed", "blockchainFactor", "payoutRefBonus", "active", "fiats", "bankId")
            VALUES ('Bank Fee EUR Raiffeisen 0.5%', 'Bank', 0.005, 0, 1, 1, 1, '2', 12)
        `);
  }

  async down(queryRunner) {
    await queryRunner.query(`
            DELETE FROM "dbo"."fee" WHERE "label" = 'Bank Fee EUR Raiffeisen 0.5%' AND "type" = 'Bank'
        `);
    await queryRunner.query(`
            DELETE FROM "dbo"."fee" WHERE "label" = 'Bank Fee EUR Yapeal 2%' AND "type" = 'Bank'
        `);
    await queryRunner.query(`
            UPDATE "dbo"."fee"
            SET "bankId" = NULL, "label" = 'Bank Fee EUR 0.5%'
            WHERE "label" = 'Bank Fee EUR Olky 0.5%' AND "type" = 'Bank' AND "bankId" = 4
        `);
  }
};
