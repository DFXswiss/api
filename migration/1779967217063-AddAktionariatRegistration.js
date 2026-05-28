/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddAktionariatRegistration1779967217063 {
    name = 'AddAktionariatRegistration1779967217063'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "aktionariat_registration" ("id" SERIAL NOT NULL, "updated" TIMESTAMP NOT NULL DEFAULT now(), "created" TIMESTAMP NOT NULL DEFAULT now(), "walletAddress" character varying(256) NOT NULL, "status" character varying(256) NOT NULL, "signature" text NOT NULL, "registrationDate" character varying(256) NOT NULL, "externalRef" character varying(256), "comment" text, "result" text, "userId" integer NOT NULL, "userDataId" integer NOT NULL, "kycStepId" integer, CONSTRAINT "PK_af158ecdcaff6229223fe33f2ee" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_21d1d4854aa5b13f2038752af0" ON "aktionariat_registration" ("userId") `);
        await queryRunner.query(`CREATE INDEX "IDX_071503c6951cd10097327edffc" ON "aktionariat_registration" ("userDataId") `);
        await queryRunner.query(`CREATE INDEX "IDX_63e3c8146435a6c91532b45e0e" ON "aktionariat_registration" ("kycStepId") `);
        await queryRunner.query(`CREATE INDEX "IDX_754aadd3add69f81ce36ecfe33" ON "aktionariat_registration" ("walletAddress") `);
        await queryRunner.query(`ALTER TABLE "aktionariat_registration" ADD CONSTRAINT "FK_21d1d4854aa5b13f2038752af00" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "aktionariat_registration" ADD CONSTRAINT "FK_071503c6951cd10097327edffc6" FOREIGN KEY ("userDataId") REFERENCES "user_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "aktionariat_registration" ADD CONSTRAINT "FK_63e3c8146435a6c91532b45e0e9" FOREIGN KEY ("kycStepId") REFERENCES "kyc_step"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);

        // Backfill from existing kyc_step rows (latest non-failed step per wallet)
        await queryRunner.query(`
            INSERT INTO "aktionariat_registration" ("walletAddress", "status", "signature", "registrationDate", "result", "userId", "userDataId", "kycStepId")
            SELECT DISTINCT ON (LOWER(ks."result"::json->>'walletAddress'))
                ks."result"::json->>'walletAddress',
                ks."status",
                ks."result"::json->>'signature',
                COALESCE(ks."result"::json->>'registrationDate', ''),
                ks."result",
                u."id",
                ks."userDataId",
                ks."id"
            FROM "kyc_step" ks
            JOIN "user" u ON LOWER(u."address") = LOWER(ks."result"::json->>'walletAddress')
            WHERE ks."name" = 'RealUnitRegistration'
              AND ks."status" NOT IN ('Failed', 'Canceled')
              AND ks."result" IS NOT NULL
              AND ks."result"::json->>'walletAddress' IS NOT NULL
            ORDER BY LOWER(ks."result"::json->>'walletAddress'), ks."id" DESC
        `);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "aktionariat_registration" DROP CONSTRAINT "FK_63e3c8146435a6c91532b45e0e9"`);
        await queryRunner.query(`ALTER TABLE "aktionariat_registration" DROP CONSTRAINT "FK_071503c6951cd10097327edffc6"`);
        await queryRunner.query(`ALTER TABLE "aktionariat_registration" DROP CONSTRAINT "FK_21d1d4854aa5b13f2038752af00"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_754aadd3add69f81ce36ecfe33"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_63e3c8146435a6c91532b45e0e"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_071503c6951cd10097327edffc"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_21d1d4854aa5b13f2038752af0"`);
        await queryRunner.query(`DROP TABLE "aktionariat_registration"`);
    }
}
