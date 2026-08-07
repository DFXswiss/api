// Set sellPriceSource = 'Denario:bid' on the two Denario price rules outside prd only.
//
// Companion to LinkDenarioPriceRules1786100000000 (creates the rules and links assets outside prd)
// and AddPriceRuleSellPrice1786300000000 (adds the sellPriceSource / currentSellPrice columns).
//
// Outside prd only:
// 1. Find the Denario DGC and DSC price rules by (priceSource, priceAsset, priceReference).
// 2. Set sellPriceSource to 'Denario:bid' so the sell path fetches priceBid.
//
// prd is a deliberate no-op: Denario tokens stay unpriced and untradable there
// (see LinkDenarioPriceRules / EnableDenarioAssetsOutsidePrd).

/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

const AUDIT_MIGRATION = 'SetDenarioSellPriceSource1786400000000';
const APPLY_ACTION = 'applySetDenarioSellPriceSource';
const ROLLBACK_ACTION = 'rollbackSetDenarioSellPriceSource';
// Transaction-scoped advisory lock key: this migration's timestamp. Unique across migrations by naming
// convention and outside hashtext()'s 32-bit range (see LinkDenarioPriceRules).
const ADVISORY_LOCK_KEY = 1786400000000;

const SELL_PRICE_SOURCE = 'Denario:bid';

const TARGET_RULES = [
  { priceSource: 'Denario', priceAsset: 'DGC', priceReference: 'USD' },
  { priceSource: 'Denario', priceAsset: 'DSC', priceReference: 'USD' },
];

/**
 * Return the single apply event that has not yet been matched by a rollback event.
 * Audit rows live in the append-only "log" table; pairing is pure application logic via action and
 * applyLogId in the JSON message payload.
 *
 * @param {QueryRunner} queryRunner
 * @returns {Promise<({ id: number } & Record<string, unknown>) | undefined>}
 */
async function getActiveApplyAudit(queryRunner) {
  // Serialize concurrent apply/reapply/rollback of this migration within the transaction.
  await queryRunner.query(`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_KEY})`);

  const rows = await queryRunner.query(
    `SELECT "id", "message" FROM "log"
     WHERE "system" = 'Migration' AND "subsystem" = $1
     ORDER BY "id"`,
    Array.of(AUDIT_MIGRATION),
  );

  const applies = [];
  const rolledBackApplyIds = new Set();

  for (const row of rows) {
    const logId = Number(row.id);
    if (!Number.isSafeInteger(logId) || logId <= 0) {
      throw new Error(`Invalid audit event id '${row.id}' for ${AUDIT_MIGRATION}`);
    }

    let event;
    try {
      event = typeof row.message === 'string' ? JSON.parse(row.message) : row.message;
    } catch {
      throw new Error(`Corrupt audit event ${logId} for ${AUDIT_MIGRATION}`);
    }
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
      throw new Error(`Invalid audit payload ${logId} for ${AUDIT_MIGRATION}`);
    }

    if (event.action === APPLY_ACTION) {
      if (!Array.isArray(event.rules)) {
        throw new Error(`Invalid apply audit event ${logId} for ${AUDIT_MIGRATION}`);
      }
      applies.push({ ...event, id: logId });
    } else if (event.action === ROLLBACK_ACTION) {
      const applyLogId = Number(event.applyLogId);
      if (!Number.isSafeInteger(applyLogId) || applyLogId <= 0) {
        throw new Error(`Invalid rollback audit event ${logId} for ${AUDIT_MIGRATION}`);
      }
      rolledBackApplyIds.add(applyLogId);
    } else {
      throw new Error(`Invalid audit action '${event.action}' for ${AUDIT_MIGRATION}`);
    }
  }

  const activeApplies = applies.filter((event) => !rolledBackApplyIds.has(event.id));
  if (activeApplies.length > 1) {
    throw new Error(`Ambiguous audit state for ${AUDIT_MIGRATION}: ${activeApplies.length} active apply events`);
  }

  return activeApplies.at(0);
}

/**
 * Append an audit event to "log" and fail closed if the insert does not return an id.
 *
 * @param {QueryRunner} queryRunner
 * @param {Record<string, unknown>} event
 * @returns {Promise<void>}
 */
async function writeAuditEvent(queryRunner, event) {
  const isApply = event.action === APPLY_ACTION;
  const isRollback = event.action === ROLLBACK_ACTION;
  if (!isApply && !isRollback) throw new Error(`Invalid audit action for ${AUDIT_MIGRATION}`);

  const inserted = await queryRunner.query(
    `INSERT INTO "log" ("created", "updated", "system", "subsystem", "severity", "message")
     VALUES (NOW(), NOW(), 'Migration', $1, 'Info', $2)
     RETURNING "id"`,
    [AUDIT_MIGRATION, JSON.stringify(event)],
  );
  const logId = Number(inserted?.at?.(0)?.id);
  if (!Number.isSafeInteger(logId) || logId <= 0) {
    throw new Error(`Failed to write audit event for ${AUDIT_MIGRATION}`);
  }
}

/**
 * Load a Denario price rule by its semantic identity. Fail-loud if missing or ambiguous.
 *
 * @param {QueryRunner} queryRunner
 * @param {{ priceSource: string, priceAsset: string, priceReference: string }} target
 * @returns {Promise<{ id: number, sellPriceSource: string | null }>}
 */
async function loadTargetRule(queryRunner, target) {
  const rows = await queryRunner.query(
    `SELECT "id", "sellPriceSource" FROM "price_rule"
     WHERE "priceSource" = $1 AND "priceAsset" = $2 AND "priceReference" = $3
     ORDER BY "id" FOR UPDATE`,
    [target.priceSource, target.priceAsset, target.priceReference],
  );

  if (rows.length === 0) {
    throw new Error(
      `Required Denario price rule ${target.priceSource}/${target.priceAsset}/${target.priceReference} was not found`,
    );
  }
  if (rows.length > 1) {
    throw new Error(
      `Denario price rule ${target.priceSource}/${target.priceAsset}/${target.priceReference} is ambiguous: found ${rows.length} rows`,
    );
  }

  const row = rows.at(0);
  const id = Number(row.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error(`Invalid price_rule id '${row.id}' for ${target.priceAsset}`);
  }

  return {
    id,
    sellPriceSource: row.sellPriceSource == null ? null : String(row.sellPriceSource),
  };
}

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class SetDenarioSellPriceSource1786400000000 {
  name = 'SetDenarioSellPriceSource1786400000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    // prd deliberately keeps DGC/DSC unpriced; there are no Denario rules to update there.
    if (process.env.ENVIRONMENT === 'prd') return;

    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);

    // TypeORM can call a migration object more than once in tests or recovery tooling. An unmatched
    // apply event proves this migration already owns its exact column updates.
    if (await getActiveApplyAudit(queryRunner)) return;

    // Validate every target before any update so a missing second rule cannot leave a half-applied state.
    // Written out instead of an indexed access type: the migration psql guard treats any
    // bracket-quoted identifier as MSSQL syntax, including one inside a JSDoc annotation.
    /** @type {{ target: { priceSource: string, priceAsset: string, priceReference: string }, rule: { id: number, sellPriceSource: string | null } }[]} */
    const prepared = [];
    for (const target of TARGET_RULES) {
      const rule = await loadTargetRule(queryRunner, target);

      // Already at the desired value: still record the before→after (no-op change) so down() can
      // restore ownership-safely. Refuse a foreign non-null value that is not our target.
      if (rule.sellPriceSource != null && rule.sellPriceSource !== SELL_PRICE_SOURCE) {
        throw new Error(
          `price_rule ${rule.id} (${target.priceAsset}) already has sellPriceSource='${rule.sellPriceSource}'; refusing overwrite`,
        );
      }

      prepared.push({ target, rule });
    }

    /** @type {{ ruleId: number, priceAsset: string, previousSellPriceSource: string | null, nextSellPriceSource: string }[]} */
    const transitions = prepared.map(({ target, rule }) => ({
      ruleId: rule.id,
      priceAsset: target.priceAsset,
      previousSellPriceSource: rule.sellPriceSource,
      nextSellPriceSource: SELL_PRICE_SOURCE,
    }));

    // Fail-closed: persist the exact before → after transition before mutating rows.
    await writeAuditEvent(queryRunner, {
      action: APPLY_ACTION,
      rules: transitions,
    });

    for (const transition of transitions) {
      // Only write when still at the audited previous value (null or already SELL_PRICE_SOURCE).
      await queryRunner.query(
        `UPDATE "price_rule"
         SET "sellPriceSource" = $1, "updated" = NOW()
         WHERE "id" = $2
           AND (
             ("sellPriceSource" IS NULL AND $3::text IS NULL)
             OR "sellPriceSource" = $3
           )`,
        [transition.nextSellPriceSource, transition.ruleId, transition.previousSellPriceSource],
      );

      const after = (
        await queryRunner.query(`SELECT "sellPriceSource" FROM "price_rule" WHERE "id" = $1`, [transition.ruleId])
      ).at(0);

      if (String(after?.sellPriceSource) !== transition.nextSellPriceSource) {
        throw new Error(
          `price_rule ${transition.ruleId} (${transition.priceAsset}) sellPriceSource changed concurrently; migration aborted`,
        );
      }
    }
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    // Mirror up(): the apply only ran outside prd, so the rollback is a no-op on prd.
    if (process.env.ENVIRONMENT === 'prd') return;

    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);

    const applyAudit = await getActiveApplyAudit(queryRunner);
    if (!applyAudit) return;

    const rules = applyAudit.rules;
    if (!Array.isArray(rules)) {
      throw new Error(`Invalid ownership audit in ${AUDIT_MIGRATION}`);
    }

    // Verify each rule still carries the value this migration applied; refuse foreign changes.
    for (const transition of rules) {
      const ruleId = Number(transition?.ruleId);
      if (!Number.isSafeInteger(ruleId) || ruleId <= 0) {
        throw new Error(`Invalid rule transition in ${AUDIT_MIGRATION}`);
      }

      const current = (
        await queryRunner.query(
          `SELECT "sellPriceSource", "priceAsset" FROM "price_rule" WHERE "id" = $1 FOR UPDATE`,
          Array.of(ruleId),
        )
      ).at(0);

      if (!current) {
        throw new Error(`price_rule id ${ruleId} missing during rollback of ${AUDIT_MIGRATION}`);
      }
      if (current.priceAsset !== transition.priceAsset) {
        throw new Error(
          `price_rule id ${ruleId} priceAsset changed ('${current.priceAsset}' vs '${transition.priceAsset}'); refusing rollback`,
        );
      }

      const currentSell = current.sellPriceSource == null ? null : String(current.sellPriceSource);
      if (currentSell !== transition.nextSellPriceSource) {
        throw new Error(
          `price_rule ${ruleId} (${transition.priceAsset}) sellPriceSource changed since apply ('${currentSell}' vs '${transition.nextSellPriceSource}'); refusing rollback`,
        );
      }
    }

    await writeAuditEvent(queryRunner, {
      action: ROLLBACK_ACTION,
      applyLogId: applyAudit.id,
      restoredRules: rules.map((t) => ({
        ruleId: t.ruleId,
        priceAsset: t.priceAsset,
        previousSellPriceSource: t.nextSellPriceSource,
        nextSellPriceSource: t.previousSellPriceSource,
      })),
    });

    for (const transition of rules) {
      await queryRunner.query(
        `UPDATE "price_rule"
         SET "sellPriceSource" = $1, "updated" = NOW()
         WHERE "id" = $2 AND "sellPriceSource" = $3`,
        [transition.previousSellPriceSource, transition.ruleId, transition.nextSellPriceSource],
      );

      const after = (
        await queryRunner.query(`SELECT "sellPriceSource" FROM "price_rule" WHERE "id" = $1`, [transition.ruleId])
      ).at(0);

      const afterSell = after?.sellPriceSource == null ? null : String(after.sellPriceSource);
      const expected = transition.previousSellPriceSource == null ? null : String(transition.previousSellPriceSource);
      if (afterSell !== expected) {
        throw new Error(
          `price_rule ${transition.ruleId} (${transition.priceAsset}) rollback changed concurrently; migration aborted`,
        );
      }
    }
  }
};
