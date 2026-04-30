const { MigrationInterface, QueryRunner } = require('typeorm');

module.exports = class cardanoSignature1673444810025 {
  name = 'cardanoSignature1673444810025';

  async up(queryRunner) {
    await queryRunner.query(`ALTER TABLE "dbo"."user" ALTER COLUMN "signature" nvarchar(700) NOT NULL`);
  }

  async down(queryRunner) {
    await queryRunner.query(`ALTER TABLE "dbo"."user" ALTER COLUMN "signature" nvarchar(256) NOT NULL`);
  }
};
