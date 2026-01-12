const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddUserData301484ToZchfFee1767888333076 {
    name = 'AddUserData301484ToZchfFee1767888333076'

    async up(queryRunner) {
        // 1. Rename fee label to be generic (remove UserData 363001 reference)
        await queryRunner.query(`
            UPDATE "dbo"."fee"
            SET "label" = 'Special ZCHF 0.5%'
            WHERE "label" = 'Special ZCHF 0.5% UserData 363001'
        `);

        // 2. Add fee to userData 301484
        await queryRunner.query(`
            UPDATE "dbo"."user_data"
            SET "individualFees" = CASE
                WHEN "individualFees" IS NULL OR "individualFees" = ''
                    THEN CAST((SELECT id FROM "dbo"."fee" WHERE "label" = 'Special ZCHF 0.5%') AS VARCHAR)
                ELSE "individualFees" + ';' + CAST((SELECT id FROM "dbo"."fee" WHERE "label" = 'Special ZCHF 0.5%') AS VARCHAR)
            END
            WHERE "id" = 301484
        `);
    }

    async down(queryRunner) {
        // 1. Get the fee ID
        const feeIdResult = await queryRunner.query(`
            SELECT id FROM "dbo"."fee" WHERE "label" = 'Special ZCHF 0.5%'
        `);

        if (feeIdResult.length > 0) {
            const feeId = feeIdResult[0].id.toString();

            // 2. Remove fee ID from userData 301484 individualFees
            await queryRunner.query(`
                UPDATE "dbo"."user_data"
                SET "individualFees" = CASE
                    WHEN "individualFees" = '${feeId}' THEN NULL
                    WHEN "individualFees" LIKE '${feeId};%' THEN STUFF("individualFees", 1, LEN('${feeId};'), '')
                    WHEN "individualFees" LIKE '%;${feeId}' THEN LEFT("individualFees", LEN("individualFees") - LEN(';${feeId}'))
                    WHEN "individualFees" LIKE '%;${feeId};%' THEN REPLACE("individualFees", ';${feeId};', ';')
                    ELSE "individualFees"
                END
                WHERE "id" = 301484
            `);
        }

        // 3. Restore original label
        await queryRunner.query(`
            UPDATE "dbo"."fee"
            SET "label" = 'Special ZCHF 0.5% UserData 363001'
            WHERE "label" = 'Special ZCHF 0.5%'
        `);
    }
}
