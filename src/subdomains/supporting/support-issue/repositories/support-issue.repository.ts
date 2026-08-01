import { Injectable } from '@nestjs/common';
import { ReadProjection } from 'src/shared/models/read-projection';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager, FindOptionsWhere } from 'typeorm';
import { ListOrderDirection, SupportIssueListOrderBy } from '../dto/get-support-issue.dto';
import { SupportIssue } from '../entities/support-issue.entity';
import { SupportMessage } from '../entities/support-message.entity';
import { Department } from '../enums/department.enum';
import { SupportIssueInternalState, SupportIssueType } from '../enums/support-issue.enum';

/** The fields `CountryDtoMapper.entityToDto` reads, for a given join alias. */
const countryFields = (alias: string): string[] =>
  [
    'id',
    'symbol',
    'name',
    'foreignName',
    'ipEnable',
    'fatfEnable',
    'dfxEnable',
    'dfxOrganizationEnable',
    'nationalityStepEnable',
    'bankEnable',
    'checkoutEnable',
    'cryptoEnable',
  ].map((field) => `${alias}.${field}`);

/**
 * The fields a transaction contributes, for either of the two sides.
 *
 * `mapTransactionData` reads `buyCrypto ?? buyFiat`, so both are joined and both carry the same
 * shape — except for the output asset, which is an `Asset` on one side and a `Fiat` on the other:
 * only the crypto side has a blockchain to report.
 */
const transactionSideFields = (side: string, inputAsset: string, outputAsset: string): string[] => [
  `${side}.amlReason`,
  `${side}.comment`,
  `${side}.inputAmount`,
  `${side}.inputAsset`,
  `${side}.outputAmount`,
  `${side}.isComplete`,
  `${inputAsset}.blockchain`,
  `${outputAsset}.name`,
];

/** What the issue itself contributes, including the JSON column behind `additionalInformation`. */
export const SUPPORT_ISSUE_DATA_ISSUE_FIELDS = [
  'supportIssue.id',
  'supportIssue.created',
  'supportIssue.uid',
  'supportIssue.type',
  'supportIssue.department',
  'supportIssue.reason',
  'supportIssue.state',
  'supportIssue.name',
  'supportIssue.clerk',
  // `additionalInformation` is a getter over this column; the mapper reads the parsed object.
  'supportIssue.information',
];

/** What `SupportIssueDtoMapper.mapUserData` reads. */
export const SUPPORT_ISSUE_DATA_ACCOUNT_FIELDS = [
  'userData.id',
  'userData.status',
  'userData.verifiedName',
  // `completeName` is a getter: organizationName, falling back to firstname and surname.
  'userData.organizationName',
  'userData.firstname',
  'userData.surname',
  'userData.accountType',
  'userData.kycLevel',
  'userData.depositLimit',
  'userData.annualBuyVolume',
  'userData.annualSellVolume',
  'userData.annualCryptoVolume',
  'userData.kycHash',
  ...countryFields('userDataCountry'),
  'userDataLanguage.id',
  'userDataLanguage.name',
  'userDataLanguage.symbol',
  'userDataLanguage.foreignName',
  'userDataLanguage.enable',
];

/** What `SupportIssueDtoMapper.mapTransactionData` reads. */
export const SUPPORT_ISSUE_DATA_TRANSACTION_FIELDS = [
  'transaction.id',
  'transaction.sourceType',
  'transaction.type',
  'transaction.amlCheck',
  ...transactionSideFields('buyCrypto', 'buyCryptoInputAsset', 'buyCryptoOutputAsset'),
  // Only the crypto side reports an output blockchain — the fiat side's output asset is a currency.
  'buyCryptoOutputAsset.blockchain',
  ...transactionSideFields('buyFiat', 'buyFiatInputAsset', 'buyFiatOutputAsset'),
  'transactionUserWallet.displayName',
  'transactionUserWallet.name',
  'transactionUserWallet.amlRules',
  'transactionUserWallet.isKycClient',
];

/**
 * What `SupportIssueDtoMapper.mapLimitRequestData` reads.
 *
 * Withheld from support and tenant staff by the endpoint, but the field list does not depend on the
 * role: the query is the same and the mapper is skipped.
 */
export const SUPPORT_ISSUE_DATA_LIMIT_REQUEST_FIELDS = [
  'limitRequest.id',
  'limitRequest.fundOrigin',
  'limitRequest.investmentDate',
  'limitRequest.limit',
  'limitRequest.acceptedLimit',
  'limitRequest.decision',
];

/**
 * What `SupportIssueDtoMapper.mapSupportIssue` reads — the customer-facing view of an issue.
 *
 * `issueTransaction.uid` covers both values the transaction contributes: `url` is a getter over it.
 * Messages are not part of this; they are loaded separately and projected by
 * `SUPPORT_MESSAGE_RESPONSE_FIELDS`.
 */
export const SUPPORT_ISSUE_RESPONSE_FIELDS = [
  'supportIssue.uid',
  'supportIssue.state',
  'supportIssue.type',
  'supportIssue.reason',
  'supportIssue.name',
  'supportIssue.created',
  'issueTransaction.uid',
  'issueLimitRequest.id',
  'issueLimitRequest.limit',
];

/**
 * `GET /support/issue` and `GET /support/issue/:id` — 450 columns before, for nine values.
 *
 * `supportIssue.id` is a guard rather than a response field: the mapper never shows it, but
 * `getIssue` loads the message thread by it afterwards. `issueTransaction.id` is what
 * `mapTransaction` checks to decide whether there is a transaction at all.
 */
export const SUPPORT_ISSUE_PROJECTION = new ReadProjection<SupportIssue>(
  'supportIssue',
  [
    ['supportIssue.transaction', 'issueTransaction'],
    ['supportIssue.limitRequest', 'issueLimitRequest'],
  ],
  SUPPORT_ISSUE_RESPONSE_FIELDS,
  ['supportIssue.id', 'issueTransaction.id'],
);

/**
 * `GET /support/issue/:id/data` — the widest read path in the service.
 *
 * The unprojected load reaches 951 columns: the issue's four eager relations expand recursively,
 * and the transaction pulls in both of its sides with their inputs and assets. The response is
 * about sixty values.
 */
export const SUPPORT_ISSUE_DATA_PROJECTION = new ReadProjection<SupportIssue>(
  'supportIssue',
  [
    ['supportIssue.userData', 'userData'],
    ['userData.country', 'userDataCountry'],
    ['userData.language', 'userDataLanguage'],
    ['supportIssue.transaction', 'transaction'],
    ['transaction.user', 'transactionUser'],
    ['transactionUser.wallet', 'transactionUserWallet'],
    ['transaction.buyCrypto', 'buyCrypto'],
    ['buyCrypto.outputAsset', 'buyCryptoOutputAsset'],
    ['buyCrypto.cryptoInput', 'buyCryptoInput'],
    ['buyCryptoInput.asset', 'buyCryptoInputAsset'],
    ['transaction.buyFiat', 'buyFiat'],
    ['buyFiat.outputAsset', 'buyFiatOutputAsset'],
    ['buyFiat.cryptoInput', 'buyFiatInput'],
    ['buyFiatInput.asset', 'buyFiatInputAsset'],
    ['supportIssue.limitRequest', 'limitRequest'],
  ],
  [
    ...SUPPORT_ISSUE_DATA_ISSUE_FIELDS,
    ...SUPPORT_ISSUE_DATA_ACCOUNT_FIELDS,
    ...SUPPORT_ISSUE_DATA_TRANSACTION_FIELDS,
    ...SUPPORT_ISSUE_DATA_LIMIT_REQUEST_FIELDS,
  ],
  // Never part of the response: the primary keys that make the ORM materialise the joined rows.
  // `transaction.id`, `userData.id` and `limitRequest.id` are response fields already, and the
  // mapper uses two of them to decide whether the relation is there at all.
  [
    'transactionUser.id',
    'transactionUserWallet.id',
    'buyCrypto.id',
    'buyCryptoInput.id',
    'buyCryptoInputAsset.id',
    'buyCryptoOutputAsset.id',
    'buyFiat.id',
    'buyFiatInput.id',
    'buyFiatInputAsset.id',
    'buyFiatOutputAsset.id',
  ],
);

/** What `SupportIssueDtoMapper.mapSupportIssueListItem` reads off the issue itself. */
export const SUPPORT_ISSUE_LIST_RESPONSE_FIELDS = [
  'issue.id',
  'issue.uid',
  'issue.type',
  'issue.reason',
  'issue.state',
  'issue.name',
  'issue.clerk',
  'issue.department',
  'issue.created',
  'issue.updated',
];

/**
 * `GET /support/issue/list` and `GET /realunit/support/list` — 16 columns before, ten of them read.
 *
 * The six it drops are the five foreign keys and `information`, which is `text` and holds the
 * free-form body of the issue. The list shows a row per issue and none of it, so on a page of
 * results that column is the bulk of what the query transfers.
 *
 * Every column `SupportIssueListOrderBy` allows is in the list above, which the query needs: the
 * paginated form of `getManyAndCount` orders a distinct-id subquery by the sort column.
 */
export const SUPPORT_ISSUE_LIST_PROJECTION = new ReadProjection<SupportIssue>(
  'issue',
  [],
  SUPPORT_ISSUE_LIST_RESPONSE_FIELDS,
);

/**
 * The already-authorised shape of a list request.
 *
 * `departments` and `customerIds` are the two scopes the endpoint can be called under, resolved
 * from the role before they get here — this is the query, not the access decision.
 */
export interface SupportIssueListQuery {
  departments?: Department[];
  customerIds?: number[];
  states?: SupportIssueInternalState[];
  type?: SupportIssueType;
  clerk?: string;
  createdFrom?: Date;
  createdTo?: Date;
  /** Search terms, already split and trimmed. Each must match at least one field. */
  terms: string[];
  orderBy: SupportIssueListOrderBy;
  orderDir: ListOrderDirection;
  take?: number;
  skip?: number;
}

@Injectable()
export class SupportIssueRepository extends BaseRepository<SupportIssue> {
  constructor(manager: EntityManager) {
    super(SupportIssue, manager);
  }

  /**
   * The issue list, with the page and the unpaged total.
   *
   * `fields` exists for the mutation test; nothing in production passes it.
   */
  async findIssueList(
    query: SupportIssueListQuery,
    fields: ReadonlyArray<string> = SUPPORT_ISSUE_LIST_PROJECTION.fields,
  ): Promise<[SupportIssue[], number]> {
    const qb = SUPPORT_ISSUE_LIST_PROJECTION.apply(this.createQueryBuilder('issue'), fields);

    // The search predicate and the customer scope both need the account; they share one alias.
    if (query.terms.length > 0 || query.customerIds) qb.leftJoin('issue.userData', 'userData');

    // The customer scope replaces the department gate rather than adding to it. With a left join,
    // an issue without an account is never IN the scope list, so it fails closed.
    if (query.customerIds) qb.andWhere('"userData".id IN (:...customerIds)', { customerIds: query.customerIds });
    else if (query.departments)
      qb.andWhere('issue.department IN (:...departments)', { departments: query.departments });

    if (query.states?.length) qb.andWhere('issue.state IN (:...states)', { states: query.states });
    if (query.type) qb.andWhere('issue.type = :type', { type: query.type });
    if (query.clerk) qb.andWhere('issue.clerk = :clerk', { clerk: query.clerk });
    if (query.createdFrom) qb.andWhere('issue.created >= :createdFrom', { createdFrom: query.createdFrom });
    if (query.createdTo) qb.andWhere('issue.created <= :createdTo', { createdTo: query.createdTo });

    for (let i = 0; i < query.terms.length; i++) {
      const param = `term${i}`;
      // Only emit the id branch when the term is fully numeric AND fits int4 (Postgres rejects
      // larger values with 22003, which would 500 the entire search — a pasted phone number
      // like "41791234567" is a realistic trigger). Keeps the predicate on the PK index (no
      // cast-to-text) and avoids partial-match surprises (term "42" doesn't match id 142).
      const idTerm =
        /^\d+$/.test(query.terms[i]) && parseInt(query.terms[i], 10) <= 2147483647
          ? parseInt(query.terms[i], 10)
          : null;
      const idClause = idTerm != null ? ` OR issue.id = :${param}Id` : '';
      // The message branch goes through the query builder rather than a literal table name, so the
      // table is resolved the way the ORM resolves every other one — a bare `support_message` is
      // looked up against the search path instead.
      const messageMatch = qb
        .subQuery()
        .select('1')
        .from(SupportMessage, 'message')
        .where('message."issueId" = issue.id')
        .andWhere(`message.message LIKE :${param}`)
        .getQuery();
      qb.andWhere(
        `(issue.name LIKE :${param} OR issue.uid LIKE :${param} OR issue.clerk LIKE :${param} OR "userData".firstname LIKE :${param} OR "userData".surname LIKE :${param} OR "userData"."organizationName" LIKE :${param} OR EXISTS ${messageMatch}${idClause})`,
        { [param]: `%${query.terms[i]}%`, ...(idTerm != null ? { [`${param}Id`]: idTerm } : {}) },
      );
    }

    // Whitelisted sort column and direction, with an id tie-break for stable pagination on equal
    // sort keys.
    qb.orderBy(`issue.${query.orderBy}`, query.orderDir);
    qb.addOrderBy('issue.id', query.orderDir);

    if (query.take != null) {
      qb.take(query.take);
      if (query.skip != null) qb.skip(query.skip);
    }

    return qb.getManyAndCount();
  }

  /**
   * Loads exactly what the internal issue view needs.
   *
   * `fields` exists for the mutation test; nothing in production passes it.
   */
  async findIssueData(
    id: number,
    fields: ReadonlyArray<string> = SUPPORT_ISSUE_DATA_PROJECTION.fields,
  ): Promise<SupportIssue> {
    return SUPPORT_ISSUE_DATA_PROJECTION.apply(this.createQueryBuilder('supportIssue'), fields)
      .where('supportIssue.id = :id', { id })
      .getOne();
  }

  /** An account's own issues, loaded with the customer-facing fields only. */
  async findIssuesForAccount(
    userDataId: number,
    fields: ReadonlyArray<string> = SUPPORT_ISSUE_PROJECTION.fields,
  ): Promise<SupportIssue[]> {
    return SUPPORT_ISSUE_PROJECTION.apply(this.createQueryBuilder('supportIssue'), fields)
      .leftJoin('supportIssue.userData', 'issueUserData')
      .where('issueUserData.id = :userDataId', { userDataId })
      .getMany();
  }

  /**
   * A single issue, found by the caller's search condition.
   *
   * The condition is passed through rather than rebuilt here on purpose: it is the access check for
   * this endpoint family — an issue is reachable by its UID, by the UID of the quote behind it, or
   * by numeric id scoped to the owning account — and stating it twice is how the two copies drift
   * apart. `setFindOptions` applies it to the same query builder that carries the projection.
   */
  async findIssueBy(
    search: FindOptionsWhere<SupportIssue>,
    fields: ReadonlyArray<string> = SUPPORT_ISSUE_PROJECTION.fields,
  ): Promise<SupportIssue> {
    return SUPPORT_ISSUE_PROJECTION.apply(this.createQueryBuilder('supportIssue'), fields)
      .setFindOptions({ where: search, loadEagerRelations: false })
      .getOne();
  }
}
