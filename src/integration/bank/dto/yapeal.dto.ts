// --- VIBAN DTOs --- //

export interface VibanReserveRequest {
  baseAccountIBAN: string;
  bban: string;
}

export interface VibanReserveResponse {
  accountUid: string;
  bban: string;
  expiresAt: string;
  iban: string;
}

export interface VibanProposalResponse {
  bban: string;
  iban: string;
}

export interface VibanListResponse {
  vIBANS: Array<{
    vIBAN: string;
    vQrIBAN?: string;
  }>;
}

// --- Account/Balance DTOs --- //

export enum YapealAccountStatus {
  ACTIVE = 'active',
  CANCELLED = 'cancelled',
  CANCELLING = 'cancelling',
  LOCKED = 'locked',
  NEW = 'new',
  RETIRED = 'retired',
}

export interface YapealAmount {
  factor: number;
  value: number;
}

export interface YapealBalance {
  amount: YapealAmount;
  currency: string;
}

export interface YapealAccountBalances {
  available: YapealBalance;
  total: YapealBalance;
}

export interface YapealAccount {
  balances: YapealAccountBalances;
  currency: string;
  iban: string;
  name: string;
  status: YapealAccountStatus;
}

export interface YapealAccountsResponse {
  accounts: YapealAccount[];
}

export interface YapealAccountOwner {
  name: string;
  legalForm: string;
  status: string;
  uid: string;
}

export interface YapealEntitlement {
  entitlementUid: string;
  action: string;
}

export interface YapealEntitledAccount {
  accountName: string;
  accountUid: string;
  accountContractUid: string;
  subAccountUIDs: string[];
  accountIBAN: string;
  accountQRIBAN: string;
  closeOrderUid: string | null;
  createdAt: string;
  status: YapealAccountStatus;
  currency: string;
  openingDate: string;
  closingDate: string;
  bic: string;
  availableBalance: YapealBalance;
  balance: YapealBalance;
  isOwnedByYapini: boolean;
  accountOwner: YapealAccountOwner;
  myEntitlements: YapealEntitlement[];
  internationalPaymentsAvailable: boolean;
}

// --- Instant Payment DTOs (Pain.001 JSON Format) --- //

export interface YapealInstdAmt {
  Ccy: string;
  value: number;
}

export interface YapealPostalAddress {
  StrtNm?: string;
  BldgNb?: string;
  PstCd?: string;
  TwnNm?: string;
  Ctry: string;
}

export interface YapealParty {
  Nm: string;
  PstlAdr?: YapealPostalAddress;
}

export interface YapealAccountId {
  IBAN: string;
}

export interface YapealAccount2 {
  Id: YapealAccountId;
  Ccy?: string;
}

export interface YapealPaymentId {
  EndToEndId: string;
}

export interface YapealRemittanceInfo {
  Ustrd?: string;
}

export interface YapealCreditTransferTxInfo {
  PmtId: YapealPaymentId;
  Amt: {
    InstdAmt: YapealInstdAmt;
  };
  Cdtr: YapealParty;
  CdtrAcct: YapealAccount2;
  RmtInf?: YapealRemittanceInfo;
}

export interface YapealPaymentInfo {
  Dbtr: YapealParty;
  DbtrAcct: YapealAccount2;
  CdtTrfTxInf: YapealCreditTransferTxInfo[];
}

export interface YapealGroupHeader {
  MsgId: string;
  NbOfTxs: string;
  CtrlSum: number;
  InitgPty: {
    Nm: string;
    CtctDtls?: {
      Nm?: string;
      Othr?: string;
    };
  };
}

export interface YapealPain001Request {
  CstmrCdtTrfInitn: {
    GrpHdr: YapealGroupHeader;
    PmtInf: YapealPaymentInfo[];
  };
}

// --- Payment Status DTOs --- //

export enum YapealPaymentStatus {
  SUCCESS = 'SUCCESS',
  CREATED = 'CREATED',
  NOCONTENT = 'NOCONTENT',
}

export interface YapealPaymentStatusResponse {
  fileContent?: string; // base64 encoded pain.002 XML
  status: YapealPaymentStatus;
}

// --- Transaction Subscription DTOs --- //

export enum YapealSubscriptionFormat {
  JSON = 'JSON',
  XML = 'XML',
}

export interface YapealSubscriptionRequest {
  iban: string;
  callbackPath?: string;
  criteria?: string;
  format?: YapealSubscriptionFormat;
}

export interface YapealSubscription {
  uid: string;
  typeName: string;
  status: string;
  ownerUid: string;
  ownerEntityUid: string;
  createdAt: string;
  updatedAt: string;
  retiredAt: string;
  revNr: number;
  histUid: string;
  histPrevUid: string;
  data: {
    accountIBAN: string;
    accountUid: string;
    provider: string;
    providerUid: string;
    format: YapealSubscriptionFormat;
    callbackURL: string;
    callbackPath?: string;
  };
}

// --- Transaction Enrichment DTOs --- //

export interface YapealTransactionDetails {
  uid: string;
  counterpartName?: string;
  counterpartMyPicture?: string;
  ultimateCreditorName?: string;
  ultimateCreditorAddress?: string;
  ultimateCreditorAddressLines?: string[];
  ultimateDebitorName?: string;
  ultimateDebitorAddress?: string;
  ultimateDebitorAddressLines?: string[];
  creditor?: {
    name?: string;
    iban?: string;
    bic?: string;
  };
}
