const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class renameOutputAssetEntity1709568743635 {
    name = 'renameOutputAssetEntity1709568743635'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP CONSTRAINT "FK_6a4e7ed37d66dc2c61850254133"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP CONSTRAINT "FK_63bb76ac49a36fef0c9f8503743"`);
        await queryRunner.query(`EXEC sp_rename "buy_fiat.outputAssetEntityId", "outputAssetId"`);
        await queryRunner.query(`EXEC sp_rename "buy_fiat.outputReferenceAssetEntityId", "outputReferenceAssetId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD CONSTRAINT "FK_a1fdc1bf1ba7c0eed9b74727cdb" FOREIGN KEY ("outputReferenceAssetId") REFERENCES "fiat"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD CONSTRAINT "FK_c932c1ef5af9ab9799ba8e6ed4e" FOREIGN KEY ("outputAssetId") REFERENCES "fiat"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP CONSTRAINT "FK_c932c1ef5af9ab9799ba8e6ed4e"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP CONSTRAINT "FK_a1fdc1bf1ba7c0eed9b74727cdb"`);
        await queryRunner.query(`EXEC sp_rename "buy_fiat.outputReferenceAssetId", "outputReferenceAssetEntityId"`);
        await queryRunner.query(`EXEC sp_rename "buy_fiat.outputAssetId", "outputAssetEntityId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD CONSTRAINT "FK_63bb76ac49a36fef0c9f8503743" FOREIGN KEY ("outputAssetEntityId") REFERENCES "fiat"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD CONSTRAINT "FK_6a4e7ed37d66dc2c61850254133" FOREIGN KEY ("outputReferenceAssetEntityId") REFERENCES "fiat"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }
}
