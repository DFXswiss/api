import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Parser } from 'node-sql-parser';
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
import { LogQueryDto, LogQueryResult, LogQueryTemplate } from './dto/log-query.dto';
import { SupportDataQuery, SupportReturnData } from './dto/support-data.dto';

export enum SupportTable {
  USER_DATA = 'userData',
  USER = 'user',
  BUY = 'buy',
  SELL = 'sell',
  SWAP = 'swap',
  BUY_CRYPTO = 'buyCrypto',
  BUY_FIAT = 'buyFiat',
  BANK_TX = 'bankTx',
  FIAT_OUTPUT = 'fiatOutput',
  TRANSACTION = 'transaction',
  BANK_DATA = 'bankData',
  VIRTUAL_IBAN = 'virtualIban',
}

@Injectable()
export class GsService {
  private readonly logger = new DfxLogger(GsService);

  // columns only visible to SUPER_ADMIN
  private readonly RestrictedColumns: Record<string, string[]> = {
    asset: ['ikna'],
  };
  private readonly RestrictedMarker = '[RESTRICTED]';

  private readonly sqlParser = new Parser();

  // Table-specific blocked columns for debug queries (personal data)
  private readonly TableBlockedColumns: Record<string, string[]> = {
    // user_data - main table with PII
    user_data: [
      'mail',
      'phone',
      'firstname',
      'surname',
      'verifiedName',
      'street',
      'houseNumber',
      'location',
      'zip',
      'countryId',
      'verifiedCountryId',
      'nationalityId', // Foreign keys to country
      'birthday',
      'tin',
      'identDocumentId',
      'identDocumentType',
      'organizationName',
      'organizationStreet',
      'organizationLocation',
      'organizationZip',
      'organizationCountryId',
      'organizationId',
      'allBeneficialOwnersName',
      'allBeneficialOwnersDomicile',
      'accountOpenerAuthorization',
      'complexOrgStructure',
      'accountOpener',
      'legalEntity',
      'signatoryPower',
      'kycHash',
      'kycFileId',
      'apiKeyCT',
      'totpSecret',
      'internalAmlNote',
      'blackSquadRecipientMail',
      'individualFees',
      'paymentLinksConfig',
      'paymentLinksName',
      'comment',
      'relatedUsers',
    ],
    // user
    user: ['ip', 'ipCountry', 'apiKeyCT', 'signature', 'label', 'comment'],
    // bank_tx - bank transactions
    bank_tx: [
      'name',
      'ultimateName',
      'iban',
      'accountIban',
      'senderAccount',
      'bic',
      'addressLine1',
      'addressLine2',
      'ultimateAddressLine1',
      'ultimateAddressLine2',
      'bankAddressLine1',
      'bankAddressLine2',
      'remittanceInfo',
      'txInfo',
      'txRaw',
    ],
    // bank_data
    bank_data: ['name', 'iban', 'label', 'comment'],
    // fiat_output
    fiat_output: [
      'name',
      'iban',
      'accountIban',
      'accountNumber',
      'bic',
      'aba',
      'address',
      'houseNumber',
      'zip',
      'city',
      'remittanceInfo',
    ],
    // checkout_tx - payment card data
    checkout_tx: [
      'cardName',
      'ip',
      'cardBin',
      'cardLast4',
      'cardFingerPrint',
      'cardIssuer',
      'cardIssuerCountry',
      'raw',
    ],
    // bank_account
    bank_account: ['accountNumber'],
    // virtual_iban
    virtual_iban: ['iban', 'bban', 'label'],
    // kyc_step - KYC steps (result/data contains names, birthday, document number)
    kyc_step: ['result', 'comment', 'data'],
    // kyc_file
    kyc_file: ['name'],
    // kyc_log (includes TfaLog ChildEntity with ipAddress)
    kyc_log: ['comment', 'ipAddress', 'result'],
    // organization
    organization: [
      'name',
      'street',
      'houseNumber',
      'location',
      'zip',
      'allBeneficialOwnersName',
      'allBeneficialOwnersDomicile',
    ],
    // transactions
    buy_crypto: ['recipientMail', 'comment', 'chargebackIban', 'chargebackRemittanceInfo', 'siftResponse'],
    buy_fiat: ['recipientMail', 'comment', 'remittanceInfo', 'usedBank', 'info'],
    transaction: ['recipientMail'],
    crypto_input: ['recipientMail', 'senderAddresses'],
    // payment_link
    payment_link: ['comment', 'label'],
    // wallet (integration)
    wallet: ['apiKey'],
    // ref - referral tracking
    ref: ['ip'],
    // ip_log - IP logging
    ip_log: ['ip', 'country'],
    // buy - buy crypto routes
    buy: ['iban'],
    // deposit_route - sell routes (Single Table Inheritance for Sell entity)
    deposit_route: ['iban'],
    // bank_tx_return - chargeback returns
    bank_tx_return: ['chargebackIban', 'recipientMail', 'chargebackRemittanceInfo', 'info'],
    // bank_tx_repeat - repeat transactions
    bank_tx_repeat: ['chargebackIban', 'chargebackRemittanceInfo'],
    // limit_request - limit increase requests
    limit_request: ['recipientMail', 'fundOriginText'],
    // ref_reward - referral rewards
    ref_reward: ['recipientMail'],
    // transaction_risk_assessment - AML/KYC assessments
    transaction_risk_assessment: ['reason', 'methods', 'summary', 'result'],
    // support_issue - support tickets with user data
    support_issue: ['name', 'information'],
    // support_message - message content and file URLs
    support_message: ['message', 'fileUrl'],
    // sift_error_log - Sift API request payloads containing PII
    sift_error_log: ['requestPayload'],
    // webhook - serialized user/transaction data
    webhook: ['data'],
    // notification - notification payloads with user data
    notification: ['data'],
  };

  private readonly DebugMaxResults = 10000;

  // blocked system schemas (prevent access to system tables)
  private readonly BlockedSchemas = ['sys', 'information_schema', 'master', 'msdb', 'tempdb'];

  // dangerous functions that could be used for data exfiltration or external connections
  private readonly DangerousFunctions = ['openrowset', 'openquery', 'opendatasource', 'openxml'];

  // Log query templates (safe, predefined KQL queries)
  private readonly LogQueryTemplates: Record<
    LogQueryTemplate,
    { kql: string; requiredParams: (keyof LogQueryDto)[]; defaultLimit: number }
  > = {
    [LogQueryTemplate.TRACES_BY_OPERATION]: {
      kql: `traces
| where operation_Id == "{operationId}"
| where timestamp > ago({hours}h)
| project timestamp, severityLevel, message, customDimensions
| order by timestamp desc`,
      requiredParams: ['operationId'],
      defaultLimit: 500,
    },
    [LogQueryTemplate.TRACES_BY_MESSAGE]: {
      kql: `traces
| where timestamp > ago({hours}h)
| where message contains "{messageFilter}"
| project timestamp, severityLevel, message, operation_Id
| order by timestamp desc`,
      requiredParams: ['messageFilter'],
      defaultLimit: 200,
    },
    [LogQueryTemplate.EXCEPTIONS_RECENT]: {
      kql: `exceptions
| where timestamp > ago({hours}h)
| project timestamp, problemId, outerMessage, innermostMessage, operation_Id
| order by timestamp desc`,
      requiredParams: [],
      defaultLimit: 500,
    },
    [LogQueryTemplate.REQUEST_FAILURES]: {
      kql: `requests
| where timestamp > ago({hours}h)
| where success == false
| project timestamp, resultCode, duration, operation_Name, operation_Id
| order by timestamp desc`,
      requiredParams: [],
      defaultLimit: 500,
    },
    [LogQueryTemplate.DEPENDENCIES_SLOW]: {
      kql: `dependencies
| where timestamp > ago({hours}h)
| where duration > {durationMs}
| project timestamp, target, type, duration, success, operation_Id
| order by duration desc`,
      requiredParams: ['durationMs'],
      defaultLimit: 200,
    },
    [LogQueryTemplate.CUSTOM_EVENTS]: {
      kql: `customEvents
| where timestamp > ago({hours}h)
| where name == "{eventName}"
| project timestamp, name, customDimensions, operation_Id
| order by timestamp desc`,
      requiredParams: ['eventName'],
      defaultLimit: 500,
    },
  };

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
      virtualIbans: await this.virtualIbanService.getVirtualIbansForAccount(userData),
    };
  }

  async executeDebugQuery(sql: string, userIdentifier: string): Promise<Record<string, unknown>[]> {
    // 1. Parse SQL to AST for robust validation
    let ast;
    try {
      ast = this.sqlParser.astify(sql, { database: 'TransactSQL' });
    } catch {
      throw new BadRequestException('Invalid SQL syntax');
    }

    // 2. Only single SELECT statements allowed (array means multiple statements)
    const statements = Array.isArray(ast) ? ast : [ast];
    if (statements.length !== 1) {
      throw new BadRequestException('Only single statements allowed');
    }

    const stmt = statements[0];
    if (stmt.type !== 'select') {
      throw new BadRequestException('Only SELECT queries allowed');
    }

    // 3. No UNION/INTERSECT/EXCEPT queries (these have _next property)
    if (stmt._next) {
      throw new BadRequestException('UNION/INTERSECT/EXCEPT queries not allowed');
    }

    // 4. No SELECT INTO (creates tables - write operation!)
    if (stmt.into?.type === 'into' || stmt.into?.expr) {
      throw new BadRequestException('SELECT INTO not allowed');
    }

    // 5. No system tables/schemas (prevent access to sys.*, INFORMATION_SCHEMA.*, etc.)
    this.checkForBlockedSchemas(stmt);

    // 6. No dangerous functions anywhere in the query (external connections)
    this.checkForDangerousFunctionsRecursive(stmt);

    // 7. No FOR XML/JSON (data exfiltration)
    const normalizedLower = sql.toLowerCase();
    if (normalizedLower.includes(' for xml') || normalizedLower.includes(' for json')) {
      throw new BadRequestException('FOR XML/JSON not allowed');
    }

    // 8. Check for blocked columns BEFORE execution (prevents alias bypass)
    const tables = this.getTablesFromQuery(sql);
    const blockedColumn = this.findBlockedColumnInQuery(sql, stmt, tables);
    if (blockedColumn) {
      throw new BadRequestException(`Access to column '${blockedColumn}' is not allowed`);
    }

    // 9. Validate TOP value if present (use AST for accurate detection including TOP(n) syntax)
    if (stmt.top?.value > this.DebugMaxResults) {
      throw new BadRequestException(`TOP value exceeds maximum of ${this.DebugMaxResults}`);
    }

    // 10. Log query for audit trail
    this.logger.info(`Debug query by ${userIdentifier}: ${sql.substring(0, 500)}${sql.length > 500 ? '...' : ''}`);

    // 11. Execute query with result limit
    try {
      const limitedSql = this.ensureResultLimit(sql);
      const result = await this.dataSource.query(limitedSql);

      // 12. Post-execution masking (defense in depth - also catches pre-execution failures)
      this.maskDebugBlockedColumns(result, tables);

      return result;
    } catch (e) {
      this.logger.warn(`Debug query by ${userIdentifier} failed: ${e.message}`);
      throw new BadRequestException('Query execution failed');
    }
  }

  async executeLogQuery(dto: LogQueryDto, userIdentifier: string): Promise<LogQueryResult> {
    const template = this.LogQueryTemplates[dto.template];
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
    this.logger.info(`Log query by ${userIdentifier}: template=${dto.template}, params=${JSON.stringify(dto)}`);

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
      this.logger.warn(`Log query by ${userIdentifier} failed: ${e.message}`);
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

      for (const selectPath of selectPaths) {
        const docPath = this.toDocPath(selectPath, userDataId);
        userData[selectPath] = docPath === commonPathPrefix ? docs : docs.filter((doc) => doc.url.includes(docPath));
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
    const restrictedColumns = this.RestrictedColumns[table];
    if (!restrictedColumns?.length) return;

    for (const entry of data) {
      for (const column of restrictedColumns) {
        const prefixedKey = `${table}_${column}`;
        if (prefixedKey in entry) {
          entry[prefixedKey] = this.RestrictedMarker;
        } else if (column in entry) {
          entry[column] = this.RestrictedMarker;
        }
      }
    }
  }

  private maskDebugBlockedColumns(data: Record<string, unknown>[], tables: string[]): void {
    if (!data?.length || !tables?.length) return;

    // Collect all blocked columns from all tables in the query
    const blockedColumns = new Set<string>();
    for (const table of tables) {
      const tableCols = this.TableBlockedColumns[table];
      if (tableCols) {
        for (const col of tableCols) {
          blockedColumns.add(col.toLowerCase());
        }
      }
    }

    if (blockedColumns.size === 0) return;

    for (const entry of data) {
      for (const key of Object.keys(entry)) {
        if (this.shouldMaskDebugColumn(key, blockedColumns)) {
          entry[key] = this.RestrictedMarker;
        }
      }
    }
  }

  private shouldMaskDebugColumn(columnName: string, blockedColumns: Set<string>): boolean {
    const lower = columnName.toLowerCase();

    // Check exact match or with table prefix (e.g., "name" or "bank_tx_name")
    for (const blocked of blockedColumns) {
      if (lower === blocked || lower.endsWith('_' + blocked)) {
        return true;
      }
    }
    return false;
  }

  private getTablesFromQuery(sql: string): string[] {
    const tableList = this.sqlParser.tableList(sql, { database: 'TransactSQL' });
    // Format: 'select::null::table_name' → extract table_name
    return tableList.map((t) => t.split('::')[2]).filter(Boolean);
  }

  private getAliasToTableMap(ast: any): Map<string, string> {
    const map = new Map<string, string>();
    if (!ast.from) return map;

    for (const item of ast.from) {
      if (item.table) {
        map.set(item.as || item.table, item.table);
      }
    }
    return map;
  }

  private isColumnBlockedInTable(columnName: string, table: string | null, allTables: string[]): boolean {
    const lower = columnName.toLowerCase();

    if (table) {
      // Explicit table known → check if this column is blocked in this table
      const blockedCols = this.TableBlockedColumns[table];
      return blockedCols?.some((b) => b.toLowerCase() === lower) ?? false;
    } else {
      // No explicit table → if ANY of the query tables blocks this column, block it
      return allTables.some((t) => {
        const blockedCols = this.TableBlockedColumns[t];
        return blockedCols?.some((b) => b.toLowerCase() === lower) ?? false;
      });
    }
  }

  private findBlockedColumnInQuery(sql: string, ast: any, tables: string[]): string | null {
    try {
      // columnList returns: ['select::table::column', 'select::null::column', ...]
      const columns = this.sqlParser.columnList(sql, { database: 'TransactSQL' });
      const aliasMap = this.getAliasToTableMap(ast);

      for (const col of columns) {
        const parts = col.split('::');
        const tableOrAlias = parts[1]; // can be 'null'
        const columnName = parts[2];

        // Skip wildcard - handled post-execution
        if (columnName === '*' || columnName === '(.*)') continue;

        // Resolve table from alias
        const resolvedTable =
          tableOrAlias === 'null'
            ? tables.length === 1
              ? tables[0]
              : null // Single table without alias → use that table
            : aliasMap.get(tableOrAlias) || tableOrAlias;

        // Check if column is blocked in this table
        if (this.isColumnBlockedInTable(columnName, resolvedTable, tables)) {
          return `${resolvedTable || 'unknown'}.${columnName}`;
        }
      }

      return null;
    } catch {
      // If column extraction fails, let the query proceed (will be caught by result masking)
      return null;
    }
  }

  private checkForBlockedSchemas(stmt: any): void {
    const checkTables = (from: any[]): void => {
      if (!from) return;

      for (const item of from) {
        // Check table schema (e.g., sys.sql_logins, INFORMATION_SCHEMA.TABLES)
        const schema = item.db?.toLowerCase() || item.schema?.toLowerCase();
        const table = item.table?.toLowerCase();

        if (schema && this.BlockedSchemas.includes(schema)) {
          throw new BadRequestException(`Access to schema '${schema}' is not allowed`);
        }

        // Also check if table name starts with blocked schema (e.g., "sys.objects" without explicit schema)
        if (table && this.BlockedSchemas.some((s) => table.startsWith(s + '.'))) {
          throw new BadRequestException(`Access to system tables is not allowed`);
        }

        // Recursively check subqueries
        if (item.expr?.ast) {
          this.checkForBlockedSchemas(item.expr.ast);
        }
      }
    };

    checkTables(stmt.from);

    // Also check WHERE clause subqueries
    this.checkSubqueriesForBlockedSchemas(stmt.where);
  }

  private checkSubqueriesForBlockedSchemas(node: any): void {
    if (!node) return;

    if (node.ast) {
      this.checkForBlockedSchemas(node.ast);
    }

    if (node.left) this.checkSubqueriesForBlockedSchemas(node.left);
    if (node.right) this.checkSubqueriesForBlockedSchemas(node.right);
    if (node.expr) this.checkSubqueriesForBlockedSchemas(node.expr);
    if (node.args) {
      const args = Array.isArray(node.args) ? node.args : [node.args];
      for (const arg of args) {
        this.checkSubqueriesForBlockedSchemas(arg);
      }
    }
  }

  private checkForDangerousFunctionsRecursive(stmt: any): void {
    // Check FROM clause for dangerous functions
    this.checkFromForDangerousFunctions(stmt.from);

    // Check SELECT columns for dangerous functions
    this.checkExpressionsForDangerousFunctions(stmt.columns);

    // Check WHERE clause for dangerous functions
    this.checkNodeForDangerousFunctions(stmt.where);
  }

  private checkFromForDangerousFunctions(from: any[]): void {
    if (!from) return;

    for (const item of from) {
      // Check if FROM contains a function call
      if (item.type === 'expr' && item.expr?.type === 'function') {
        const funcName = this.extractFunctionName(item.expr);
        if (funcName && this.DangerousFunctions.includes(funcName)) {
          throw new BadRequestException(`Function '${funcName.toUpperCase()}' not allowed`);
        }
      }

      // Recursively check subqueries in FROM
      if (item.expr?.ast) {
        this.checkForDangerousFunctionsRecursive(item.expr.ast);
      }
    }
  }

  private checkExpressionsForDangerousFunctions(columns: any[]): void {
    if (!columns) return;

    for (const col of columns) {
      this.checkNodeForDangerousFunctions(col.expr);
    }
  }

  private checkNodeForDangerousFunctions(node: any): void {
    if (!node) return;

    // Check if this node is a function call
    if (node.type === 'function') {
      const funcName = this.extractFunctionName(node);
      if (funcName && this.DangerousFunctions.includes(funcName)) {
        throw new BadRequestException(`Function '${funcName.toUpperCase()}' not allowed`);
      }
    }

    // Check subqueries
    if (node.ast) {
      this.checkForDangerousFunctionsRecursive(node.ast);
    }

    // Recursively check child nodes
    if (node.left) this.checkNodeForDangerousFunctions(node.left);
    if (node.right) this.checkNodeForDangerousFunctions(node.right);
    if (node.expr) this.checkNodeForDangerousFunctions(node.expr);
    if (node.args) {
      const args = Array.isArray(node.args) ? node.args : node.args?.value || [];
      for (const arg of Array.isArray(args) ? args : [args]) {
        this.checkNodeForDangerousFunctions(arg);
      }
    }
  }

  private extractFunctionName(funcNode: any): string | null {
    // Handle different AST structures for function names
    if (funcNode.name?.name?.[0]?.value) {
      return funcNode.name.name[0].value.toLowerCase();
    }
    if (typeof funcNode.name === 'string') {
      return funcNode.name.toLowerCase();
    }
    return null;
  }

  private ensureResultLimit(sql: string): string {
    const normalized = sql.trim().toLowerCase();

    // Check if query already has a LIMIT/TOP clause
    if (normalized.includes(' top ') || normalized.includes(' limit ')) {
      return sql;
    }

    // MSSQL requires ORDER BY for OFFSET/FETCH - add dummy order if missing
    // Use string search on normalized input to avoid ReDoS on user-controlled data
    const hasOrderBy = normalized.includes('order') && normalized.includes('by');
    const orderByClause = hasOrderBy ? '' : ' ORDER BY (SELECT NULL)';

    return `${sql.trim().replace(/;*$/, '')}${orderByClause} OFFSET 0 ROWS FETCH NEXT ${
      this.DebugMaxResults
    } ROWS ONLY`;
  }
}
