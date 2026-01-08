const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddSpecialZchfFeeUserData3630011767886374776 {
    name = 'AddSpecialZchfFeeUserData3630011767886374776'

    async up(queryRunner) {
        // 1. Create Special ZCHF 0.5% fee
        await queryRunner.query(`
            INSERT INTO "dbo"."fee" (
                "label", "type", "rate", "fixed", "assets", "active",
                "blockchainFactor", "payoutRefBonus", "usages", "txUsages"
            ) VALUES (
                'Special ZCHF 0.5%', 'Special', 0.005, 0, '251;253;255;256;258;259', 1,
                1, 1, 0, 0
            )
        `);

        // 2. Get the new fee ID and add it to userData 363001
        await queryRunner.query(`
            UPDATE "dbo"."user_data"
            SET "individualFees" = CASE
                WHEN "individualFees" IS NULL OR "individualFees" = ''
                    THEN CAST((SELECT MAX(id) FROM "dbo"."fee" WHERE "label" = 'Special ZCHF 0.5%') AS VARCHAR)
                ELSE "individualFees" + ';' + CAST((SELECT MAX(id) FROM "dbo"."fee" WHERE "label" = 'Special ZCHF 0.5%') AS VARCHAR)
            END
            WHERE "id" = 363001
        `);
    }

    async down(queryRunner) {
        // 1. Remove fee from userData 363001
        const feeIdResult = await queryRunner.query(`SELECT id FROM "dbo"."fee" WHERE "label" = 'Special ZCHF 0.5%'`);
        if (feeIdResult.length > 0) {
            const feeId = feeIdResult[0].id;

            // Remove fee ID from individualFees (handles both single and multiple fee scenarios)
            await queryRunner.query(`
                UPDATE "dbo"."user_data"
                SET "individualFees" = CASE
                    WHEN "individualFees" = '${feeId}' THEN NULL
                    WHEN "individualFees" LIKE '${feeId};%' THEN SUBSTRING("individualFees", ${String(feeId).length + 2}, LEN("individualFees"))
                    WHEN "individualFees" LIKE '%;${feeId}' THEN SUBSTRING("individualFees", 1, LEN("individualFees") - ${String(feeId).length + 1})
                    WHEN "individualFees" LIKE '%;${feeId};%' THEN REPLACE("individualFees", ';${feeId};', ';')
                    ELSE "individualFees"
                END
                WHERE "id" = 363001
            `);
        }

        // 2. Delete the fee
        await queryRunner.query(`DELETE FROM "dbo"."fee" WHERE "label" = 'Special ZCHF 0.5%'`);
    }
}
