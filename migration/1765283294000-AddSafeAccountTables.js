/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddSafeAccountTables1765283294000 {
    name = 'AddSafeAccountTables1765283294000'

    async up(queryRunner) {
        // Create safe_account table
        await queryRunner.query(`
            CREATE TABLE "safe_account" (
                "id" int NOT NULL IDENTITY(1,1),
                "updated" datetime2 NOT NULL CONSTRAINT "DF_safe_account_updated" DEFAULT getdate(),
                "created" datetime2 NOT NULL CONSTRAINT "DF_safe_account_created" DEFAULT getdate(),
                "title" nvarchar(256) NOT NULL,
                "description" nvarchar(MAX),
                "requiredSignatures" int NOT NULL CONSTRAINT "DF_safe_account_requiredSignatures" DEFAULT 1,
                "status" nvarchar(256) NOT NULL CONSTRAINT "DF_safe_account_status" DEFAULT 'Active',
                "ownerId" int NOT NULL,
                CONSTRAINT "PK_safe_account" PRIMARY KEY ("id")
            )
        `);

        // Create safe_account_access table
        await queryRunner.query(`
            CREATE TABLE "safe_account_access" (
                "id" int NOT NULL IDENTITY(1,1),
                "updated" datetime2 NOT NULL CONSTRAINT "DF_safe_account_access_updated" DEFAULT getdate(),
                "created" datetime2 NOT NULL CONSTRAINT "DF_safe_account_access_created" DEFAULT getdate(),
                "accessLevel" nvarchar(256) NOT NULL,
                "safeAccountId" int NOT NULL,
                "userDataId" int NOT NULL,
                CONSTRAINT "PK_safe_account_access" PRIMARY KEY ("id")
            )
        `);

        // Create unique index on safe_account_access
        await queryRunner.query(`
            CREATE UNIQUE INDEX "IDX_safe_account_access_unique"
            ON "safe_account_access" ("safeAccountId", "userDataId")
        `);

        // Add foreign keys for safe_account
        await queryRunner.query(`
            ALTER TABLE "safe_account"
            ADD CONSTRAINT "FK_safe_account_owner"
            FOREIGN KEY ("ownerId") REFERENCES "user_data"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);

        // Add foreign keys for safe_account_access
        await queryRunner.query(`
            ALTER TABLE "safe_account_access"
            ADD CONSTRAINT "FK_safe_account_access_safeAccount"
            FOREIGN KEY ("safeAccountId") REFERENCES "safe_account"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);

        await queryRunner.query(`
            ALTER TABLE "safe_account_access"
            ADD CONSTRAINT "FK_safe_account_access_userData"
            FOREIGN KEY ("userDataId") REFERENCES "user_data"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);

        // Add safeAccountId to user table (nullable for legacy compatibility)
        await queryRunner.query(`
            ALTER TABLE "user" ADD "safeAccountId" int
        `);

        await queryRunner.query(`
            ALTER TABLE "user"
            ADD CONSTRAINT "FK_user_safeAccount"
            FOREIGN KEY ("safeAccountId") REFERENCES "safe_account"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);

        // Add safeAccountId to custody_balance table (nullable for legacy compatibility)
        await queryRunner.query(`
            ALTER TABLE "custody_balance" ADD "safeAccountId" int
        `);

        await queryRunner.query(`
            ALTER TABLE "custody_balance"
            ADD CONSTRAINT "FK_custody_balance_safeAccount"
            FOREIGN KEY ("safeAccountId") REFERENCES "safe_account"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);

        // Add safeAccountId and initiatedById to custody_order table (nullable for legacy compatibility)
        await queryRunner.query(`
            ALTER TABLE "custody_order" ADD "safeAccountId" int
        `);

        await queryRunner.query(`
            ALTER TABLE "custody_order" ADD "initiatedById" int
        `);

        await queryRunner.query(`
            ALTER TABLE "custody_order"
            ADD CONSTRAINT "FK_custody_order_safeAccount"
            FOREIGN KEY ("safeAccountId") REFERENCES "safe_account"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);

        await queryRunner.query(`
            ALTER TABLE "custody_order"
            ADD CONSTRAINT "FK_custody_order_initiatedBy"
            FOREIGN KEY ("initiatedById") REFERENCES "user_data"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
    }

    async down(queryRunner) {
        // Remove foreign keys from custody_order
        await queryRunner.query(`ALTER TABLE "custody_order" DROP CONSTRAINT "FK_custody_order_initiatedBy"`);
        await queryRunner.query(`ALTER TABLE "custody_order" DROP CONSTRAINT "FK_custody_order_safeAccount"`);
        await queryRunner.query(`ALTER TABLE "custody_order" DROP COLUMN "initiatedById"`);
        await queryRunner.query(`ALTER TABLE "custody_order" DROP COLUMN "safeAccountId"`);

        // Remove foreign key and column from custody_balance
        await queryRunner.query(`ALTER TABLE "custody_balance" DROP CONSTRAINT "FK_custody_balance_safeAccount"`);
        await queryRunner.query(`ALTER TABLE "custody_balance" DROP COLUMN "safeAccountId"`);

        // Remove foreign key and column from user
        await queryRunner.query(`ALTER TABLE "user" DROP CONSTRAINT "FK_user_safeAccount"`);
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "safeAccountId"`);

        // Drop safe_account_access table
        await queryRunner.query(`ALTER TABLE "safe_account_access" DROP CONSTRAINT "FK_safe_account_access_userData"`);
        await queryRunner.query(`ALTER TABLE "safe_account_access" DROP CONSTRAINT "FK_safe_account_access_safeAccount"`);
        await queryRunner.query(`DROP INDEX "IDX_safe_account_access_unique" ON "safe_account_access"`);
        await queryRunner.query(`DROP TABLE "safe_account_access"`);

        // Drop safe_account table
        await queryRunner.query(`ALTER TABLE "safe_account" DROP CONSTRAINT "FK_safe_account_owner"`);
        await queryRunner.query(`DROP TABLE "safe_account"`);
    }
}
