/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Creates the standalone, foreign-key-free audit table that documents — per wallet address —
 * whether and when a RealUnit registration was confirmed at Aktionariat (public
 * confirm-aktionariat endpoint). Only strings/timestamps are stored, deliberately no relations.
 *
 * Constraint names are TypeORM's deterministic
 * `<prefix> + sha1(table + '_' + columns.sort().join('_'))` values so a future
 * `migration:generate` detects no drift against the entity's @PrimaryGeneratedColumn / @Index().
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddRealUnitAddressConfirmation1783515852971 {
    name = 'AddRealUnitAddressConfirmation1783515852971'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "real_unit_address_confirmation" ("id" SERIAL NOT NULL, "updated" TIMESTAMP NOT NULL DEFAULT now(), "created" TIMESTAMP NOT NULL DEFAULT now(), "walletAddress" character varying(256) NOT NULL, "email" character varying(256) NOT NULL, "aktionariatUser" character varying(256) NOT NULL, "aktionariatCode" character varying(256) NOT NULL, "confirmedDate" TIMESTAMP, "responseStatus" integer, "response" text, CONSTRAINT "PK_0545f4521355f5be7157fd56468" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_cafb2b15fa9268c44081bba054" ON "real_unit_address_confirmation" ("walletAddress")`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "public"."IDX_cafb2b15fa9268c44081bba054"`);
        await queryRunner.query(`DROP TABLE "real_unit_address_confirmation"`);
    }
}
