module.exports = class AddUrbleWalletApp1777985314136 {
  name = 'AddUrbleWalletApp1777985314136';

  async up(queryRunner) {
    await queryRunner.query(`
      IF NOT EXISTS (SELECT 1 FROM "dbo"."wallet_app" WHERE "name" = 'urble')
      INSERT INTO "dbo"."wallet_app" (
        "name", "websiteUrl", "iconUrl", "deepLink", "blockchains", "assets", "active"
      ) VALUES (
        'urble', 'https://urble.io', 'https://dfx.swiss/images/app/urble.webp', 'urble:',
        'Bitcoin;Cardano;Ethereum', '113;406;123;145;337', 1
      )
    `);
  }

  async down(queryRunner) {
    await queryRunner.query(`DELETE FROM "dbo"."wallet_app" WHERE "name" = 'urble'`);
  }
};
