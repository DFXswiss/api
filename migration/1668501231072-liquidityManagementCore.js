const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class liquidityManagementCore1668501231072 {
    name = 'liquidityManagementCore1668501231072'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "liquidity_management_action" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_56b9cd28ab229b9192bfe5315f9" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_df16adf174c212c280d2b06b028" DEFAULT getdate(), "system" nvarchar(256) NOT NULL, "command" nvarchar(256) NOT NULL, "onSuccessId" int, "onFailId" int, CONSTRAINT "PK_dfddccc61fdf53ba6dbe2eaf6b5" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "liquidity_management_rule" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_10095efb371e63b94bf0159e197" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_65a7aeb078dcb5dc8f30e89ab63" DEFAULT getdate(), "context" nvarchar(256), "status" nvarchar(256), "minimal" float, "optimal" float, "maximal" float, "targetAssetId" int, "targetFiatId" int, "deficitStartActionId" int, "redundancyStartActionId" int, CONSTRAINT "PK_1351d49e47dda8f353df6aca798" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "liquidity_management_pipeline" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_055441aa3b0d599cc03e9fdaff9" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_e8a87a7a45a8b3e9c76515a7ca6" DEFAULT getdate(), "status" nvarchar(256) NOT NULL, "type" nvarchar(256) NOT NULL, "targetAmount" float, "ordersProcessed" int, "ruleId" int NOT NULL, "currentActionId" int, CONSTRAINT "PK_da84d0ee5b627bbc696e0b1fb03" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "liquidity_management_order" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_330e13f758926d5647a174560ce" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_64b6256174444761d662961ccfc" DEFAULT getdate(), "status" nvarchar(256) NOT NULL, "amount" float, "pipelineId" int NOT NULL, "actionId" int NOT NULL, CONSTRAINT "PK_d2dfe222627ad9073861a6271f5" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "liquidity_balance" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_46bb3108f1e7c3e88a54dee0437" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_45166a668dba687223c3562d0c5" DEFAULT getdate(), "amount" float, "assetId" int, "fiatId" int, CONSTRAINT "PK_f17f0f41512e8b6ed95ff0fbc79" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "liquidity_management_action" ADD CONSTRAINT "FK_c8e2abac3a14beb669b1cfa12b9" FOREIGN KEY ("onSuccessId") REFERENCES "liquidity_management_action"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "liquidity_management_action" ADD CONSTRAINT "FK_a9519dad89f7b8eb7281d64f5b6" FOREIGN KEY ("onFailId") REFERENCES "liquidity_management_action"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "liquidity_management_rule" ADD CONSTRAINT "FK_0a5e225a822550676a0d49bb6fe" FOREIGN KEY ("targetAssetId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "liquidity_management_rule" ADD CONSTRAINT "FK_8952855bd61ae683d3376d2f8bc" FOREIGN KEY ("targetFiatId") REFERENCES "fiat"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "liquidity_management_rule" ADD CONSTRAINT "FK_c45953f23325ad4b4bf1352c578" FOREIGN KEY ("deficitStartActionId") REFERENCES "liquidity_management_action"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "liquidity_management_rule" ADD CONSTRAINT "FK_5c1302a8437193bef9610640fc4" FOREIGN KEY ("redundancyStartActionId") REFERENCES "liquidity_management_action"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "liquidity_management_pipeline" ADD CONSTRAINT "FK_8ccbe4442593947caeafb3e3a53" FOREIGN KEY ("ruleId") REFERENCES "liquidity_management_rule"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "liquidity_management_pipeline" ADD CONSTRAINT "FK_e147892706eb3dd28e0775ba137" FOREIGN KEY ("currentActionId") REFERENCES "liquidity_management_action"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "liquidity_management_order" ADD CONSTRAINT "FK_1017b402d474e22b86ae7289a45" FOREIGN KEY ("pipelineId") REFERENCES "liquidity_management_pipeline"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "liquidity_management_order" ADD CONSTRAINT "FK_2bf0b69330bb42c83d5848b4758" FOREIGN KEY ("actionId") REFERENCES "liquidity_management_action"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "liquidity_balance" ADD CONSTRAINT "FK_6fc3b888ae3a44a5b847cb51f48" FOREIGN KEY ("assetId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "liquidity_balance" ADD CONSTRAINT "FK_b46544dea6db1e9e9dd04b8da9d" FOREIGN KEY ("fiatId") REFERENCES "fiat"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "liquidity_balance" DROP CONSTRAINT "FK_b46544dea6db1e9e9dd04b8da9d"`);
        await queryRunner.query(`ALTER TABLE "liquidity_balance" DROP CONSTRAINT "FK_6fc3b888ae3a44a5b847cb51f48"`);
        await queryRunner.query(`ALTER TABLE "liquidity_management_order" DROP CONSTRAINT "FK_2bf0b69330bb42c83d5848b4758"`);
        await queryRunner.query(`ALTER TABLE "liquidity_management_order" DROP CONSTRAINT "FK_1017b402d474e22b86ae7289a45"`);
        await queryRunner.query(`ALTER TABLE "liquidity_management_pipeline" DROP CONSTRAINT "FK_e147892706eb3dd28e0775ba137"`);
        await queryRunner.query(`ALTER TABLE "liquidity_management_pipeline" DROP CONSTRAINT "FK_8ccbe4442593947caeafb3e3a53"`);
        await queryRunner.query(`ALTER TABLE "liquidity_management_rule" DROP CONSTRAINT "FK_5c1302a8437193bef9610640fc4"`);
        await queryRunner.query(`ALTER TABLE "liquidity_management_rule" DROP CONSTRAINT "FK_c45953f23325ad4b4bf1352c578"`);
        await queryRunner.query(`ALTER TABLE "liquidity_management_rule" DROP CONSTRAINT "FK_8952855bd61ae683d3376d2f8bc"`);
        await queryRunner.query(`ALTER TABLE "liquidity_management_rule" DROP CONSTRAINT "FK_0a5e225a822550676a0d49bb6fe"`);
        await queryRunner.query(`ALTER TABLE "liquidity_management_action" DROP CONSTRAINT "FK_a9519dad89f7b8eb7281d64f5b6"`);
        await queryRunner.query(`ALTER TABLE "liquidity_management_action" DROP CONSTRAINT "FK_c8e2abac3a14beb669b1cfa12b9"`);
        await queryRunner.query(`DROP TABLE "liquidity_balance"`);
        await queryRunner.query(`DROP TABLE "liquidity_management_order"`);
        await queryRunner.query(`DROP TABLE "liquidity_management_pipeline"`);
        await queryRunner.query(`DROP TABLE "liquidity_management_rule"`);
        await queryRunner.query(`DROP TABLE "liquidity_management_action"`);
    }
}
