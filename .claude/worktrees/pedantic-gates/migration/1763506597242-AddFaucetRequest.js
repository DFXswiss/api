/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddFaucetRequest1763506597242 {
    name = 'AddFaucetRequest1763506597242'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "faucet_request" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_9bd3267c50f369e1b6e90e79e0c" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_d0cdbae31eca81238aaedde56df" DEFAULT getdate(), "txId" nvarchar(255) NOT NULL, "amount" float NOT NULL, "status" nvarchar(255) NOT NULL CONSTRAINT "DF_b6f6dce32b8329c41fe974b77a3" DEFAULT 'InProgress', "assetId" int NOT NULL, "userDataId" int NOT NULL, "userId" int NOT NULL, CONSTRAINT "PK_2d86d1fa603c361df0053688a41" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "faucet_request" ADD CONSTRAINT "FK_570c4af000f351d30d338636eaa" FOREIGN KEY ("assetId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "faucet_request" ADD CONSTRAINT "FK_c0f4196ecce9a6dfe6f41e3c15d" FOREIGN KEY ("userDataId") REFERENCES "user_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "faucet_request" ADD CONSTRAINT "FK_e1b7f08a82b3c6b369c6f173b46" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "faucet_request" DROP CONSTRAINT "FK_e1b7f08a82b3c6b369c6f173b46"`);
        await queryRunner.query(`ALTER TABLE "faucet_request" DROP CONSTRAINT "FK_c0f4196ecce9a6dfe6f41e3c15d"`);
        await queryRunner.query(`ALTER TABLE "faucet_request" DROP CONSTRAINT "FK_570c4af000f351d30d338636eaa"`);
        await queryRunner.query(`DROP TABLE "faucet_request"`);
    }
}
