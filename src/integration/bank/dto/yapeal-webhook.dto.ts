// YAPEAL Webhook DTOs based on B2B TrxSubscriptions API

export enum YapealTransactionType {
  CREDIT = 'CREDIT',
  DEBIT = 'DEBIT',
}

export enum YapealTransactionStatus {
  BOOKED = 'BOOKED',
  PENDING = 'PENDING',
  CANCELLED = 'CANCELLED',
}

export interface YapealWebhookTransactionDto {
  // Transaction identification
  transactionUid: string;
  accountUid: string;
  iban: string;

  // Transaction details
  type: YapealTransactionType;
  status: YapealTransactionStatus;
  amount: number;
  currency: string;

  // Dates
  bookingDate?: string;
  valueDate?: string;

  // Counterparty information
  counterpartyName?: string;
  counterpartyIban?: string;
  counterpartyBic?: string;
  counterpartyAddress?: string;

  // Payment details
  reference?: string;
  remittanceInfo?: string;
  endToEndId?: string;

  // Raw data
  rawData?: Record<string, unknown>;
}

export interface YapealWebhookPayloadDto {
  eventType: string;
  eventUid: string;
  timestamp: string;
  partnershipUid: string;
  data: YapealWebhookTransactionDto;
}
