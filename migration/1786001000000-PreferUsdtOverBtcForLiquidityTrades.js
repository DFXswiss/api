/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

const AUDIT_MIGRATION = 'PreferUsdtOverBtcForLiquidityTrades1786001000000';
const APPLY_ACTION = 'applyPreferUsdtOverBtc';
const ROLLBACK_ACTION = 'rollbackPreferUsdtOverBtc';
// Transaction-scoped advisory lock key: this migration's timestamp. Unique across migrations by
// naming convention (same pattern as LinkOndoPriceRule / AddSavingZchfAsset).
const ADVISORY_LOCK_KEY = 1786001000000;

/**
 * Prefer USDT over BTC for Binance liquidity-management deficit buy chains.
 *
 * Context: Binance delisted / broke several * /BTC markets (empty order book, status BREAK).
 * The deficit chain historically tried BTC first (W --onFail--> B --onFail--> U --onFail--> T),
 * so a TypeError on empty order books killed the pipeline instead of following the onFail path.
 *
 * Unlike LinkOndoPriceRule / DeactivateTradingRules this migration is NOT gated on
 * ENVIRONMENT === 'prd'. The 17 pair ids are structural identities (system=Binance, command=buy,
 * expected B --onFail--> U edge). Missing rows are skipped; unexpected edges throw. Lower
 * environments without LM seed data therefore no-op safely without a blind env gate.
 *
 * A1 — Swap fail-order for 17 Binance buy pairs (BTC, USDT): USDT first, BTC as fallback.
 * A2 — WBTC keeps a fully separate BTC-first chain via B2/U2/W2 clones (B.onFailId is shared;
 *      patching B alone would change every path that reaches B, including WBTC).
 * A3 — Deactivate all Active DAI rules (no Binance DAI market; DFX buyable=false on all DAI).
 *
 * Auditable: overwrites are planned in memory, written to log as a single apply event with
 * before/after entries, then applied. Clones (pure INSERTs) are created before the audit row;
 * TypeORM's migration transaction rolls them back if the audit insert fails.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class PreferUsdtOverBtcForLiquidityTrades1786001000000 {
  name = 'PreferUsdtOverBtcForLiquidityTrades1786001000000';

  // (BTC buy action id, USDT buy action id) — system=Binance, command=buy
  pairs = [
    [10, 13],
    [16, 17],
    [19, 20],
    [22, 23],
    [25, 26],
    [30, 31],
    [41, 42],
    [45, 46],
    [53, 54],
    [57, 58],
    [61, 62],
    [142, 143],
    [155, 156],
    [172, 173],
    [181, 182],
    [219, 220],
    [244, 245],
  ];

  /**
   * Return the single apply event that has not yet been matched by a rollback event.
   * Audit rows live in the append-only "log" table; pairing is pure application logic via action
   * and applyLogId in the JSON message payload. Acquires pg_advisory_xact_lock first so concurrent
   * up()/down() instances cannot both read "no active apply" and each create their own clone chain
   * (same pattern as LinkOndoPriceRule.getActiveApplyAudit).
   *
   * @param {QueryRunner} queryRunner
   * @returns {Promise<({ id: number, entries: unknown[] } & Record<string, unknown>) | undefined>}
   */
  async getActiveApply(queryRunner) {
    // Serialize concurrent up()/down() of this migration: without this, two migration runners
    // starting at the same time could both read "no active apply" and each create their own
    // clone chain. Same pattern as LinkOndoPriceRule.getActiveApplyAudit.
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
        if (!Array.isArray(event.entries)) {
          throw new Error(`Invalid apply audit event ${logId} for ${AUDIT_MIGRATION}: missing entries`);
        }
        applies.push({ ...event, id: logId, entries: event.entries });
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
   * @returns {Promise<number>}
   */
  async writeAuditEvent(queryRunner, event) {
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
    return logId;
  }

  /**
   * @param {string | null | undefined} tag
   * @returns {string}
   */
  wbtcTag(tag) {
    return tag == null ? 'WBTC' : `${tag} WBTC`;
  }

  /**
   * @param {QueryRunner} queryRunner
   * @param {{ system: string, command: string, tag: string | null, params: string | null, onSuccessId: number | null, onFailId: number | null }} source
   * @param {string} tag
   * @param {number | null} onFailId
   * @returns {Promise<number>}
   */
  async insertClone(queryRunner, source, tag, onFailId) {
    const inserted = await queryRunner.query(
      `INSERT INTO "liquidity_management_action"
         ("system", "command", "tag", "params", "onSuccessId", "onFailId")
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING "id"`,
      [source.system, source.command, tag, source.params, source.onSuccessId, onFailId],
    );
    const id = Number(inserted?.at?.(0)?.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new Error(`Failed to insert liquidity_management_action clone for ${AUDIT_MIGRATION}`);
    }
    return id;
  }

  /**
   * Validate every audit entry before down() mutates anything, and split them into two strictly
   * disjoint, normalized forms. `entries` comes from the "log" table, which is not trusted
   * internal state: BANKING_BOT can create log rows and ADMIN can edit an existing message
   * (log.controller.ts, create-log.dto.ts accept arbitrary system/subsystem/message strings with
   * no allowlist). Column entries and clone entries must never mix fields — a column entry that
   * also carries createdActionId would otherwise reach down() unvalidated, before the first restore
   * mutation runs.
   * Anything that does not match exactly one of the two shapes throws before any mutation runs.
   *
   * @param {unknown[]} entries
   * @returns {{
   *   columnEntries: Array<{ table: string, column: string, id: number, before: unknown, after: unknown }>,
   *   cloneEntries: Array<{ createdActionId: number, role: unknown, sourceActionId: number }>,
   * }}
   */
  validateEntries(entries) {
    const ALLOWED_COLUMNS = new Map();
    ALLOWED_COLUMNS.set('liquidity_management_action.onFailId', 'nullableInt');
    ALLOWED_COLUMNS.set('liquidity_management_rule.deficitStartActionId', 'nullableInt');
    ALLOWED_COLUMNS.set('liquidity_management_rule.status', 'string');
    /** @param {unknown} v @returns {boolean} */
    const isPositiveInt = (v) => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
    /** @param {unknown} v @returns {boolean} */
    const isNullableInt = (v) => v === null || (typeof v === 'number' && Number.isSafeInteger(v));

    /** @type {Array<{ table: string, column: string, id: number, before: unknown, after: unknown }>} */
    const columnEntries = [];
    /** @type {Array<{ createdActionId: number, role: unknown, sourceActionId: number }>} */
    const cloneEntries = [];

    for (const entry of entries) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error(`Unrecognized audit entry shape for ${AUDIT_MIGRATION}`);
      }

      const hasColumnFields = entry.table !== undefined || entry.column !== undefined;
      const hasCloneFields =
        entry.createdActionId !== undefined || entry.role !== undefined || entry.sourceActionId !== undefined;

      if (hasColumnFields && hasCloneFields) {
        throw new Error(`Audit entry mixes column and clone fields for ${AUDIT_MIGRATION}`);
      }

      if (hasColumnFields) {
        if (typeof entry.table !== 'string' || typeof entry.column !== 'string') {
          throw new Error(`Audit entry table/column must be strings for ${AUDIT_MIGRATION}`);
        }
        const key = `${entry.table}.${entry.column}`;
        const type = ALLOWED_COLUMNS.get(key);
        if (!type) throw new Error(`Unknown audit entry table/column '${key}' for ${AUDIT_MIGRATION}`);
        if (!isPositiveInt(entry.id)) {
          throw new Error(`Invalid audit entry id '${entry.id}' for '${key}' in ${AUDIT_MIGRATION}`);
        }
        const validValues =
          type === 'string'
            ? typeof entry.before === 'string' && typeof entry.after === 'string'
            : isNullableInt(entry.before) && isNullableInt(entry.after);
        if (!validValues) {
          throw new Error(`Invalid before/after type for audit entry '${key}' (id ${entry.id}) in ${AUDIT_MIGRATION}`);
        }
        columnEntries.push({
          table: entry.table,
          column: entry.column,
          id: entry.id,
          before: entry.before,
          after: entry.after,
        });
        continue;
      }

      if (hasCloneFields) {
        if (!isPositiveInt(entry.createdActionId)) {
          throw new Error(`Invalid createdActionId '${entry.createdActionId}' in audit entry for ${AUDIT_MIGRATION}`);
        }
        if (!isPositiveInt(entry.sourceActionId)) {
          throw new Error(
            `Invalid sourceActionId '${entry.sourceActionId}' for createdActionId ${entry.createdActionId} in ${AUDIT_MIGRATION}`,
          );
        }
        cloneEntries.push({
          createdActionId: entry.createdActionId,
          role: entry.role,
          sourceActionId: entry.sourceActionId,
        });
        continue;
      }

      throw new Error(`Unrecognized audit entry shape for ${AUDIT_MIGRATION}`);
    }

    return { columnEntries, cloneEntries };
  }

  /**
   * Compute which ids are even plausible targets for this migration's restore, from the hardcoded
   * pairs (`this.pairs`) and the CURRENT database state — never from the audit payload's own claims
   * about which rows it touched. Throws before any mutation if a columnEntries id falls outside its
   * table/column's reachable set.
   *
   * What this closes and what it does not: a forged-but-well-typed entry can no longer name an
   * arbitrary foreign row, because that row would not appear in any of these three sets. It cannot
   * stop a forged entry that names a row genuinely inside this migration's own footprint — such a
   * row is indistinguishable here from a legitimate one. Closing that gap needs a signed payload or
   * a store application roles cannot write to; that is an architecture decision outside this PR.
   *
   * @param {QueryRunner} queryRunner
   * @param {Array<{ table: string, column: string, id: number, before: unknown, after: unknown }>} columnEntries
   * @param {Array<{ createdActionId: number, role: unknown, sourceActionId: number }>} cloneEntries
   * @returns {Promise<void>}
   */
  async validateReachableIds(queryRunner, columnEntries, cloneEntries) {
    const referenceIds = this.pairs.flat().concat(cloneEntries.map((entry) => entry.createdActionId));
    const placeholders = referenceIds.map((_, i) => `$${i + 1}`).join(', ');

    const allowedActionRows = await queryRunner.query(
      `SELECT "id" FROM "liquidity_management_action"
       WHERE "id" IN (${placeholders}) OR "onFailId" IN (${placeholders})`,
      referenceIds,
    );
    const allowedActionIds = new Set(allowedActionRows.map((row) => Number(row.id)));

    const allowedDeficitRuleRows = await queryRunner.query(
      `SELECT "id" FROM "liquidity_management_rule" WHERE "deficitStartActionId" IN (${placeholders})`,
      referenceIds,
    );
    const allowedDeficitRuleIds = new Set(allowedDeficitRuleRows.map((row) => Number(row.id)));

    const allowedStatusRuleRows = await queryRunner.query(
      `SELECT r."id" FROM "liquidity_management_rule" r
       JOIN "asset" a ON a."id" = r."targetAssetId"
       WHERE a."name" = 'DAI'`,
    );
    const allowedStatusRuleIds = new Set(allowedStatusRuleRows.map((row) => Number(row.id)));

    for (const entry of columnEntries) {
      const key = `${entry.table}.${entry.column}`;
      let allowed;
      if (key === 'liquidity_management_action.onFailId') allowed = allowedActionIds;
      else if (key === 'liquidity_management_rule.deficitStartActionId') allowed = allowedDeficitRuleIds;
      else allowed = allowedStatusRuleIds;

      if (!allowed.has(entry.id)) {
        throw new Error(
          `Audit entry id ${entry.id} for '${key}' is outside this migration's reachable rows in ${AUDIT_MIGRATION}`,
        );
      }
    }
  }

  /**
   * Build the fully literal (hardcoded) restore UPDATE for one of the three allowed
   * (table, column) combinations. Never interpolates entry.table/entry.column into SQL — the
   * switch itself is the allowlist, so an unexpected combination cannot reach this point after
   * validateEntries() has run.
   *
   * @param {Record<string, unknown>} entry
   * @returns {{ sql: string, params: unknown[] }}
   */
  buildRestoreQuery(entry) {
    switch (`${entry.table}.${entry.column}`) {
      case 'liquidity_management_action.onFailId':
        return {
          sql: `UPDATE "liquidity_management_action" SET "onFailId" = $1
                WHERE "id" = $2 AND ("onFailId" = $3 OR ("onFailId" IS NULL AND $3 IS NULL))`,
          params: [entry.before, entry.id, entry.after],
        };
      case 'liquidity_management_rule.deficitStartActionId':
        return {
          sql: `UPDATE "liquidity_management_rule" SET "deficitStartActionId" = $1
                WHERE "id" = $2 AND ("deficitStartActionId" = $3 OR ("deficitStartActionId" IS NULL AND $3 IS NULL))`,
          params: [entry.before, entry.id, entry.after],
        };
      default:
        // Unreachable after validateEntries(): 'status' entries are filtered out by the caller
        // before this is called, and any other combination already threw during validation.
        throw new Error(`No hardcoded restore query for '${entry.table}.${entry.column}' in ${AUDIT_MIGRATION}`);
    }
  }

  /**
   * @param {QueryRunner} queryRunner
   * @returns {Promise<void>}
   */
  async up(queryRunner) {
    // Step 0 — idempotency gate: an active (un-rolled-back) apply means this migration already ran.
    if (await this.getActiveApply(queryRunner)) return;

    /** @type {Array<Record<string, unknown>>} */
    const entries = [];

    // Step 1 — pure read phase: discover structure per pair; throw on unexpected edges.
    /** @type {Array<{
     *   btcId: number,
     *   usdtId: number,
     *   b: { id: number, system: string, command: string, tag: string | null, params: string | null, onSuccessId: number | null, onFailId: number | null },
     *   u: { id: number, system: string, command: string, tag: string | null, params: string | null, onSuccessId: number | null, onFailId: number | null },
     *   tId: number | null,
     *   ws: Array<{ id: number, system: string, command: string, tag: string | null, params: string | null, onSuccessId: number | null, onFailId: number | null }>,
     *   wbtcDirectRuleIds: number[],
     *   nonWbtcDirectRuleIds: number[],
     *   wbtcRuleIdsByW: Map<number, number[]>,
     * }>} */
    const plans = [];

    for (const [btcId, usdtId] of this.pairs) {
      const b = (
        await queryRunner.query(
          `SELECT "id", "system", "command", "tag", "params", "onSuccessId", "onFailId"
           FROM "liquidity_management_action" WHERE "id" = $1`,
          Array.of(btcId),
        )
      ).at(0);
      const u = (
        await queryRunner.query(
          `SELECT "id", "system", "command", "tag", "params", "onSuccessId", "onFailId"
           FROM "liquidity_management_action" WHERE "id" = $1`,
          Array.of(usdtId),
        )
      ).at(0);
      // Missing rows: environment without LM seed data — silent skip (not an unexpected structure).
      if (!b || !u) continue;

      // Row exists but is not the expected Binance buy action — loud failure, not a silent skip.
      if (b.system !== 'Binance' || b.command !== 'buy') {
        throw new Error(
          `Action ${btcId}: expected system='Binance' command='buy', found system='${b.system}' command='${b.command}'`,
        );
      }
      if (u.system !== 'Binance' || u.command !== 'buy') {
        throw new Error(
          `Action ${usdtId}: expected system='Binance' command='buy', found system='${u.system}' command='${u.command}'`,
        );
      }

      // Guard 1: expected structure is B --onFail--> U. Coerce: node-pg may return int as string.
      if (Number(b.onFailId) !== Number(u.id)) {
        throw new Error(
          `Pair (${btcId}, ${usdtId}): expected B.onFailId = U (${usdtId}), found ${b.onFailId}`,
        );
      }

      const tId = u.onFailId == null ? null : Number(u.onFailId);

      // Guard 2: T must not close a cycle back onto B or U (null is a valid chain end).
      if (tId != null && (tId === btcId || tId === usdtId)) {
        throw new Error(`Pair (${btcId}, ${usdtId}): T (${tId}) must not be B or U itself`);
      }

      const ws = await queryRunner.query(
        `SELECT "id", "system", "command", "tag", "params", "onSuccessId", "onFailId"
         FROM "liquidity_management_action" WHERE "onFailId" = $1`,
        Array.of(btcId),
      );

      const wbtcDirectRows = await queryRunner.query(
        `SELECT r."id" FROM "liquidity_management_rule" r
         JOIN "asset" a ON a."id" = r."targetAssetId"
         WHERE r."deficitStartActionId" = $1 AND a."name" = 'WBTC'`,
        Array.of(btcId),
      );
      const wbtcDirectRuleIds = wbtcDirectRows.map((row) => Number(row.id));

      // NULL-safe non-WBTC filter: NOT IN over a subquery that may contain NULLs would exclude
      // every row in SQL, so use IS NULL OR NOT IN instead.
      const nonWbtcDirectRows = await queryRunner.query(
        `SELECT r."id" FROM "liquidity_management_rule" r
         WHERE r."deficitStartActionId" = $1
           AND (r."targetAssetId" IS NULL
                OR r."targetAssetId" NOT IN (SELECT "id" FROM "asset" WHERE "name" = 'WBTC'))`,
        Array.of(btcId),
      );
      const nonWbtcDirectRuleIds = nonWbtcDirectRows.map((row) => Number(row.id));

      /** @type {Map<number, number[]>} */
      const wbtcRuleIdsByW = new Map();
      for (const w of ws) {
        const wId = Number(w.id);
        const wbtcAtW = await queryRunner.query(
          `SELECT r."id" FROM "liquidity_management_rule" r
           JOIN "asset" a ON a."id" = r."targetAssetId"
           WHERE r."deficitStartActionId" = $1 AND a."name" = 'WBTC'`,
          Array.of(wId),
        );
        wbtcRuleIdsByW.set(wId, wbtcAtW.map((row) => Number(row.id)));
      }

      plans.push({
        btcId,
        usdtId,
        b: {
          id: Number(b.id),
          system: b.system,
          command: b.command,
          tag: b.tag ?? null,
          params: b.params ?? null,
          onSuccessId: b.onSuccessId == null ? null : Number(b.onSuccessId),
          onFailId: b.onFailId == null ? null : Number(b.onFailId),
        },
        u: {
          id: Number(u.id),
          system: u.system,
          command: u.command,
          tag: u.tag ?? null,
          params: u.params ?? null,
          onSuccessId: u.onSuccessId == null ? null : Number(u.onSuccessId),
          onFailId: tId,
        },
        tId,
        ws: ws.map((w) => ({
          id: Number(w.id),
          system: w.system,
          command: w.command,
          tag: w.tag ?? null,
          params: w.params ?? null,
          onSuccessId: w.onSuccessId == null ? null : Number(w.onSuccessId),
          onFailId: w.onFailId == null ? null : Number(w.onFailId),
        })),
        wbtcDirectRuleIds,
        nonWbtcDirectRuleIds,
        wbtcRuleIdsByW,
      });
    }

    // Step 2 — clone WBTC chains only when WBTC rules actually use B or some W for this pair.
    for (const plan of plans) {
      const needsClone =
        plan.wbtcDirectRuleIds.length > 0 ||
        plan.ws.some((w) => (plan.wbtcRuleIdsByW.get(w.id) ?? []).length > 0);
      if (!needsClone) continue;

      // U2: clone of U with onFailId = T (set at INSERT — T is already known from step 1).
      const u2Id = await this.insertClone(queryRunner, plan.u, this.wbtcTag(plan.u.tag), plan.tId);
      entries.push({ role: 'U2', createdActionId: u2Id, sourceActionId: plan.u.id });

      // B2: clone of B with onFailId = U2.
      const b2Id = await this.insertClone(queryRunner, plan.b, this.wbtcTag(plan.b.tag), u2Id);
      entries.push({ role: 'B2', createdActionId: b2Id, sourceActionId: plan.b.id });

      for (const ruleId of plan.wbtcDirectRuleIds) {
        entries.push({
          table: 'liquidity_management_rule',
          id: ruleId,
          column: 'deficitStartActionId',
          before: plan.btcId,
          after: b2Id,
        });
      }

      for (const w of plan.ws) {
        const wbtcRuleIds = plan.wbtcRuleIdsByW.get(w.id) ?? [];
        if (wbtcRuleIds.length === 0) continue;

        // W2: clone of W with onFailId = B2.
        const w2Id = await this.insertClone(queryRunner, w, this.wbtcTag(w.tag), b2Id);
        entries.push({ role: 'W2', createdActionId: w2Id, sourceActionId: w.id });

        for (const ruleId of wbtcRuleIds) {
          entries.push({
            table: 'liquidity_management_rule',
            id: ruleId,
            column: 'deficitStartActionId',
            before: w.id,
            after: w2Id,
          });
        }
      }
    }

    // Step 3 — plan edge + rule rewires for every pair that was present (WBTC and non-WBTC).
    for (const plan of plans) {
      entries.push({
        table: 'liquidity_management_action',
        id: plan.u.id,
        column: 'onFailId',
        before: plan.tId,
        after: plan.btcId,
      });
      entries.push({
        table: 'liquidity_management_action',
        id: plan.b.id,
        column: 'onFailId',
        before: plan.u.id,
        after: plan.tId,
      });

      for (const w of plan.ws) {
        entries.push({
          table: 'liquidity_management_action',
          id: w.id,
          column: 'onFailId',
          before: plan.btcId,
          after: plan.usdtId,
        });
      }

      for (const ruleId of plan.nonWbtcDirectRuleIds) {
        entries.push({
          table: 'liquidity_management_rule',
          id: ruleId,
          column: 'deficitStartActionId',
          before: plan.btcId,
          after: plan.usdtId,
        });
      }
    }

    // Step 4 — plan DAI deactivation (audited; down() deliberately does not reverse this).
    const daiRules = await queryRunner.query(
      `SELECT r."id" FROM "liquidity_management_rule" r
       WHERE r."targetAssetId" IN (SELECT "id" FROM "asset" WHERE "name" = 'DAI')
         AND r."status" = 'Active'`,
    );
    for (const row of daiRules) {
      entries.push({
        table: 'liquidity_management_rule',
        id: Number(row.id),
        column: 'status',
        before: 'Active',
        after: 'Inactive',
      });
    }

    // Step 5 — empty plan (no seed data, no active DAI): no-op without writing a useless audit row.
    if (entries.length === 0) return;

    // Fail-closed: audit must succeed (RETURNING id) before any overwrite.
    await this.writeAuditEvent(queryRunner, { action: APPLY_ACTION, entries });

    // Step 6 — apply column overwrites only (clone entries have no column; already inserted).
    for (const entry of entries) {
      if (!entry.column) continue;
      await queryRunner.query(
        `UPDATE "${entry.table}" SET "${entry.column}" = $1 WHERE "id" = $2`,
        [entry.after, entry.id],
      );
    }
  }

  /**
   * @param {QueryRunner} queryRunner
   * @returns {Promise<void>}
   */
  async down(queryRunner) {
    const apply = await this.getActiveApply(queryRunner);
    if (!apply) return;

    // Fail closed on tampered audit entries before any mutation (log table is not trusted).
    // Returns two strictly disjoint, normalized lists — never re-filter apply.entries below.
    const { columnEntries, cloneEntries } = this.validateEntries(apply.entries);
    await this.validateReachableIds(queryRunner, columnEntries, cloneEntries);

    // Reverse column overwrites (except status — DAI deactivation is not auto-reversed: without
    // the audit we could not distinguish rules this migration deactivated from ones that were
    // already Inactive or were deactivated independently afterwards. Same rationale as
    // DeactivateTradingRules; reactivation is an operational decision).
    for (const entry of columnEntries) {
      if (entry.column === 'status') continue; // DAI deactivation is not auto-reversed
      const { sql, params } = this.buildRestoreQuery(entry);
      await queryRunner.query(sql, params);
    }

    // Clone actions (B2/U2/W2) are intentionally left in place — down() never deletes them. A
    // rollback leaves the clones as functionless configuration rows once no rule points at them
    // anymore. That is deliberate, not an oversight: deleting a clone can only be authorized
    // against data (its system/command/tag vs. the recorded source) that lives in the same
    // application-writable "log" table as the delete order itself. Worse, after even one
    // up → down (clone kept via an FK reference) → up cycle, an older, no-longer-referenced clone
    // and a newer, actively-referenced one carry the exact same (system, command, tag) — wbtcTag()
    // is a pure function of the source's unchanged tag, so no comparison drawn from that table can
    // tell them apart anymore. Leaving the rows in place is the safe direction; cleaning them up
    // is a deliberate, separate operational decision that this migration's down() cannot prove is
    // correct on its own. Still validated above and recorded below for that future decision.
    const cloneActionIds = cloneEntries.map((entry) => entry.createdActionId);

    // Pair this apply so a later up() can re-apply; audit history is never deleted.
    await this.writeAuditEvent(queryRunner, {
      action: ROLLBACK_ACTION,
      applyLogId: apply.id,
      cloneActionIds,
    });
  }
};
