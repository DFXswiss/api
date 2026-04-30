const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class PaymentRelationsNonNullable1723196698943 {
    name = 'PaymentRelationsNonNullable1723196698943'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "payment_link" DROP CONSTRAINT "FK_4585705bcdfb4cdcfd66c868815"`);
        await queryRunner.query(`ALTER TABLE "payment_link" ALTER COLUMN "routeId" int NOT NULL`);
        await queryRunner.query(`ALTER TABLE "payment_link" ADD CONSTRAINT "FK_4585705bcdfb4cdcfd66c868815" FOREIGN KEY ("routeId") REFERENCES "deposit_route"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);

        await queryRunner.query(`DROP INDEX "IDX_dc2eab70eaa019d464b94df339" ON "payment_link_payment"`);
        await queryRunner.query(`ALTER TABLE "payment_link_payment" DROP CONSTRAINT "FK_bf8d7cc746a822b493009acc332"`);
        await queryRunner.query(`ALTER TABLE "payment_link_payment" ALTER COLUMN "linkId" int NOT NULL`);
        await queryRunner.query(`ALTER TABLE "payment_link_payment" ADD CONSTRAINT "FK_bf8d7cc746a822b493009acc332" FOREIGN KEY ("linkId") REFERENCES "payment_link"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_dc2eab70eaa019d464b94df339" ON "payment_link_payment" ("linkId") WHERE status = 'Pending'`);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "IDX_dc2eab70eaa019d464b94df339" ON "payment_link_payment"`);
        await queryRunner.query(`ALTER TABLE "payment_link_payment" DROP CONSTRAINT "FK_bf8d7cc746a822b493009acc332"`);
        await queryRunner.query(`ALTER TABLE "payment_link_payment" ALTER COLUMN "linkId" int`);
        await queryRunner.query(`ALTER TABLE "payment_link_payment" ADD CONSTRAINT "FK_bf8d7cc746a822b493009acc332" FOREIGN KEY ("linkId") REFERENCES "payment_link"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_dc2eab70eaa019d464b94df339" ON "payment_link_payment" ("linkId") WHERE status = 'Pending'`);

        await queryRunner.query(`ALTER TABLE "payment_link" DROP CONSTRAINT "FK_4585705bcdfb4cdcfd66c868815"`);
        await queryRunner.query(`ALTER TABLE "payment_link" ALTER COLUMN "routeId" int`);
        await queryRunner.query(`ALTER TABLE "payment_link" ADD CONSTRAINT "FK_4585705bcdfb4cdcfd66c868815" FOREIGN KEY ("routeId") REFERENCES "deposit_route"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }
}
