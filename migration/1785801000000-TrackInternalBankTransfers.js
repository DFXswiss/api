// Persist the ownership decision made when both sides of a bank transfer are DFX accounts.
// Seed only the active transition window so the historical backfill cannot re-enter FinancialLog;
// newly classified transfers keep the marker indefinitely, even if bank configuration changes.
module.exports = class TrackInternalBankTransfers1785801000000 {
  name = 'TrackInternalBankTransfers1785801000000';

  async up(queryRunner) {
    await queryRunner.query(`ALTER TABLE "bank_tx" ADD "isInternalTransfer" boolean`);

    await queryRunner.query(`
      WITH "stamp" AS (
        SELECT now() AS "trackingCutover"
      ),
      "classificationAudit" AS (
        SELECT (entry.value->>'bankTxId')::integer AS "bankTxId",
               l.created AS "classificationDate"
        FROM "log" l
        CROSS JOIN LATERAL jsonb_array_elements(l.message::jsonb) AS entry(value)
        WHERE l.subsystem = 'InternalBankTransferBackfill'
      ),
      "cutover" AS (
        SELECT COALESCE(MIN(a."classificationDate"), s."trackingCutover") AS "classificationCutover"
        FROM "stamp" s
        LEFT JOIN "classificationAudit" a ON true
        GROUP BY s."trackingCutover"
      ),
      "affected" AS (
        SELECT bt.id AS "bankTxId"
        FROM "bank_tx" bt
        CROSS JOIN "cutover" c
        WHERE bt.type = 'Internal'
          AND bt."isInternalTransfer" IS NULL
          AND bt.created >= c."classificationCutover" - INTERVAL '21 days'
          AND (
            bt.created >= c."classificationCutover"
            OR bt.id IN (SELECT "bankTxId" FROM "classificationAudit")
            OR (
              EXISTS (
                SELECT 1
                FROM bank source_bank
                WHERE upper(regexp_replace(source_bank.iban, '[^A-Za-z0-9]', '', 'g')) =
                      upper(regexp_replace(bt."accountIban", '[^A-Za-z0-9]', '', 'g'))
              )
              AND EXISTS (
                SELECT 1
                FROM bank target_bank
                WHERE upper(regexp_replace(target_bank.iban, '[^A-Za-z0-9]', '', 'g')) =
                      upper(regexp_replace(bt.iban, '[^A-Za-z0-9]', '', 'g'))
              )
            )
          )
        FOR UPDATE OF bt
      ),
      "audit" AS (
        INSERT INTO "log" ("created", "updated", "system", "subsystem", "severity", "message")
        SELECT s."trackingCutover", s."trackingCutover", 'BankTx', 'InternalBankTransferTrackingBackfill', 'Info',
               json_build_object(
                 'trackingCutover', s."trackingCutover",
                 'changes', COALESCE(
                   json_agg(json_build_object(
                     'bankTxId', a."bankTxId",
                     'previousIsInternalTransfer', NULL,
                     'nextIsInternalTransfer', true,
                     'changedAt', s."trackingCutover"
                   ) ORDER BY a."bankTxId") FILTER (WHERE a."bankTxId" IS NOT NULL),
                   '[]'::json
                 )
               )::text
        FROM "stamp" s
        LEFT JOIN "affected" a ON true
        GROUP BY s."trackingCutover"
        RETURNING 1
      )
      UPDATE "bank_tx" bt
      SET "isInternalTransfer" = true
      FROM "affected" a
      WHERE bt.id = a."bankTxId"
        AND EXISTS (SELECT 1 FROM "audit")
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_66dba7f36cb315d68512b34379" ON "bank_tx" ("type", "isInternalTransfer")`,
    );
  }

  async down(queryRunner) {
    await queryRunner.query(`DROP INDEX "public"."IDX_66dba7f36cb315d68512b34379"`);
    await queryRunner.query(`ALTER TABLE "bank_tx" DROP COLUMN "isInternalTransfer"`);
  }
};
