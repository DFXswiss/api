export interface CheckoutHostedPayment {
  id: string;
  _links: {
    redirect: { href: string };
  };
}

export enum CheckoutPaymentStatus {
  PENDING = 'Pending',
  AUTHORIZED = 'Authorized',
  CARD_VERIFIED = 'Card Verified',
  VOIDED = 'Voided',
  PARTIALLY_CAPTURED = 'Partially Captured',
  CAPTURED = 'Captured',
  PARTIALLY_REFUNDED = 'Partially Refunded',
  REFUNDED = 'Refunded',
  REFUNDED_PENDING = 'Refunded Pending',
  DECLINED = 'Declined',
  CANCELED = 'Canceled',
  EXPIRED = 'Expired',
  PAID = 'Paid',
}

export enum CheckoutPaymentType {
  REGULAR = 'Regular',
  RECURRING = 'Recurring',
  MOTO = 'MOTO',
  INSTALLMENT = 'Installment',
  UNSCHEDULED = 'Unscheduled',
}

export enum CheckoutCardType {
  CREDIT = 'Credit',
  DEBIT = 'Debit',
  PREPAID = 'Prepaid',
  CHARGE = 'Charge',
  DEFERRED_DEBIT = 'Deferred Debit',
}

export enum CheckoutCardCategory {
  CONSUMER = 'Consumer',
  COMMERCIAL = 'Commercial',
}

export enum CheckoutTdsEnrolled {
  YES = 'Y',
  NO = 'N',
  UNKNOWN = 'U',
}

export enum CheckoutTdsResponse {
  Y = 'Y',
  N = 'N',
  U = 'U',
  A = 'A',
  C = 'C',
  D = 'D',
  R = 'R',
  I = 'I',
}

export enum CheckoutTdsExemption {
  LOW_VALUE = 'low_value',
  SECURE_CORPORATE_PAYMENT = 'secure_corporate_payment',
  TRUSTED_LISTING = 'trusted_listing',
  TRANSACTION_RISK_ASSESSMENT = 'transaction_risk_assessment',
  TDS_OUTAGE = '3ds_outage',
  SCA_DELEGATION = 'sca_delegation',
  OUT_OF_SCA_SCOPE = 'out_of_sca_scope',
  OTHER = 'other',
  LOW_RISK_PROGRAM = 'low_risk_program',
  NONE = 'none',
}

export interface CheckoutPayment {
  id: string;
  requested_on: string;
  source: {
    id: string;
    type: string;
    billing_address: {
      address_line1: string;
      address_line2: string;
      city: string;
      state: string;
      zip: string;
      country: string;
    };
    phone: {
      country_code: string;
      number: string;
    };
    expiry_month: number;
    expiry_year: number;
    name: string;
    scheme: string;
    last4: string;
    fingerprint: string;
    bin: string;
    card_type: CheckoutCardType;
    card_category: CheckoutCardCategory;
    issuer: string;
    issuer_country: string;
    product_id: string;
    product_type: string;
    avs_check: string;
    cvv_check: string;
    payment_account_reference: string;
  };
  expires_on: string;
  items: [];
  amount: number;
  currency: string;
  payment_type: CheckoutPaymentType;
  reference: string;
  description: string;
  status: CheckoutPaymentStatus;
  approved: boolean;
  '3ds': {
    downgraded: boolean;
    enrolled: CheckoutTdsEnrolled;
    authentication_response: CheckoutTdsResponse;
    authentication_status_reason: string;
    cryptogram: string;
    xid: string;
    version: string;
    exemption: CheckoutTdsExemption;
    challenged: boolean;
    exemption_applied: 'none';
  };
  balances: {
    total_authorized: number;
    total_voided: number;
    available_to_void: number;
    total_captured: number;
    available_to_capture: number;
    total_refunded: number;
    available_to_refund: number;
  };
  risk: {
    flagged: boolean;
    score: number;
  };
  payment_ip: string;
  metadata: Record<string, string | boolean>;
  processing: Record<string, string | boolean>;
  eci: string;
  scheme_id: string;
}

export interface CheckoutPagedResponse<T> {
  total_count: number;
  skip: number;
  limit: number;
  data: T[];
}

export const CheckoutLanguages = {
  EN: 'en-GB',
  DE: 'de-DE',
  FR: 'fr-FR',
  IT: 'it-IT',
  ES: 'es-ES',
  PT: 'pt-PT',
};
