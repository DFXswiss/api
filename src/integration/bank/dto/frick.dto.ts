// Distinguishable from a generic Error so callers can safely treat "no such order" as reliable
// evidence a payout was never created (the lookup always searches from BankFrickService's earliest
// fromDate, never a narrow recent window) instead of an ambiguous transport/validation failure.
export class FrickPaymentOrderNotFoundError extends Error {
  constructor(customId: string) {
    super(`Bank Frick payment order ${customId} not found`);
    this.name = 'FrickPaymentOrderNotFoundError';
  }
}

// A failed response-signature verification is a detected tampered-response attack, not a generic
// transport failure - distinguishable so it is never reported to operators as the indistinguishable
// "request failed" string that defeats detection of the exact attack the signature check exists for.
export class FrickSignatureVerificationError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'FrickSignatureVerificationError';
  }
}

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

// DELETION_REQUESTED is intentionally NOT terminal: the bank order can still be executed or fail
// later, so liquidity must stay reserved and the status must keep being polled until a real terminal
// state (or a matching debit bankTx via the isComplete path) arrives. Exported so both
// FiatOutputFrickService and the payment monitor can agree on exactly which states are terminal.
export const FRICK_TERMINAL_STATES = [
  FrickPaymentState.REJECTED,
  FrickPaymentState.EXPIRED,
  FrickPaymentState.DELETED,
  FrickPaymentState.ERROR,
];

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
  // Older Bank Frick response examples use this misspelling. Never send it, but accept it when comparing a
  // returned order with the idempotent request that created it.
  creditInsitution?: string;
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

export type FrickApproveWithoutTanRequest =
  | { orderIds: number[]; customIds?: never }
  | { customIds: string[]; orderIds?: never };
