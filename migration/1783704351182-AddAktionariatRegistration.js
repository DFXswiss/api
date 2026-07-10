/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Creates the queryable, per-wallet `aktionariat_registration` table that replaces the opaque JSON
 * blob previously carried on the generic kyc_step.result. One row per wallet (FK -> "user"), with a
 * partial unique index enforcing a single ACTIVE registration per wallet-user (historical rows stay
 * as active = false).
 *
 * Constraint/index names are TypeORM's deterministic DefaultNamingStrategy values —
 * `<prefix> + sha1(table + '_' + columns.sort().join('_') [+ '_' + where])` truncated to 27 hex
 * chars for PK_/UQ_/FK_/DF_ and 26 for IDX_/CHK_/XCL_/REL_ — so a future `migration:generate`
 * detects no drift against the entity's @PrimaryGeneratedColumn / @Index / @ManyToOne decorators.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddAktionariatRegistration1783704351182 {
    name = 'AddAktionariatRegistration1783704351182'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        // Fail fast instead of head-of-queue-blocking every "user" write if the FK's SHARE ROW
        // EXCLUSIVE lock on the hot "user" table is contended at deploy time: a timeout rolls the
        // migration back (transaction mode 'all') and Nest retries it rather than hanging app boot.
        await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
        await queryRunner.query(`CREATE TABLE "aktionariat_registration" ("id" SERIAL NOT NULL, "updated" TIMESTAMP NOT NULL DEFAULT now(), "created" TIMESTAMP NOT NULL DEFAULT now(), "walletAddress" character varying(256) NOT NULL, "email" character varying(256) NOT NULL, "registrationDate" character varying(256) NOT NULL, "signature" text NOT NULL, "signedPayload" text, "aktionariatUserId" character varying(256), "forwardedToAktionariatDate" TIMESTAMP, "confirmedDate" TIMESTAMP, "confirmationStatus" character varying(256), "active" boolean NOT NULL DEFAULT true, "userId" integer NOT NULL, CONSTRAINT "PK_af158ecdcaff6229223fe33f2ee" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_365c6bdac6a7883581aea34bbd" ON "aktionariat_registration" ("userId") WHERE "active" = true`);
        await queryRunner.query(`CREATE INDEX "IDX_21d1d4854aa5b13f2038752af0" ON "aktionariat_registration" ("userId") `);
        await queryRunner.query(`CREATE INDEX "IDX_754aadd3add69f81ce36ecfe33" ON "aktionariat_registration" ("walletAddress") `);
        await queryRunner.query(`ALTER TABLE "aktionariat_registration" ADD CONSTRAINT "FK_21d1d4854aa5b13f2038752af00" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "aktionariat_registration" DROP CONSTRAINT "FK_21d1d4854aa5b13f2038752af00"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_754aadd3add69f81ce36ecfe33"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_21d1d4854aa5b13f2038752af0"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_365c6bdac6a7883581aea34bbd"`);
        await queryRunner.query(`DROP TABLE "aktionariat_registration"`);
    }
}
