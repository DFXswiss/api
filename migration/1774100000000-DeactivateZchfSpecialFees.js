module.exports = class DeactivateZchfSpecialFees1774100000000 {
  name = 'DeactivateZchfSpecialFees1774100000000';

  async up(queryRunner) {
    // Deactivate "Special ZCHF 0% for traded customer" (fee 67)
    // Deactivate "Special ZCHF 0.5%" (fee 129)
    // Deactivate "Special dEURO Presale 0%" (fee 85)
    // Deactivate "Special dEURO 0%" (fee 88)
    // Deactivate "dEuro 0.2%" (fee 113)
    await queryRunner.query(`
            UPDATE "dbo"."fee"
            SET "active" = 0
            WHERE "id" IN (67, 129, 85, 88, 113)
        `);
  }

  async down(queryRunner) {
    await queryRunner.query(`
            UPDATE "dbo"."fee"
            SET "active" = 1
            WHERE "id" IN (67, 129, 85, 88, 113)
        `);
  }
};
