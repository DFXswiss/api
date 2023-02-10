const { MigrationInterface, QueryRunner } = require('typeorm');

module.exports = class payInPurposeNullable1676019359879 {
  name = 'payInPurposeNullable1676019359879';

  async up(queryRunner) {
    await queryRunner.query(`ALTER TABLE "crypto_input" ALTER COLUMN "purpose" nvarchar(255)`);
    await queryRunner.query(`ALTER TABLE "crypto_input" ALTER COLUMN "amlCheck" nvarchar(256)`);
    await queryRunner.query(`ALTER TABLE "crypto_input" DROP CONSTRAINT "DF_82bf6f09ca6607ebfe0c1aeb100"`);
  }

  async down(queryRunner) {
    await queryRunner.query(`ALTER TABLE "crypto_input" ADD CONSTRAINT "DF_82bf6f09ca6607ebfe0c1aeb100" DEFAULT 'Fail' FOR "amlCheck"`);
    await queryRunner.query(`ALTER TABLE "crypto_input" ALTER COLUMN "amlCheck" nvarchar(256) NOT NULL`);
    await queryRunner.query(`ALTER TABLE "crypto_input" ALTER COLUMN "purpose" nvarchar(256) NOT NULL`);
  }
};
