// Persist the ownership decision made when both sides of a bank transfer are DFX accounts.
// Seed only the active transition window so the historical backfill cannot re-enter FinancialLog;
// newly classified transfers keep the marker indefinitely, even if bank configuration changes.
module.exports = class TrackInternalBankTransfers1785801000000 {
  name = 'TrackInternalBankTransfers1785801000000';

  async up(queryRunner) {
    await queryRunner.query(`ALTER TABLE "bank_tx" ADD "isInternalTransfer" boolean NOT NULL DEFAULT false`);

    await queryRunner.query(`
      WITH "classificationAudit" AS (
        SELECT (entry.value->>'bankTxId')::integer AS "bankTxId",
               l.created AS "classificationDate"
        FROM "log" l
        CROSS JOIN LATERAL jsonb_array_elements(l.message::jsonb) AS entry(value)
        WHERE l.subsystem = 'InternalBankTransferBackfill'
      ),
      "cutover" AS (
        SELECT MIN("classificationDate") AS "cutoverDate"
        FROM "classificationAudit"
      ),
      "affected" AS (
        SELECT bt.id AS "bankTxId"
        FROM "bank_tx" bt
        CROSS JOIN "cutover" c
        WHERE bt.type = 'Internal'
          AND c."cutoverDate" IS NOT NULL
          AND bt.created >= c."cutoverDate" - INTERVAL '21 days'
          AND (
            bt.id IN (SELECT "bankTxId" FROM "classificationAudit")
            OR (
              bt.created >= c."cutoverDate"
              AND EXISTS (
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
        SELECT now(), now(), 'BankTx', 'InternalBankTransferTrackingBackfill', 'Info',
               json_agg(json_build_object('bankTxId', a."bankTxId") ORDER BY a."bankTxId")::text
        FROM "affected" a
        HAVING count(*) > 0
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
