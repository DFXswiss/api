import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AppInsightsQueryService } from 'src/integration/infrastructure/app-insights-query.service';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { BuyCryptoService } from 'src/subdomains/core/buy-crypto/process/services/buy-crypto.service';
import { BuyService } from 'src/subdomains/core/buy-crypto/routes/buy/buy.service';
import { SwapService } from 'src/subdomains/core/buy-crypto/routes/swap/swap.service';
import { RefRewardService } from 'src/subdomains/core/referral/reward/services/ref-reward.service';
import { BuyFiatService } from 'src/subdomains/core/sell-crypto/process/services/buy-fiat.service';
import { SellService } from 'src/subdomains/core/sell-crypto/route/sell.service';
import { BankTxRepeatService } from 'src/subdomains/supporting/bank-tx/bank-tx-repeat/bank-tx-repeat.service';
import { BankTxType } from 'src/subdomains/supporting/bank-tx/bank-tx/entities/bank-tx.entity';
import { BankTxService } from 'src/subdomains/supporting/bank-tx/bank-tx/services/bank-tx.service';
import { VirtualIbanService } from 'src/subdomains/supporting/bank/virtual-iban/virtual-iban.service';
import { FiatOutputService } from 'src/subdomains/supporting/fiat-output/fiat-output.service';
import { MailContext, MailType } from 'src/subdomains/supporting/notification/enums';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { PayInService } from 'src/subdomains/supporting/payin/services/payin.service';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { SupportIssueService } from 'src/subdomains/supporting/support-issue/services/support-issue.service';
import { DataSource } from 'typeorm';
import { LimitRequestService } from '../../supporting/support-issue/services/limit-request.service';
import { KycDocumentService } from '../kyc/services/integration/kyc-document.service';
import { KycAdminService } from '../kyc/services/kyc-admin.service';
import { BankDataService } from '../user/models/bank-data/bank-data.service';
import { UserData } from '../user/models/user-data/user-data.entity';
import { UserDataService } from '../user/models/user-data/user-data.service';
import { UserService } from '../user/models/user/user.service';
import { DbQueryBaseDto, DbQueryDto, DbReturnData } from './dto/db-query.dto';
import {
  DebugAggregate,
  DebugIdentifierRegex,
  DebugOrderByItem,
  DebugQueryDto,
  DebugQueryMaxInListSize,
  DebugQueryMaxPredicates,
  DebugQueryMaxWhereDepth,
  DebugQueryResult,
  DebugSelectItem,
  DebugWhereNode,
  DebugWhereOp,
} from './dto/debug-query.dto';
import {
  DebugAllowedColumns,
  DebugLogQueryTemplates,
  DebugMaxResults,
  DebugTableSpec,
  GsRestrictedColumns,
  GsRestrictedMarker,
  LogQueryAuditPrefix,
  SupportTable,
} from './dto/gs.dto';
import { LogQueryDto, LogQueryResult } from './dto/log-query.dto';
import { SupportDataQuery, SupportReturnData } from './dto/support-data.dto';

// Mutable state carried through the /gs/debug SQL emitters. Holds the bound parameter
// array, the alias set (for ORDER/GROUP BY resolution), and a predicate counter for the
// WHERE-tree depth/size caps. Constructed once per query in executeDebugQuery.
interface DebugQueryEmitCtx {
  table: string;
  spec: DebugTableSpec;
  params: (string | number | boolean)[];
  aliases: Set<string>;
  predicateCount: number;
}

@Injectable()
export class GsService {
  private readonly logger = new DfxLogger(GsService);

  constructor(
    private readonly appInsightsQueryService: AppInsightsQueryService,
    private readonly userDataService: UserDataService,
    private readonly userService: UserService,
    private readonly buyService: BuyService,
    private readonly sellService: SellService,
    private readonly buyCryptoService: BuyCryptoService,
    private readonly payInService: PayInService,
    private readonly buyFiatService: BuyFiatService,
    private readonly refRewardService: RefRewardService,
    private readonly bankTxRepeatService: BankTxRepeatService,
    private readonly bankTxService: BankTxService,
    private readonly fiatOutputService: FiatOutputService,
    private readonly dataSource: DataSource,
    private readonly kycDocumentService: KycDocumentService,
    private readonly transactionService: TransactionService,
    private readonly kycAdminService: KycAdminService,
    private readonly bankDataService: BankDataService,
    private readonly notificationService: NotificationService,
    private readonly limitRequestService: LimitRequestService,
    private readonly supportIssueService: SupportIssueService,
    private readonly swapService: SwapService,
    private readonly virtualIbanService: VirtualIbanService,
  ) {}

  async getDbData(query: DbQueryDto, role: UserRole): Promise<DbReturnData> {
    const additionalSelect = Array.from(
      new Set([
        ...(query.select?.filter((s) => s.includes('-') && !s.includes('documents')).map((s) => s.split('-')[0]) || []),
        ...(query.select
          ?.filter((s) => s.includes('[') && !s.includes('-'))
          .map((s) => [`${s.split('[')[0]}.id`, `${s.split('[')[0]}${s.split(']')[1]}`])
          .flat() || []),
      ]),
    );

    const startTime = Date.now();

    let data = await this.getRawDbData({
      ...query,
      select: Array.from(
        new Set([
          ...(query.select?.filter((s) => !s.includes('-') && !s.includes('documents') && !s.includes('[')) ?? []),
          ...additionalSelect,
        ]),
      ),
    });

    // null all elements which are larger than 50k symbols
    data.forEach((e) =>
      Object.entries(e).forEach(([key, value]) => {
        if (value?.toString().length >= 50000) delete e[key];
      }),
    );

    const runTime = Util.round((Date.now() - startTime) / 1000, 1);

    if (runTime > 3) {
      const message = `Long DB runtime for ${query.identifier}: ${runTime}s for ${
        data.length
      } entries with query: ${JSON.stringify(query)}`;

      this.logger.info(message);

      if (data.length > 100000) {
        await this.notificationService.sendMail({
          type: MailType.ERROR_MONITORING,
          context: MailContext.MONITORING,
          input: { subject: 'Excessive GS Request', errors: [message] },
        });
      }
    }

    if (query.table === 'user_data' && (!query.select || query.select.some((s) => s.includes('documents')))) {
      this.logger.info(`GS userDataDoc use, with query: ${JSON.stringify(query)}`);
      await this.setUserDataDocs(data, query.select, query.sorting);
    }

    if (query.select?.some((s) => !s.includes('documents') && s.includes('-'))) this.setJsonData(data, query.select);

    if (query.select?.some((s) => s.includes('[') && !s.includes('-')))
      data = this.getArrayData(data, query.select, query.table);

    additionalSelect.forEach((key) => {
      if (!query.select?.includes(key)) data.forEach((entry) => delete entry[key]);
    });

    // transform to array
    return this.transformResultArray(data, query.table, role);
  }

  async getExtendedDbData(query: DbQueryBaseDto, role: UserRole): Promise<DbReturnData> {
    switch (query.table) {
      case 'bank_tx': {
        const data = await this.getExtendedBankTxData(query);
        return this.transformResultArray(data, query.table, role);
      }
    }
  }

  async getSupportData(query: SupportDataQuery): Promise<SupportReturnData> {
    const userData = await this.getUserData(query);
    if (!userData) throw new NotFoundException('User data not found');

    const userIds = userData.users.map((u) => u.id);
    const refCodes = userData.users.map((u) => u.ref);

    const { supportIssues, supportMessages } = await this.supportIssueService.getUserIssues(userData.id);

    return {
      userData,
      supportIssues,
      supportMessages,
      limitRequests: await this.limitRequestService.getUserLimitRequests(userData.id),
      kycSteps: await this.kycAdminService.getKycSteps(userData.id, { userData: true }),
      bankData: await this.bankDataService.getAllBankDatasForUser(userData.id),
      notification: await this.notificationService.getMails(userData.id),
      // NOTE: this admin/support path intentionally keeps the raw storage URL. The host-stable
      // proxied-URL substitution is applied only to the client-facing `/gs/db` output (see
      // `setUserDataDocs`); unifying both paths into a shared helper is a follow-up.
      documents: await this.kycDocumentService.getAllUserDocuments(userData.id, userData.accountType),
      buyCrypto: await this.buyCryptoService.getAllUserTransactions(userIds),
      buyFiat: await this.buyFiatService.getAllUserTransactions(userIds),
      ref: await this.buyCryptoService.getAllRefTransactions(refCodes),
      refReward: await this.refRewardService.getAllUserRewards(userIds),
      cryptoInput: await this.payInService.getAllUserTransactions(userIds),
      bankTxRepeat: await this.bankTxRepeatService.getAllUserRepeats(userIds),
      transaction: await this.transactionService.getAllTransactionsForUserData(userData.id, {
        bankTx: true,
        buyCrypto: true,
        buyFiat: true,
        bankTxReturn: true,
        bankTxRepeat: true,
        refReward: true,
        cryptoInput: true,
        checkoutTx: true,
        request: true,
        custodyOrder: true,
      }),
      buy: await this.buyService.getAllUserBuys(userIds),
      sell: await this.sellService.getAllUserSells(userIds),
      swap: await this.swapService.getAllUserSwaps(userIds),
      virtualIbans: await this.virtualIbanService.getVirtualIbansForAccount(userData.id),
    };
  }

  // POST /gs/debug — structured allowlist-driven debug endpoint.
  //
  // No raw SQL is accepted. The DTO is class-validated at the controller boundary, so by the
  // time we get here every field's type matches the schema (enum / regex / shape). We then
  // translate the DTO into SQL fragments where every identifier is looked up against
  // DebugAllowedColumns (or pulled from a small server-side enum), and every value is bound
  // as a parameter. The emitted SQL string is fed to dataSource.query() with the parameter
  // array.
  //
  // Properties that hold by construction (no parser, no AST walker, no defense-in-depth
  // string scanning needed):
  //   - No user-controlled string lands inside the SQL string. Identifiers are validated
  //     against the allowlist; ops/aggregates/directions come from server-side enums; values
  //     are bound via the $1..$N parameter array.
  //   - No JOIN, subquery, UNION, CTE, INTO, window function, CASE, or arbitrary function
  //     call can be expressed in the DTO. To add one, the schema AND the emitter both need
  //     explicit code changes.
  //   - LIMIT is a numeric DTO field, clamped at DebugMaxResults. No string substring scan.
  async executeDebugQuery(dto: DebugQueryDto, userIdentifier: string): Promise<DebugQueryResult> {
    // `Object.hasOwn` so prototype keys like `__proto__` / `constructor` / `toString` don't
    // pass the `if (!spec)` guard (they'd otherwise return `Object.prototype` and crash later
    // with a 500). Use the allowlist as a real lookup, not a `in`/index probe.
    if (!Object.hasOwn(DebugAllowedColumns, dto.table)) {
      throw new BadRequestException(`Table '${dto.table}' is not allowed`);
    }
    const spec = DebugAllowedColumns[dto.table];

    // Audit log emitted FIRST — before any emit/validate step can throw — so a malformed or
    // probing request (bad column, oversized IN list, etc.) is still recorded for forensics.
    // WHERE leaf values may carry PII (LIKE patterns over mail / IBAN); redact them. Bound
    // parameters already protect the SQL string; we shouldn't undo that via the verbose log.
    this.logger.verbose(`Debug-query by ${userIdentifier}: ${this.serializeDebugQueryForAudit(dto)}`);

    const ctx: DebugQueryEmitCtx = {
      table: dto.table,
      spec,
      params: [],
      aliases: new Set<string>(),
      predicateCount: 0,
    };

    // SELECT — emit fragments in the order they appear in the DTO. Aliases are collected so
    // they can be referenced from ORDER BY (PG allows ORDER BY by output alias).
    const selectFragments = dto.select.map((item) => this.emitDebugSelectItem(item, ctx));
    const selectClause = selectFragments.join(', ');

    // WHERE — recursive emitter capped at DebugQueryMaxWhereDepth and DebugQueryMaxPredicates.
    const whereClause = dto.where ? ` WHERE ${this.emitDebugWhere(dto.where, ctx, 1)}` : '';

    // GROUP BY — each item must resolve to either a table column or an existing select alias.
    const groupByClause = dto.groupBy?.length
      ? ` GROUP BY ${dto.groupBy.map((c) => this.emitDebugGroupOrderIdent(c, ctx)).join(', ')}`
      : '';

    // ORDER BY — same name resolution as GROUP BY; direction comes from a server-side enum.
    const orderByClause = dto.orderBy?.length
      ? ` ORDER BY ${dto.orderBy.map((o) => this.emitDebugOrderByItem(o, ctx)).join(', ')}`
      : '';

    // LIMIT / OFFSET — DTO enforces `@Min(1) @Max(10000)` on limit and `@Min(0) @Max(1_000_000)`
    // on offset. We clamp both ends again here so the service alone never emits a negative or
    // zero limit; matches the defense-in-depth re-checks on `aggregate`/`op`/`direction`.
    const limit = Math.max(1, Math.min(dto.limit, DebugMaxResults));
    const offset = Math.max(0, dto.offset ?? 0);
    const limitClause = ` LIMIT ${limit}${offset > 0 ? ` OFFSET ${offset}` : ''}`;

    const sql = `SELECT ${selectClause} FROM "${dto.table}"${whereClause}${groupByClause}${orderByClause}${limitClause}`;

    try {
      const rows: Record<string, unknown>[] = await this.dataSource.query(sql, ctx.params);
      const keys = dto.select.map((item) => item.as ?? this.defaultDebugSelectAlias(item));
      return { keys, rows: rows.map((r) => keys.map((k) => r[k])) };
    } catch (e) {
      this.logger.info(`Debug-query by ${userIdentifier} failed: ${e.message}`);
      throw new BadRequestException('Query execution failed');
    }
  }

  // --- Emitters for /gs/debug ---

  // Replaces every `value` field (WHERE leaf scalars or IN-list arrays) with a redaction
  // marker for the audit log, then truncates. Preserves table/select/where structure so the
  // log is still useful for forensics; drops the actual user-supplied scalars.
  private serializeDebugQueryForAudit(dto: DebugQueryDto): string {
    const redacted = JSON.stringify(dto, (key, val) => {
      if (key === 'value') {
        if (Array.isArray(val)) return `<array:${val.length}>`;
        return '<scalar>';
      }
      return val;
    });
    return redacted.length > 500 ? `${redacted.substring(0, 500)}...` : redacted;
  }

  // Asserts a column name is in the table allowlist; throws otherwise. Used everywhere a
  // user-supplied identifier could reach SQL.
  private assertDebugColumnAllowed(column: string, spec: DebugTableSpec): void {
    if (!spec.columns.includes(column)) {
      throw new BadRequestException(`Column '${column}' is not allowed on this table`);
    }
  }

  // Validates a jsonb path string: dot-separated, each segment matches the identifier regex,
  // max 8 segments to bound the emitted expression. Returns the segment array.
  private parseDebugJsonbPath(path: string): string[] {
    const segments = path.split('.');
    if (segments.length < 1 || segments.length > 8) {
      throw new BadRequestException('jsonb path must have between 1 and 8 segments');
    }
    for (const s of segments) {
      if (!DebugIdentifierRegex.test(s)) {
        throw new BadRequestException(`jsonb path segment '${s}' is invalid`);
      }
    }
    return segments;
  }

  // Default alias when the user didn't provide one. For plain columns we use the column name
  // (Postgres' natural behavior); for aggregates we synthesize <fn>_<col>; for jsonb we use
  // the path's last segment.
  private defaultDebugSelectAlias(item: DebugSelectItem): string {
    if (item.kind === 'aggregate') return `${item.aggregate}_${item.column}`;
    if (item.kind === 'jsonb') {
      const segments = item.jsonbPath!.split('.');
      return segments[segments.length - 1];
    }
    return item.column;
  }

  // Emits one SELECT-list fragment. All identifiers are validated; the alias is registered
  // so ORDER BY / GROUP BY can later reference it.
  //
  // Order of operations matters: every kind-specific required field is validated BEFORE the
  // default alias is derived, so `defaultDebugSelectAlias` always reads from already-checked
  // inputs. Otherwise a malformed `{kind: 'jsonb'}` (no jsonbPath) would TypeError when
  // synthesizing the alias and surface as 500 instead of a clean 400.
  private emitDebugSelectItem(item: DebugSelectItem, ctx: DebugQueryEmitCtx): string {
    this.assertDebugColumnAllowed(item.column, ctx.spec);

    // Defense in depth: an explicit `as` is interpolated as `AS "${alias}"`. The DTO regex
    // already enforces this shape — re-check here so a future change that bypasses the DTO
    // (or a missing ValidationPipe) doesn't open an identifier-injection vector.
    if (item.as !== undefined && !DebugIdentifierRegex.test(item.as)) {
      throw new BadRequestException(`Alias '${item.as}' is not a valid identifier`);
    }

    // Kind-specific required-field checks. These run BEFORE alias derivation so a malformed
    // DTO produces a clean 400 instead of a TypeError 500.
    if (item.kind === 'aggregate') {
      if (!item.aggregate) throw new BadRequestException('aggregate selector requires `aggregate`');
      // Defense in depth: the aggregate name is interpolated into the SQL string. The DTO
      // enforces enum membership; re-check here so a future bypass can't smuggle an
      // arbitrary string through.
      if (!Object.values(DebugAggregate).includes(item.aggregate)) {
        throw new BadRequestException(`Aggregate '${item.aggregate}' is not allowed`);
      }
    } else if (item.kind === 'jsonb') {
      if (!item.jsonbPath) throw new BadRequestException('jsonb selector requires `jsonbPath`');
      if (!ctx.spec.jsonbColumns?.includes(item.column)) {
        throw new BadRequestException(`Column '${item.column}' does not support jsonb path access`);
      }
    }

    const alias = item.as ?? this.defaultDebugSelectAlias(item);
    ctx.aliases.add(alias);

    const colSql = `"${ctx.table}"."${item.column}"`;

    switch (item.kind) {
      case 'column':
        return `${colSql} AS "${alias}"`;

      case 'aggregate':
        return `${item.aggregate!.toUpperCase()}(${colSql}) AS "${alias}"`;

      case 'jsonb': {
        const segments = this.parseDebugJsonbPath(item.jsonbPath!);
        // Emit `(col)::jsonb -> 'a' -> 'b' ->> 'lastSegment'` — `->>` on the terminal step
        // forces text output, which is what JSON.parse-friendly debugging wants.
        let expr = `(${colSql})::jsonb`;
        for (let i = 0; i < segments.length - 1; i++) expr += ` -> '${segments[i]}'`;
        expr += ` ->> '${segments[segments.length - 1]}'`;
        return `${expr} AS "${alias}"`;
      }

      default:
        throw new BadRequestException(`select kind '${(item as { kind: string }).kind}' is not allowed`);
    }
  }

  // Recursive WHERE emitter. Caps depth and predicate count to prevent JSON-tree DoS. Returns
  // a parenthesized SQL fragment with parameter placeholders.
  private emitDebugWhere(node: DebugWhereNode, ctx: DebugQueryEmitCtx, depth: number): string {
    if (depth > DebugQueryMaxWhereDepth) {
      throw new BadRequestException(`WHERE tree exceeds max depth of ${DebugQueryMaxWhereDepth}`);
    }

    switch (node.kind) {
      case 'leaf':
        return this.emitDebugWhereLeaf(node, ctx);

      case 'and':
      case 'or': {
        if (!node.children?.length) {
          throw new BadRequestException(`'${node.kind}' node requires at least one child`);
        }
        const parts = node.children.map((c) => this.emitDebugWhere(c, ctx, depth + 1));
        return `(${parts.join(node.kind === 'and' ? ' AND ' : ' OR ')})`;
      }

      case 'not': {
        if (!node.child) throw new BadRequestException("'not' node requires `child`");
        return `(NOT ${this.emitDebugWhere(node.child, ctx, depth + 1)})`;
      }

      default:
        throw new BadRequestException(`WHERE kind '${(node as { kind: string }).kind}' is not allowed`);
    }
  }

  // Emits one leaf predicate. Validates column-in-allowlist and op-against-value-shape, then
  // binds the value(s) as parameters.
  private emitDebugWhereLeaf(node: DebugWhereNode, ctx: DebugQueryEmitCtx): string {
    if (++ctx.predicateCount > DebugQueryMaxPredicates) {
      throw new BadRequestException(`WHERE tree exceeds max predicates of ${DebugQueryMaxPredicates}`);
    }
    if (!node.column || !node.op) {
      throw new BadRequestException('leaf WHERE node requires `column` and `op`');
    }
    // Defense in depth: `node.op` is interpolated into the SQL string (line ~441). The DTO
    // enforces enum membership; re-check here so any bypass of class-validator can't smuggle
    // arbitrary operator strings through.
    if (!Object.values(DebugWhereOp).includes(node.op)) {
      throw new BadRequestException(`Operator '${node.op}' is not allowed`);
    }
    this.assertDebugColumnAllowed(node.column, ctx.spec);

    const colSql = `"${ctx.table}"."${node.column}"`;

    switch (node.op) {
      case DebugWhereOp.IS_NULL:
      case DebugWhereOp.IS_NOT_NULL:
        if (node.value !== undefined) {
          throw new BadRequestException(`op '${node.op}' must not have a value`);
        }
        return `${colSql} ${node.op}`;

      case DebugWhereOp.IN:
      case DebugWhereOp.NOT_IN: {
        if (!Array.isArray(node.value)) {
          throw new BadRequestException(`op '${node.op}' requires array value`);
        }
        if (node.value.length === 0 || node.value.length > DebugQueryMaxInListSize) {
          throw new BadRequestException(`IN list size must be 1..${DebugQueryMaxInListSize}`);
        }
        for (const v of node.value) this.assertDebugScalarValue(v);
        const placeholders = node.value.map((v) => `$${this.bindDebugParam(v, ctx)}`).join(', ');
        return `${colSql} ${node.op} (${placeholders})`;
      }

      default: {
        // = != < <= > >= LIKE ILIKE — all single-scalar binary ops
        if (node.value === undefined || Array.isArray(node.value)) {
          throw new BadRequestException(`op '${node.op}' requires a single scalar value`);
        }
        this.assertDebugScalarValue(node.value);
        return `${colSql} ${node.op} $${this.bindDebugParam(node.value, ctx)}`;
      }
    }
  }

  // Allowed leaf value types. Booleans/numbers/strings only — nothing fancy can sneak in via
  // an object disguised as a value (which would otherwise reach the pg driver and might be
  // serialized in unexpected ways).
  private assertDebugScalarValue(v: unknown): asserts v is string | number | boolean {
    if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') {
      throw new BadRequestException('WHERE values must be string, number, or boolean');
    }
    if (typeof v === 'string' && v.length > 1024) {
      throw new BadRequestException('WHERE string value exceeds max length of 1024');
    }
  }

  // Appends a value to the parameter list and returns the 1-based placeholder index.
  private bindDebugParam(value: string | number | boolean, ctx: DebugQueryEmitCtx): number {
    ctx.params.push(value);
    return ctx.params.length;
  }

  // GROUP BY / ORDER BY identifier resolver. Accepts either a real column (validated against
  // the table allowlist) OR a select-list alias (added to ctx.aliases earlier). Order matters:
  // we check the column allowlist first so an alias can't shadow a disallowed real column —
  // but in practice the regex already prevented quoted dot-pathing.
  private emitDebugGroupOrderIdent(name: string, ctx: DebugQueryEmitCtx): string {
    if (ctx.spec.columns.includes(name)) return `"${ctx.table}"."${name}"`;
    if (ctx.aliases.has(name)) return `"${name}"`;
    throw new BadRequestException(`'${name}' is neither an allowed column nor a select alias`);
  }

  private emitDebugOrderByItem(item: DebugOrderByItem, ctx: DebugQueryEmitCtx): string {
    const ident = this.emitDebugGroupOrderIdent(item.column, ctx);
    if (item.direction !== undefined && item.direction !== 'ASC' && item.direction !== 'DESC') {
      // Defense in depth — `direction` is interpolated into SQL. The DTO restricts it to
      // ASC/DESC via @IsIn; re-check here so the service alone catches an invalid value.
      throw new BadRequestException(`Order direction '${item.direction}' is not allowed`);
    }
    return item.direction ? `${ident} ${item.direction}` : ident;
  }

  async executeLogQuery(dto: LogQueryDto, userIdentifier: string): Promise<LogQueryResult> {
    const template = DebugLogQueryTemplates[dto.template];
    if (!template) {
      throw new BadRequestException('Unknown template');
    }

    // Validate required params
    for (const param of template.requiredParams) {
      if (!dto[param]) {
        throw new BadRequestException(`Parameter '${param}' is required for template '${dto.template}'`);
      }
    }

    // Build KQL with safe parameter substitution
    let kql = template.kql;
    kql = kql.replace('{operationId}', dto.operationId ?? '');
    kql = kql.replace('{messageFilter}', this.escapeKqlString(dto.messageFilter ?? ''));
    kql = kql.replace(/{hours}/g, String(dto.hours ?? 1));
    kql = kql.replace('{durationMs}', String(dto.durationMs ?? 1000));
    kql = kql.replace('{eventName}', this.escapeKqlString(dto.eventName ?? ''));

    // Add limit
    kql += `\n| take ${template.defaultLimit}`;

    // Log for audit
    this.logger.verbose(
      `${LogQueryAuditPrefix}${userIdentifier}: template=${dto.template}, params=${JSON.stringify(dto)}`,
    );

    // Execute
    const timespan = `PT${dto.hours ?? 1}H`;

    try {
      const response = await this.appInsightsQueryService.query(kql, timespan);

      if (!response.tables?.length) {
        return { columns: [], rows: [] };
      }

      return {
        columns: response.tables[0].columns,
        rows: response.tables[0].rows,
      };
    } catch (e) {
      this.logger.info(`${LogQueryAuditPrefix}${userIdentifier} failed: ${e.message}`);
      throw new BadRequestException('Query execution failed');
    }
  }

  private escapeKqlString(value: string): string {
    // Escape quotes and backslashes for KQL string literals
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  // --- Helper Methods ---

  private setJsonData(data: any[], selects: string[]): void {
    const jsonSelects = selects.filter((s) => s.includes('-') && !s.includes('documents'));

    for (const select of jsonSelects) {
      const [field, jsonPath] = select.split('-');

      data.map((d) => {
        const parsedJsonData = this.getParsedJsonData(d[field.replace(/[.]/g, '_')], jsonPath);

        d[select] =
          typeof parsedJsonData === 'object' && parsedJsonData !== null
            ? JSON.stringify(parsedJsonData)
            : parsedJsonData;

        return d;
      });
    }
  }

  private getArrayData(data: any[], selects: string[], table: string): any[] {
    const arraySelects = selects.filter((s) => s.includes('[') && !s.includes('-'));
    const parentIds = Array.from(new Set(data.map((d) => d[`${table}_id`])));

    return parentIds.map((nd) => {
      const entities = data.filter((d) => d[`${table}_id`] === nd);

      const selectedData = arraySelects.reduce((prev, curr) => {
        const [_, field, index, prop] = /^(.*)\[(\w+)\]\.(.*)$/.exec(curr);
        const searchIndex = index === 'max' ? entities.length - 1 : +index;

        entities.sort((e1, e2) => e1[`${field}_id`] - e2[`${field}_id`]);

        return {
          ...Object.fromEntries(Object.entries(entities[0]).filter(([key]) => !key.startsWith(`${field}_`))),
          ...prev,
          [`${curr}`]: entities[searchIndex]?.[`${field}_${prop}`],
        };
      }, {});

      return selectedData;
    });
  }

  private getParsedJsonData(jsonString: string, jsonPath: string) {
    try {
      const jsonValue = JSON.parse(jsonString);

      const parsedJsonData = jsonPath.split('.').reduce((o, k) => {
        if (o) {
          if (Array.isArray(o) && k.includes('!=')) {
            const [key, value] = k.split('!=');
            return o.find((e) => e[key]?.toString() != (value == 'null' ? null : value?.toString()));
          } else if (Array.isArray(o) && k.includes('=')) {
            const [key, value] = k.split('=');
            return o.find((e) => e[key]?.toString() == (value == 'null' ? null : value?.toString()));
          } else if (k.match(/(.*)\[(.*)\]/)) {
            const [_, key, value] = k.match(/(.*)\[(.*)\]/);
            const array = o[key];
            if (Array.isArray(array)) return value === 'max' ? array.at(-1) : array.at(+value);
          }

          return o[k];
        }
      }, jsonValue);

      if (parsedJsonData == jsonValue) return null;

      return parsedJsonData;
    } catch {
      return null;
    }
  }

  private async setUserDataDocs(data: UserData[], select: string[], sorting: 'ASC' | 'DESC'): Promise<void> {
    const selectPaths = this.filterSelectDocumentColumn(select);
    const commonPrefix = this.getBiggestCommonPrefix(selectPaths);

    for (const userData of data) {
      const userDataId = userData.id ?? (userData['user_data_id'] as number);
      const commonPathPrefix = this.toDocPath(commonPrefix, userDataId);

      const docs = Util.sort(
        commonPathPrefix
          ? await this.kycDocumentService.listFilesByPrefix(commonPathPrefix)
          : await this.kycDocumentService.getAllUserDocuments(userDataId, userData.accountType),
        'created',
        sorting,
      );

      // Replace the raw storage URL with a host-stable URL that pins the host to the services domain
      // but keeps the full storage path intact. This decouples clients from the storage backend (a
      // backend migration no longer changes the URL) while preserving the storage path as a substring,
      // which downstream consumers rely on to extract the file name from the URL.
      for (const doc of docs) {
        if (doc.path) doc.url = this.kycDocumentService.toHostStableUrl(doc.path);
      }

      for (const selectPath of selectPaths) {
        const docPath = this.toDocPath(selectPath, userDataId);
        // filter on the storage path (host-independent), not on the now host-stable URL
        userData[selectPath] = docPath === commonPathPrefix ? docs : docs.filter((doc) => doc.path?.includes(docPath));
      }
    }
  }

  private getBiggestCommonPrefix(selects: string[]): string | undefined {
    const first = selects[0];
    if (!first || selects.length === 1) return first || undefined;

    let i = 0;
    while (first[i] && selects.every((w) => w[i] === first[i])) i++;

    return first.substring(0, i);
  }

  private async getRawDbData(query: DbQueryDto): Promise<any[]> {
    const request = this.dataSource
      .createQueryBuilder()
      .from(query.table, query.table)
      .orderBy(`${query.table}.${query.sortColumn}`, query.sorting)
      .limit(query.maxLine)
      .where(`${query.table}.id >= :id`, { id: query.min })
      .andWhere(`${query.table}.updated >= :updated`, { updated: query.updatedSince });

    if (query.select.length) request.select(query.select);

    for (const where of query.where) {
      request.andWhere(where[0], where[1]);
    }

    for (const join of query.join) {
      request.leftJoin(join[0], join[1]);
    }

    return request.getRawMany().catch((e: Error) => {
      throw new BadRequestException(e.message);
    });
  }

  private async getUserData(query: SupportDataQuery): Promise<UserData> {
    switch (query.table) {
      case SupportTable.USER_DATA:
        return this.userDataService.getUserDataByKey(query.key, query.value);
      case SupportTable.USER:
        return this.userService.getUserByKey(query.key, query.value).then((user) => user?.userData);
      case SupportTable.BUY:
        return this.buyService.getBuyByKey(query.key, query.value).then((buy) => buy?.user.userData);
      case SupportTable.SELL:
        return this.sellService.getSellByKey(query.key, query.value).then((sell) => sell?.user.userData);
      case SupportTable.SWAP:
        return this.swapService.getSwapByKey(query.key, query.value).then((swap) => swap?.user.userData);
      case SupportTable.BUY_CRYPTO:
        return this.buyCryptoService
          .getBuyCryptoByKeys([query.key], query.value)
          .then((buyCrypto) => buyCrypto?.userData);
      case SupportTable.BUY_FIAT:
        return this.buyFiatService.getBuyFiatByKey(query.key, query.value).then((buyFiat) => buyFiat?.userData);
      case SupportTable.BANK_TX:
        return this.bankTxService.getBankTxByKey(query.key, query.value).then((bankTx) => bankTx?.userData);
      case SupportTable.FIAT_OUTPUT:
        return this.fiatOutputService
          .getFiatOutputByKey(query.key, query.value)
          .then((fiatOutput) => fiatOutput?.buyFiats[0].sell.user.userData);
      case SupportTable.TRANSACTION:
        return this.transactionService
          .getTransactionByKey(query.key, query.value)
          .then((transaction) => transaction?.userData);
      case SupportTable.BANK_DATA:
        return this.bankDataService.getBankDataByKey(query.key, query.value).then((bD) => bD?.userData);
      case SupportTable.VIRTUAL_IBAN:
        return this.virtualIbanService.getVirtualIbanByKey(query.key, query.value).then((vI) => vI?.userData);
    }
  }

  private async getExtendedBankTxData(dbQuery: DbQueryBaseDto): Promise<any[]> {
    const select = dbQuery.select ? dbQuery.select.map((e) => dbQuery.table + '.' + e).join(',') : dbQuery.table;

    const buyCryptoData = await this.dataSource
      .createQueryBuilder()
      .from(dbQuery.table, dbQuery.table)
      .select(select)
      .addSelect('userData.id', 'userDataId')
      .leftJoin('bank_tx.buyCrypto', 'buyCrypto')
      .leftJoin('buyCrypto.buy', 'buy')
      .leftJoin('buy.user', 'user')
      .leftJoin('user.userData', 'userData')
      .where('bank_tx.id >= :id', { id: dbQuery.min })
      .andWhere('bank_tx.updated >= :updated', { updated: dbQuery.updatedSince })
      .andWhere('bank_tx.type = :type', { type: BankTxType.BUY_CRYPTO })
      .orderBy('bank_tx.id', dbQuery.sorting)
      .take(dbQuery.maxLine)
      .getRawMany()
      .catch((e: Error) => {
        throw new BadRequestException(e.message);
      });

    const buyFiatData = await this.dataSource
      .createQueryBuilder()
      .from(dbQuery.table, dbQuery.table)
      .select(select)
      .addSelect('userData.id', 'userDataId')
      .leftJoin('bank_tx.buyFiats', 'buyFiats')
      .leftJoin('buyFiats.sell', 'sell')
      .leftJoin('sell.user', 'user')
      .leftJoin('user.userData', 'userData')
      .where('bank_tx.id >= :id', { id: dbQuery.min })
      .andWhere('bank_tx.updated >= :updated', { updated: dbQuery.updatedSince })
      .andWhere('bank_tx.type = :type', { type: BankTxType.BUY_FIAT })
      .orderBy('bank_tx.id', dbQuery.sorting)
      .take(dbQuery.maxLine)
      .getRawMany()
      .catch((e: Error) => {
        throw new BadRequestException(e.message);
      });

    const bankTxRestData = await this.dataSource
      .createQueryBuilder()
      .from(dbQuery.table, dbQuery.table)
      .select(select)
      .addSelect('userData.id', 'userDataId')
      .leftJoin('bank_tx.buyFiats', 'buyFiats')
      .leftJoin('buyFiats.sell', 'sell')
      .leftJoin('sell.user', 'user')
      .leftJoin('user.userData', 'userData')
      .where('bank_tx.id >= :id', { id: dbQuery.min })
      .andWhere('bank_tx.updated >= :updated', { updated: dbQuery.updatedSince })
      .andWhere('(bank_tx.type IS NULL OR bank_tx.type NOT IN (:crypto, :fiat))', {
        crypto: BankTxType.BUY_CRYPTO,
        fiat: BankTxType.BUY_FIAT,
      })
      .orderBy('bank_tx.id', dbQuery.sorting)
      .take(dbQuery.maxLine)
      .getRawMany()
      .catch((e: Error) => {
        throw new BadRequestException(e.message);
      });

    return Util.sort(
      buyCryptoData.concat(buyFiatData, bankTxRestData),
      dbQuery.select ? 'id' : 'bank_tx_id',
      dbQuery.sorting,
    );
  }

  private filterSelectDocumentColumn(select: string[]): string[] {
    return (
      select?.filter((s) => s.includes('documents')).map((doc) => doc.split('user_data.').join('')) ?? ['documents']
    );
  }

  private toDocPath(selectPath: string, userDataId: number): string {
    return selectPath.split('-')[1]?.split('.').join('/').split('{userData}').join(`${userDataId}`);
  }

  private transformResultArray(data: any[], table: string, role: UserRole): DbReturnData {
    if (data.length === 0) return undefined;

    if (role !== UserRole.SUPER_ADMIN) this.maskRestrictedColumns(data, table);

    const keys = Object.keys(data[0]);
    const uniqueData = Util.toUniqueList(data, keys[0]);

    // transform to array
    return {
      keys: this.renameDbKeys(table, keys),
      values: uniqueData.map((e) => Object.values(e)),
    };
  }

  private renameDbKeys(table: string, keys: string[]): string[] {
    return keys
      .map((k) => k.replace(`${table}_`, ''))
      .map((k) => (k.includes('_') && !k.includes('documents') ? this.toDotSeparation(k) : k));
  }

  private toDotSeparation(str: string): string {
    return str.charAt(0).toLowerCase() + str.slice(1).split('_').join('.');
  }

  private maskRestrictedColumns(data: Record<string, unknown>[], table: string): void {
    const restrictedColumns = GsRestrictedColumns[table];
    if (!restrictedColumns?.length) return;

    for (const entry of data) {
      for (const column of restrictedColumns) {
        const prefixedKey = `${table}_${column}`;
        if (prefixedKey in entry) {
          entry[prefixedKey] = GsRestrictedMarker;
        } else if (column in entry) {
          entry[column] = GsRestrictedMarker;
        }
      }
    }
  }

}
