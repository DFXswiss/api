const { MigrationInterface, QueryRunner } = require('typeorm');

module.exports = class RenameArkToArkade1775233148000 {
  name = 'RenameArkToArkade1775233148000';

  async up(queryRunner) {
    await queryRunner.query(`UPDATE "dbo"."asset" SET "blockchain" = 'Arkade', "uniqueName" = REPLACE("uniqueName", 'Ark/', 'Arkade/'), "description" = REPLACE("description", 'Ark', 'Arkade') WHERE "blockchain" = 'Ark'`);
    await queryRunner.query(`UPDATE "dbo"."user" SET "addressType" = 'Arkade' WHERE "addressType" = 'Ark'`);
  }

  async down(queryRunner) {
    await queryRunner.query(`UPDATE "dbo"."asset" SET "blockchain" = 'Ark', "uniqueName" = REPLACE("uniqueName", 'Arkade/', 'Ark/'), "description" = REPLACE("description", 'Arkade', 'Ark') WHERE "blockchain" = 'Arkade'`);
    await queryRunner.query(`UPDATE "dbo"."user" SET "addressType" = 'Ark' WHERE "addressType" = 'Arkade'`);
  }
};
