// Bank transactions whose source and counterparty IBANs both belong to DFX bank
// accounts are internal balance transfers. Older imports fell through to GSheet,
// which caused FinanceLog to treat money in transit as missing instead of retaining
// it in plus balance.
module.exports = class ClassifyInternalBankTransfers1785738105000 {
  name = 'ClassifyInternalBankTransfers1785738105000';

  async up(queryRunner) {
    await queryRunner.query(`
      WITH internal_bank_tx AS (
        SELECT bt.id, bt."transactionId"
        FROM bank_tx bt
        WHERE (bt.type IS NULL OR bt.type IN ('GSheet', 'Pending', 'Unknown'))
          AND EXISTS (
            SELECT 1
            FROM bank source_bank
            WHERE regexp_replace(upper(source_bank.iban), '\\s', '', 'g') =
                  regexp_replace(upper(bt."accountIban"), '\\s', '', 'g')
          )
          AND EXISTS (
            SELECT 1
            FROM bank target_bank
            WHERE regexp_replace(upper(target_bank.iban), '\\s', '', 'g') =
                  regexp_replace(upper(bt.iban), '\\s', '', 'g')
          )
      ), updated_bank_tx AS (
        UPDATE bank_tx
        SET type = 'Internal', updated = now()
        WHERE id IN (SELECT id FROM internal_bank_tx)
        RETURNING "transactionId"
      )
      UPDATE "transaction"
      SET type = 'Internal', updated = now()
      WHERE id IN (
        SELECT "transactionId"
        FROM updated_bank_tx
        WHERE "transactionId" IS NOT NULL
      )
    `);
  }

  // The previous values are intentionally not guessed on rollback: some rows were
  // NULL, others GSheet/Pending/Unknown. Reverting them without an audit column would
  // corrupt valid classifications.
  async down() {}
};
