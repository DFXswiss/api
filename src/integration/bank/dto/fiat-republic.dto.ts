// --- SHARED --- //

export enum FiatRepublicOwnerType {
  MEMBER = 'MEMBER',
  END_USER = 'END_USER',
}

export enum FiatRepublicPaymentScheme {
  SCT = 'SCT',
  EAGLE_NET_TRANSFER = 'EAGLE_NET_TRANSFER',
}

export interface FiatRepublicOwner {
  type: FiatRepublicOwnerType;
  id: string;
}

export interface FiatRepublicAddress {
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  postalCode: string;
  country: string;
}

export interface FiatRepublicRoutingCode {
  type: string;
  value: string;
}

export interface FiatRepublicBankDetails {
  bankName?: string;
  bankAddress?: string;
  accountHolderName?: string;
  country?: string;
  iban?: string;
  bic?: string;
  accountNumber?: string;
  routingCodes?: FiatRepublicRoutingCode[];
}

export interface FiatRepublicTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

/** Fiat Republic answers every 4xx/5xx with this envelope (see docs/error-handling). */
export interface FiatRepublicErrorResponse {
  errorCode?: string;
  message?: string;
  warnings?: { position?: string; issue?: string }[];
}

// --- END USER --- //

export enum FiatRepublicEndUserStatus {
  CREATED = 'CREATED',
  ACTIVE = 'ACTIVE',
  IN_REVIEW = 'IN_REVIEW',
  REJECTED = 'REJECTED',
  SUSPENDED = 'SUSPENDED',
  CLOSED = 'CLOSED',
}

/** Terminal in the sense that no further Fiat Republic-side transition can make the user usable. */
export const FIAT_REPUBLIC_END_USER_DEAD_STATES = [
  FiatRepublicEndUserStatus.REJECTED,
  FiatRepublicEndUserStatus.SUSPENDED,
  FiatRepublicEndUserStatus.CLOSED,
];

export interface FiatRepublicPerson {
  firstName: string;
  middleName?: string;
  lastName: string;
  address: FiatRepublicAddress;
  email: string;
  phone?: string;
  birthCountry?: string;
  nationality?: string[];
  dob: string;
}

export interface FiatRepublicCreateEndUserRequest {
  person: FiatRepublicPerson;
  ipAddress: string;
}

export interface FiatRepublicEndUserResponse {
  id: string;
  person: FiatRepublicPerson;
  status: FiatRepublicEndUserStatus;
  createdAt: number;
  updatedAt: number;
}

// --- FIAT / VIRTUAL ACCOUNT --- //

export enum FiatRepublicAccountStatus {
  CREATED = 'CREATED',
  ACTIVE = 'ACTIVE',
  BLOCKED = 'BLOCKED',
  UNBLOCKING = 'UNBLOCKING',
  ACTIVATION_FAILED = 'ACTIVATION_FAILED',
  CLOSED = 'CLOSED',
}

export const FIAT_REPUBLIC_ACCOUNT_DEAD_STATES = [
  FiatRepublicAccountStatus.ACTIVATION_FAILED,
  FiatRepublicAccountStatus.CLOSED,
];

export interface FiatRepublicFiatAccountResponse {
  id: string;
  businessId?: string;
  owner: FiatRepublicOwner;
  balance: { actual: string; available: string; reserved: string };
  currency: string;
  bankDetails: FiatRepublicBankDetails | null;
  label?: string;
  status: FiatRepublicAccountStatus;
  tags?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface FiatRepublicCreateVirtualAccountRequest {
  masterFiatAccountId: string;
  ibanCountry: string;
  endUserId?: string;
  label?: string;
}

export interface FiatRepublicVirtualAccountResponse {
  id: string;
  masterFiatAccountId: string;
  status: FiatRepublicAccountStatus;
  currency: string;
  owner: FiatRepublicOwner;
  businessId?: string;
  label?: string;
  bankDetails: FiatRepublicBankDetails | null;
  createdAt: number;
  updatedAt: number;
}

export interface FiatRepublicVirtualAccountTransaction {
  id: string;
  virtualAccountId: string;
  amount: string;
  currency: string;
  direction: 'CREDIT' | 'DEBIT';
  type: string;
  cause?: { type: string; id: string; reference?: string };
  counterparty?: string;
  createdAt: number;
}

// --- PAYEE --- //

export enum FiatRepublicPayeeType {
  PERSON = 'PERSON',
  BUSINESS = 'BUSINESS',
}

export enum FiatRepublicPayeeStatus {
  CREATED = 'CREATED',
  PROCESSING = 'PROCESSING',
  AWAITING_APPROVAL = 'AWAITING_APPROVAL',
  ACTIVE = 'ACTIVE',
  REJECTED = 'REJECTED',
  DELETED = 'DELETED',
}

export const FIAT_REPUBLIC_PAYEE_DEAD_STATES = [FiatRepublicPayeeStatus.REJECTED, FiatRepublicPayeeStatus.DELETED];

export interface FiatRepublicCreatePayeeRequest {
  type: FiatRepublicPayeeType;
  name: string;
  currency: string;
  address: FiatRepublicAddress;
  bankDetails: { iban: string; bic?: string };
  endUserId?: string;
}

export interface FiatRepublicPayeeResponse {
  id: string;
  owner: FiatRepublicOwner;
  type: FiatRepublicPayeeType;
  name: string;
  currency: string;
  address: FiatRepublicAddress | null;
  paymentSchemes?: string[];
  bankDetails: FiatRepublicBankDetails;
  status: FiatRepublicPayeeStatus;
  createdAt: number;
  updatedAt: number;
}

// --- PAYEE VERIFICATION (VoP, mandatory for SEPA EUR) --- //

export enum FiatRepublicVerificationStatus {
  PENDING_CUSTOMER_REVIEW = 'PENDING_CUSTOMER_REVIEW',
  ACCEPTED = 'ACCEPTED',
  DECLINED = 'DECLINED',
  EXEMPT = 'EXEMPT',
  ASSIGNED = 'ASSIGNED',
  EXPIRED = 'EXPIRED',
}

export enum FiatRepublicMatchLevel {
  MATCH = 'MATCH',
  CLOSE_MATCH = 'CLOSE_MATCH',
  NO_MATCH = 'NO_MATCH',
}

export interface FiatRepublicPayeeVerificationResponse {
  id: string;
  payeeId: string;
  assignedToId: string | null;
  status: FiatRepublicVerificationStatus;
  type: string;
  matchResult?: { matchLevel: FiatRepublicMatchLevel; description: string | null; accountHolder: string | null };
}

// --- PAYMENT --- //

export enum FiatRepublicPaymentDirection {
  PAYIN = 'PAYIN',
  PAYOUT = 'PAYOUT',
  TRANSFER = 'TRANSFER',
}

export enum FiatRepublicPaymentStatus {
  CREATED = 'CREATED',
  PROCESSING = 'PROCESSING',
  AWAITING_APPROVAL = 'AWAITING_APPROVAL',
  MEMBER_REVIEW = 'MEMBER_REVIEW',
  COMPLIANCE_REVIEW = 'COMPLIANCE_REVIEW',
  COMPLETED = 'COMPLETED',
  REJECTED = 'REJECTED',
  FAILED = 'FAILED',
  RETURNED = 'RETURNED',
}

/**
 * States from which a payment can no longer change: no further webhook, no further balance effect.
 * Everything else is still in flight and keeps its liquidity reserved on our side.
 */
export const FIAT_REPUBLIC_PAYMENT_TERMINAL_STATES = [
  FiatRepublicPaymentStatus.COMPLETED,
  FiatRepublicPaymentStatus.REJECTED,
  FiatRepublicPaymentStatus.FAILED,
  FiatRepublicPaymentStatus.RETURNED,
];

/** Terminal AND unpaid — the payout never left, so its reason must survive on the row. */
export const FIAT_REPUBLIC_PAYMENT_FAILED_STATES = [
  FiatRepublicPaymentStatus.REJECTED,
  FiatRepublicPaymentStatus.FAILED,
  FiatRepublicPaymentStatus.RETURNED,
];

export interface FiatRepublicCreatePaymentRequest {
  fromId: string;
  toId: string;
  amount: string;
  reference: string;
  paymentScheme: FiatRepublicPaymentScheme;
  payeeVerificationId?: string;
}

export interface FiatRepublicPaymentResponse {
  id: string;
  fromId?: string;
  toId?: string;
  from?: FiatRepublicPaymentParty;
  to?: FiatRepublicPaymentParty;
  direction: FiatRepublicPaymentDirection;
  reference: string;
  effectiveReference?: string;
  amount: string;
  currency: string;
  paymentScheme: string;
  status: FiatRepublicPaymentStatus;
  createdAt: number;
  updatedAt: number;
}

/**
 * Payment endpoints accept `fromId`/`toId` but the payment object (and every webhook built from it)
 * returns the counterparties as `{ id, type }` objects. Both shapes are modelled so a payin webhook
 * can be resolved without a second lookup.
 */
export interface FiatRepublicPaymentParty {
  id: string;
  type: 'FIAT_ACCOUNT' | 'VIRTUAL_ACCOUNT' | 'PAYEE' | 'PAYER';
}

// --- PAYER --- //

export interface FiatRepublicPayerResponse {
  id: string;
  owner?: FiatRepublicOwner;
  type: FiatRepublicPayeeType;
  name: string;
  bankDetails: FiatRepublicBankDetails;
  createdAt: number;
  updatedAt: number;
}

// --- WEBHOOK --- //

export enum FiatRepublicWebhookEvent {
  PAYMENT_CREATED = 'PAYMENT.CREATED',
  PAYMENT_UPDATED = 'PAYMENT.UPDATED',
  PAYMENT_STATUS_UPDATED = 'PAYMENT.STATUS_UPDATED',
  VIRTUAL_ACCOUNT_UPDATED = 'VIRTUAL_ACCOUNT.UPDATED',
  VIRTUAL_ACCOUNT_STATUS_UPDATED = 'VIRTUAL_ACCOUNT.STATUS_UPDATED',
  FIAT_ACCOUNT_UPDATED = 'FIAT_ACCOUNT.UPDATED',
  FIAT_ACCOUNT_STATUS_UPDATED = 'FIAT_ACCOUNT.STATUS_UPDATED',
  INDIVIDUAL_END_USER_STATUS_UPDATED = 'INDIVIDUAL_END_USER.STATUS_UPDATED',
  PAYEE_STATUS_UPDATED = 'PAYEE.STATUS_UPDATED',
  RETURN_STATUS_UPDATED = 'RETURN.STATUS_UPDATED',
}

export interface FiatRepublicWebhookPayload<T = unknown> {
  id: string;
  event: string;
  data: T;
  previousValues?: Record<string, unknown>;
  createdAt: number;
}

export interface FiatRepublicWebhookSignatureHeaders {
  digest?: string;
  signatureInput?: string;
  signature?: string;
}
