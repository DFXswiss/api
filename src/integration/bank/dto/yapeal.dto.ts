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
  status: 'active' | 'cancelled' | 'cancelling' | 'locked' | 'new' | 'retired';
}

export interface YapealAccountsResponse {
  accounts: YapealAccount[];
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

export type YapealPaymentStatus = 'SUCCESS' | 'CREATED' | 'NOCONTENT';

export interface YapealPaymentStatusResponse {
  fileContent?: string; // base64 encoded pain.002 XML
  status: YapealPaymentStatus;
}
