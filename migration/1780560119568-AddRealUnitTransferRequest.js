/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddRealUnitTransferRequest1780560119568 {
    name = 'AddRealUnitTransferRequest1780560119568'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "real_unit_transfer_request" ("id" SERIAL NOT NULL, "updated" TIMESTAMP NOT NULL DEFAULT now(), "created" TIMESTAMP NOT NULL DEFAULT now(), "uid" character varying(256) NOT NULL, "toAddress" character varying(256) NOT NULL, "amount" double precision NOT NULL, "status" character varying(256) NOT NULL DEFAULT 'Created', "txHash" character varying(256), "userId" integer NOT NULL, CONSTRAINT "UQ_93d6119c8606cddf2670d72b2d7" UNIQUE ("uid"), CONSTRAINT "PK_de3e9bfb56e01d7ed129a666692" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_9cdaf342da47974d7bded88063" ON "real_unit_transfer_request" ("userId") `);
        await queryRunner.query(`ALTER TABLE "real_unit_transfer_request" ADD CONSTRAINT "FK_9cdaf342da47974d7bded88063d" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "real_unit_transfer_request" DROP CONSTRAINT "FK_9cdaf342da47974d7bded88063d"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_9cdaf342da47974d7bded88063"`);
        await queryRunner.query(`DROP TABLE "real_unit_transfer_request"`);
    }
}
