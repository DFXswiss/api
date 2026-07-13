export interface FrickAuthorizeRequest {
  key: string;
}

export interface FrickAuthorizeResponse {
  token: string;
}

export interface FrickAccount {
  account: string;
  type: string;
  iban?: string;
  customer: string;
  currency: string;
  balance: number;
  available?: number;
}

export interface FrickAccountsResponse {
  date: string;
  moreResults: boolean;
  resultSetSize: number;
  accounts: FrickAccount[];
}

export interface FrickBalance {
  iban: string;
  currency: string;
  balance: number;
  availableBalance?: number;
}

export enum FrickPaymentType {
  SEPA = 'SEPA',
  SEPA_INSTANT = 'SEPA_INSTANT',
  FOREIGN = 'FOREIGN',
}

export enum FrickPaymentCharge {
  BENEFICIARY = 'BEN',
  OUR = 'OUR',
  SHARED = 'SHA',
}

export enum FrickPaymentState {
  PREPARED = 'PREPARED',
  IN_PROGRESS = 'IN_PROGRESS',
  EXECUTED = 'EXECUTED',
  BOOKED = 'BOOKED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
  DELETED = 'DELETED',
  DELETION_REQUESTED = 'DELETION_REQUESTED',
  ERROR = 'ERROR',
}

export interface FrickPaymentAccount {
  accountNumber?: string;
  iban?: string;
  name?: string;
  address?: string;
  postalcode?: string;
  city?: string;
  country?: string;
  bic?: string;
  creditInstitution?: string;
}

export interface FrickPaymentOrderInput {
  customId: string;
  amount: number;
  currency: 'CHF' | 'EUR';
  instant?: boolean;
  reference?: string;
  charge?: FrickPaymentCharge;
  debtorIban: string;
  creditor: FrickPaymentAccount;
}

export interface FrickCreateTransaction {
  customId: string;
  type: FrickPaymentType;
  amount: number;
  currency: 'CHF' | 'EUR';
  express?: boolean;
  reference?: string;
  charge?: FrickPaymentCharge;
  debitor: FrickPaymentAccount;
  creditor: FrickPaymentAccount;
}

export interface FrickCreateTransactionsRequest {
  transactions: FrickCreateTransaction[];
}

export interface FrickPaymentOrder {
  orderId?: number;
  transactionNr?: string;
  customId: string;
  type: FrickPaymentType;
  state: FrickPaymentState;
  amount: number | string;
  currency: string;
  express?: boolean;
  reference?: string;
  charge?: FrickPaymentCharge;
  debitor: FrickPaymentAccount;
  creditor: FrickPaymentAccount;
}

export interface FrickTransactionsResponse {
  moreResults: boolean;
  resultSetSize: number;
  transactions: FrickPaymentOrder[];
}

export interface FrickApproveWithoutTanRequest {
  customIds: string[];
}
