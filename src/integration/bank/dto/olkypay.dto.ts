// --- Transaction DTOs (Reporting) --- //

export interface OlkypayTransaction {
  idCtp: number;
  dateEcriture: number[];
  dateValeur: number[];
  codeInterbancaireInterne: OlkypayTransactionType;
  codeInterbancaire: string;
  credit: number;
  debit: number;
  line1: string;
  line2: string;
  instructingIban: string;
}

export enum OlkypayTransactionType {
  RECEIVED = 'SCT_RECEIVED',
  SENT = 'SCT_SENT',
  BILLING = 'BILLING',
}

export interface OlkypayBalance {
  codeShop: string;
  supplierId: number;
  balance: number;
  balanceOperationYesterday: number;
}

export interface OlkypayTokenAuth {
  access_token: string;
  expires_in: number;
  refresh_expires_in: number;
  refresh_token: string;
  token_type: string;
  id_token: string;
  session_state: string;
}

// --- Payer (Beneficiary) DTOs --- //

export interface OlkypayPayerRequest {
  externalClientCode?: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  gender?: OlkypayGender;
  siret?: string;
  rcs?: string;
  vat?: string;
  email?: string;
  phoneNumber?: string;
  mobileNumber?: string;
  birthDayDate?: string; // YYYY-MM-DD
  moralPerson: boolean;
  zipCode: string;
  city: string;
  supplierId: number;
  supplierCodeShop?: string;
  countryCode: string;
  address1: string;
  address2?: string;
  address3?: string;
  beneficiary?: boolean;
  payer?: boolean;
}

export interface OlkypayPayerUpdateRequest extends OlkypayPayerRequest {
  id: number;
}

export enum OlkypayGender {
  MR = 'MR',
  MME = 'MME',
  MR_ET_MME = 'MR ET MME',
  MLE = 'MLE',
}

export interface OlkypayEntityResponse {
  id: string;
  entity: string;
}

// --- Bank Account DTOs --- //

export interface OlkypayBankAccountRequest {
  clientId: number;
  name: string;
  iban: string;
  countryCode?: string;
  bban?: string;
  bankName?: string;
  institutionName?: string;
  bankAddress1?: string;
  bankLocation?: string;
}

// --- Payment Order (SCT) DTOs --- //

export interface OlkypayPaymentOrderRequest {
  clientId: number;
  comment: string;
  currencyCode: string;
  executionDate: string; // YYYY-MM-DD
  externalId: string;
  nominalAmount: number; // in cents
  packageNumber: string;
  recidivism: boolean;
  invoiceDate?: string;
  invoiceExternalCode?: string;
  limitDate?: string;
  packageDate?: string;
}

// --- Instant Payment DTOs --- //

export interface OlkypayInstantPaymentRequest {
  clientId: number;
  comment: string;
  paymentId: number; // obtained from bank account creation
  externalId: string;
  nominalAmount: number; // in euro cents
}

// --- Order Status DTOs --- //

export enum OlkypayOrderStatus {
  TO_VALIDATE = 'TO_VALIDATE',
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
}

export enum OlkypayOrderCategory {
  SCT = 'SCT', // SEPA Transfer
  STD = 'STD', // SEPA Direct Debit
  IP = 'IP', // Instant Payment
}

export interface OlkypayOrderResponse {
  id: number;
  externalId: string;
  nominalAmount: number;
  recidivism: boolean;
  executionDate: number[];
  comment: string;
  immediate: boolean;
  currencyCode: string;
  clientId: number;
  orderStatus: OlkypayOrderStatus;
  category: OlkypayOrderCategory;
}

// --- IBAN Eligibility DTOs --- //

export type OlkypayIbanEligibilityResponse = boolean;
