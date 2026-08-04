/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Index `payment_link_payment ("deviceId")`.
 *
 * `PaymentLinkPaymentService.deliverToConnectedDevices` introduces the first lookup by that
 * column: while this process holds a websocket connection open for a device, it asks every 15
 * seconds whether a payment of that device has reached a state the device has to be told about.
 * `deviceId` carried no index, so that lookup would scan the whole table on every one of those
 * ticks for as long as a device stays connected.
 *
 * A single-column index is enough for the shape of the query. It filters `deviceId IN (…)` on the
 * handful of devices connected to this process; `expiryDate` and the status conditions are applied
 * to what that yields and are not part of the index. What the index removes is the scan of every
 * OTHER device's payments, which is the part that grows with the table. What it leaves is one
 * device's own history — bounded by how much that terminal has taken, not by the query.
 *
 * The name is the deterministic one TypeORM's `DefaultNamingStrategy` derives, since CONTRIBUTING
 * disallows custom index names: `IDX_` followed by the first 26 hex characters of
 * `sha1('payment_link_payment_deviceId')` (table name + `_` + the column name). It is pinned
 * against the entity in `payment-link-payment.entity.spec.ts`, so a rename on either side fails a
 * test rather than producing a second index the next generated migration would add.
 *
 * `CREATE INDEX CONCURRENTLY` is not used: migrations run inside a transaction (`migrationsRun` in
 * `src/config/config.ts`, TypeORM's default `migrationsTransactionMode: 'all'`), and CONCURRENTLY
 * is not allowed there. The plain form takes a SHARE lock, which blocks writes to the table — and
 * because locks are released at COMMIT, it holds until the whole pending batch commits.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddPaymentLinkPaymentDeviceIdIndex1785620000000 {
  name = 'AddPaymentLinkPaymentDeviceIdIndex1785620000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    // SET LOCAL is scoped to the whole TRANSACTION, and under `migrationsTransactionMode: 'all'`
    // that transaction is the entire pending batch — so this stays in force for every migration
    // that runs after it in the same deployment, not only for the statement below. That is
    // deliberate but worth knowing: a later migration that must wait on a lock inherits the five
    // seconds and fails the whole release rather than waiting. Whoever adds one sets its own
    // value.
    //
    // It bounds the WAIT for the lock, not how long the lock is held.
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`CREATE INDEX "IDX_8a9b97a10b3db9c64d45ae4d38" ON "payment_link_payment" ("deviceId")`);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    // SET LOCAL is scoped to the whole TRANSACTION, and under `migrationsTransactionMode: 'all'`
    // that transaction is the entire pending batch — so this stays in force for every migration
    // that runs after it in the same deployment, not only for the statement below. That is
    // deliberate but worth knowing: a later migration that must wait on a lock inherits the five
    // seconds and fails the whole release rather than waiting. Whoever adds one sets its own
    // value.
    //
    // It bounds the WAIT for the lock, not how long the lock is held.
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`DROP INDEX "public"."IDX_8a9b97a10b3db9c64d45ae4d38"`);
  }
};
