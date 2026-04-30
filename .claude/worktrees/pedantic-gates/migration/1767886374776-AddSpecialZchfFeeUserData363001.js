const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddSpecialZchfFeeUserData3630011767886374776 {
    name = 'AddSpecialZchfFeeUserData3630011767886374776'

    async up(queryRunner) {
        // 1. Create Special ZCHF 0.5% fee (consistent with Fee 67, 111)
        await queryRunner.query(`
            INSERT INTO "dbo"."fee" (
                "label", "type", "rate", "fixed", "assets", "active",
                "blockchainFactor", "payoutRefBonus", "usages", "txUsages", "financialTypes"
            ) VALUES (
                'Special ZCHF 0.5% UserData 363001', 'Special', 0.005, 0, '251;253;255;256;258;259', 1,
                0, 1, 0, 0, 'CHF'
            )
        `);

        // 2. Get the new fee ID and add it to userData 363001
        await queryRunner.query(`
            UPDATE "dbo"."user_data"
            SET "individualFees" = CASE
                WHEN "individualFees" IS NULL OR "individualFees" = ''
                    THEN CAST((SELECT id FROM "dbo"."fee" WHERE "label" = 'Special ZCHF 0.5% UserData 363001') AS VARCHAR)
                ELSE "individualFees" + ';' + CAST((SELECT id FROM "dbo"."fee" WHERE "label" = 'Special ZCHF 0.5% UserData 363001') AS VARCHAR)
            END
            WHERE "id" = 363001
        `);
    }

    async down(queryRunner) {
        // 1. Get the fee ID
        const feeIdResult = await queryRunner.query(`
            SELECT id FROM "dbo"."fee" WHERE "label" = 'Special ZCHF 0.5% UserData 363001'
        `);

        if (feeIdResult.length > 0) {
            const feeId = feeIdResult[0].id.toString();

            // 2. Remove fee ID from userData 363001 individualFees
            // Handle all cases: only fee, first fee, last fee, middle fee
            await queryRunner.query(`
                UPDATE "dbo"."user_data"
                SET "individualFees" = CASE
                    WHEN "individualFees" = '${feeId}' THEN NULL
                    WHEN "individualFees" LIKE '${feeId};%' THEN STUFF("individualFees", 1, LEN('${feeId};'), '')
                    WHEN "individualFees" LIKE '%;${feeId}' THEN LEFT("individualFees", LEN("individualFees") - LEN(';${feeId}'))
                    WHEN "individualFees" LIKE '%;${feeId};%' THEN REPLACE("individualFees", ';${feeId};', ';')
                    ELSE "individualFees"
                END
                WHERE "id" = 363001
            `);
        }

        // 3. Delete the fee
        await queryRunner.query(`
            DELETE FROM "dbo"."fee" WHERE "label" = 'Special ZCHF 0.5% UserData 363001'
        `);
    }
}
