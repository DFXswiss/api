// --- Currency Type --- //

export type RelioCurrency = 'CHF' | 'EUR' | 'GBP';

// --- Amount DTOs --- //

export interface RelioAmount {
  currency: string;
  amount: string; // Minor units: "98434500" = 984345.00
}

// --- Auth Context DTOs --- //

export interface RelioAuthContext {
  organizations: RelioOrganization[];
}

export interface RelioOrganization {
  id: string;
  name: string;
  type: string;
  accounts: RelioAccountRef[];
}

export interface RelioAccountRef {
  id: string;
  wallets: RelioWalletRef[];
}

export interface RelioWalletRef {
  id: string;
  status: string;
}

// --- Account DTOs --- //

export interface RelioAccount {
  id: string;
  createdAt: string;
  state: RelioAccountState;
  wallets?: RelioWallet[];
}

export enum RelioAccountState {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

// --- Wallet DTOs --- //

export interface RelioWallet {
  id: string;
  iban: string;
  state: RelioWalletState;
  name: string;
  currency: RelioCurrency;
  availableBalance: RelioAmount;
  balance: RelioAmount;
  createdAt: string;
}

export enum RelioWalletState {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

export interface RelioWalletListResponse {
  totalRecords: number;
  pageNumber: number;
  pageSize: number;
  data: RelioWalletListItem[];
}

export interface RelioWalletListItem {
  id: string;
  iban: string;
  name: string;
  currencyCode: RelioCurrency;
  state: RelioWalletState;
}

// --- Payment Order DTOs --- //

export interface RelioPayee {
  name: string;
  accountNumber: string; // IBAN
  addressLine1?: string;
  city?: string;
  postCode?: string;
  country: string;
}

export interface RelioPaymentDetails {
  payee: RelioPayee;
  amount: RelioAmount;
  reference?: string;
}

export interface RelioSchedule {
  startDate: string; // YYYY-MM-DD
  frequency: RelioPaymentFrequency;
}

export enum RelioPaymentFrequency {
  MONTHLY = 'MONTHLY',
  ANNUALLY = 'ANNUALLY',
}

export interface RelioPaymentOrderRequest {
  walletId: string;
  name: string;
  payment: RelioPaymentDetails;
  schedule?: RelioSchedule;
}

export interface RelioPaymentOrderResponse {
  id: string;
  paymentId: string;
}

export interface RelioPaymentOrder {
  id: string;
  createdAtUtc: string;
  updatedAtUtc: string;
  paymentOrderId: string;
  accountId: string;
  walletId: string;
  amount: RelioAmount;
  reference?: string;
  scheme: string;
  schedule?: {
    frequency: RelioPaymentFrequency;
    type: string;
    startDate: string;
  };
  state: RelioPaymentState;
  payee: {
    name: string;
    iban: string;
    payeeType: string;
    addressLine1?: string;
    city?: string;
    postCode?: string;
    country: string;
  };
  fees: RelioFee[];
  deletedAtUtc?: string;
}

export enum RelioPaymentState {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export interface RelioFee {
  type: string;
  amount: RelioAmount;
}

// --- FX Quote DTOs --- //

export interface RelioFxQuoteRequest {
  sourceWalletId: string;
  targetWalletId: string;
  amount: {
    type: 'SOURCE' | 'TARGET';
    value: string;
  };
}

export interface RelioFxQuoteResponse {
  id: string;
  options: RelioFxQuoteOption[];
}

export interface RelioFxQuoteOption {
  id: string;
  expiresAtUtc: string;
  fxRate: number;
  fxMargin: number;
  fxMarginPercentage: number;
  cumulativeFXRate: number;
  sourceAmount: RelioAmount;
  sourceAmountTotal: RelioAmount;
  targetAmount: RelioAmount;
}

export interface RelioFxPaymentRequest {
  quoteId: string;
  quoteOptionId: string;
  name: string;
  reference?: string;
}

// --- API Key DTOs --- //

export interface RelioApiKey {
  id: string;
  name: string;
  allowedIPs: string[];
  clientPublicKey: string;
  createdAt: string;
  disabledAt: string | null;
}

export interface RelioApiKeyUpdateRequest {
  name?: string;
  allowedIPs?: string[];
  clientPublicKey?: string;
  disabled?: boolean;
}
