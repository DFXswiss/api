import { Injectable } from '@nestjs/common';
import { ReadProjection } from 'src/shared/models/read-projection';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager, FindOptionsWhere } from 'typeorm';
import { SupportIssue } from '../entities/support-issue.entity';

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

@Injectable()
export class SupportIssueRepository extends BaseRepository<SupportIssue> {
  constructor(manager: EntityManager) {
    super(SupportIssue, manager);
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
