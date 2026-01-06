import { LogQueryDto, LogQueryTemplate } from './log-query.dto';

export const GsRestrictedMarker = '[RESTRICTED]';

// db endpoint
export const GsRestrictedColumns: Record<string, string[]> = {
  asset: ['ikna'],
};

// Debug endpoint
export const DebugMaxResults = 10000;
export const DebugBlockedSchemas = ['sys', 'information_schema', 'master', 'msdb', 'tempdb'];
export const DebugDangerousFunctions = ['openrowset', 'openquery', 'opendatasource', 'openxml'];
export const DebugBlockedCols: Record<string, string[]> = {
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
    'nationalityId',
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
  user: ['ip', 'ipCountry', 'apiKeyCT', 'signature', 'label', 'comment'],
  bank_tx: [
    'name',
    'ultimateName',
    'iban',
    'country',
    'accountIban',
    'senderAccount',
    'bic',
    'addressLine1',
    'addressLine2',
    'ultimateAddressLine1',
    'ultimateAddressLine2',
    'ultimateCountry',
    'bankAddressLine1',
    'bankAddressLine2',
    'remittanceInfo',
    'txInfo',
    'txRaw',
    'virtualIban',
  ],
  bank_data: ['name', 'iban', 'label'],
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
    'country',
  ],
  checkout_tx: ['cardName', 'ip', 'cardBin', 'cardLast4', 'cardFingerPrint', 'cardIssuer', 'cardIssuerCountry', 'raw'],
  virtual_iban: ['iban', 'bban', 'label'],
  kyc_step: ['result'],
  kyc_file: ['name', 'uid'],
  kyc_log: ['comment', 'ipAddress', 'result', 'pdfUrl'],
  organization: [
    'name',
    'street',
    'houseNumber',
    'location',
    'zip',
    'allBeneficialOwnersName',
    'allBeneficialOwnersDomicile',
    'accountOpenerAuthorization',
    'complexOrgStructure',
    'legalEntity',
    'signatoryPower',
    'countryId',
  ],
  buy_crypto: ['recipientMail', 'chargebackIban', 'chargebackRemittanceInfo', 'siftResponse'],
  buy_fiat: ['recipientMail', 'remittanceInfo', 'usedBank'],
  transaction: ['recipientMail'],
  crypto_input: ['recipientMail', 'senderAddresses'],
  payment_link: ['comment', 'label'],
  wallet: ['apiKey', 'apiUrl'],
  ref: ['ip'],
  ip_log: ['ip', 'country', 'address'],
  buy: ['iban'],
  deposit_route: ['iban'],
  bank_tx_return: ['chargebackIban', 'recipientMail', 'chargebackRemittanceInfo'],
  bank_tx_repeat: ['chargebackIban', 'chargebackRemittanceInfo'],
  limit_request: ['recipientMail', 'fundOriginText'],
  ref_reward: ['recipientMail'],
  transaction_risk_assessment: ['reason', 'methods', 'summary', 'result', 'pdf'],
  support_issue: ['name', 'information', 'uid'],
  support_message: ['message', 'fileUrl'],
  sift_error_log: ['requestPayload'],
  webhook: ['data'],
  notification: ['data'],
};
export const DebugLogQueryTemplates: Record<
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

// Support endpoint
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
