// Bank transactions whose source and counterparty IBANs both belong to DFX bank
// accounts are internal balance transfers. Older imports fell through to GSheet,
// which caused FinanceLog to treat money in transit as missing instead of retaining
// it in plus balance.
module.exports = class ClassifyInternalBankTransfers1785738105000 {
  name = 'ClassifyInternalBankTransfers1785738105000';

  async up(queryRunner) {
    await queryRunner.query(`
      WITH "affected" AS (
        SELECT bt.id AS "bankTxId",
               bt.type AS "previousBankTxType",
               bt.updated AS "previousBankTxUpdated",
               bt."transactionId"
        FROM bank_tx bt
        WHERE (bt.type IS NULL OR bt.type IN ('GSheet', 'Pending', 'Unknown'))
          AND EXISTS (
            SELECT 1
            FROM bank source_bank
            WHERE regexp_replace(upper(source_bank.iban), '[^A-Za-z0-9]', '', 'g') =
                  regexp_replace(upper(bt."accountIban"), '[^A-Za-z0-9]', '', 'g')
          )
          AND EXISTS (
            SELECT 1
            FROM bank target_bank
            WHERE regexp_replace(upper(target_bank.iban), '[^A-Za-z0-9]', '', 'g') =
                  regexp_replace(upper(bt.iban), '[^A-Za-z0-9]', '', 'g')
          )
        FOR UPDATE OF bt
      ),
      "affectedTransactions" AS (
        SELECT a."bankTxId",
               tx.id AS "transactionId",
               tx.type AS "previousTransactionType",
               tx.updated AS "previousTransactionUpdated"
        FROM "affected" a
        INNER JOIN "transaction" tx ON tx.id = a."transactionId"
        FOR UPDATE OF tx
      ),
      "stamp" AS (
        SELECT now() AS "nextUpdated"
      ),
      "audit" AS (
        INSERT INTO "log" ("created", "updated", "system", "subsystem", "severity", "message")
        SELECT s."nextUpdated", s."nextUpdated", 'BankTx', 'InternalBankTransferBackfill', 'Info',
          json_agg(json_build_object(
            'bankTxId', a."bankTxId",
            'previousBankTxType', a."previousBankTxType",
            'nextBankTxType', 'Internal',
            'previousBankTxUpdated', a."previousBankTxUpdated",
            'nextBankTxUpdated', s."nextUpdated",
            'transactionId', a."transactionId",
            'previousTransactionType', affected_tx."previousTransactionType",
            'nextTransactionType', CASE WHEN affected_tx."transactionId" IS NULL THEN NULL ELSE 'Internal' END,
            'previousTransactionUpdated', affected_tx."previousTransactionUpdated",
            'nextTransactionUpdated', CASE WHEN affected_tx."transactionId" IS NULL THEN NULL ELSE s."nextUpdated" END
          ) ORDER BY a."bankTxId")::text
        FROM "affected" a
        LEFT JOIN "affectedTransactions" affected_tx ON affected_tx."bankTxId" = a."bankTxId"
        CROSS JOIN "stamp" s
        GROUP BY s."nextUpdated"
        HAVING count(*) > 0
        RETURNING 1
      ),
      "updatedBankTx" AS (
        UPDATE bank_tx bt
        SET type = 'Internal', updated = s."nextUpdated"
        FROM "affected" a
        CROSS JOIN "stamp" s
        WHERE bt.id = a."bankTxId" AND EXISTS (SELECT 1 FROM "audit")
        RETURNING bt."transactionId"
      )
      UPDATE "transaction" tx
      SET type = 'Internal', updated = s."nextUpdated"
      FROM "affectedTransactions" a
      CROSS JOIN "stamp" s
      WHERE tx.id = a."transactionId"
        AND EXISTS (SELECT 1 FROM "audit")
        AND EXISTS (
          SELECT 1
          FROM "updatedBankTx" updated
          WHERE updated."transactionId" = tx.id
        )
    `);
  }

  // Classification is not revoked automatically on rollback. The append-only migration
  // audit retains every exact previous/next type and timestamp for a separately reviewed,
  // guarded reversal without overwriting legitimate changes made after this migration.
  async down() {}
};
