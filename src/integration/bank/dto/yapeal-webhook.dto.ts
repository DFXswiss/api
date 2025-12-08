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
  transactionUid: string;
  accountUid: string;
  iban: string;

  type: YapealTransactionType;
  status: YapealTransactionStatus;
  amount: number;
  currency: string;

  bookingDate?: string;
  valueDate?: string;

  counterpartyName?: string;
  counterpartyIban?: string;
  counterpartyBic?: string;
  counterpartyAddress?: string;

  reference?: string;
  remittanceInfo?: string;
  endToEndId?: string;

  rawData?: Record<string, unknown>;
}

export interface YapealWebhookPayloadDto {
  eventType: string;
  eventUid: string;
  timestamp: string;
  partnershipUid: string;
  data: YapealWebhookTransactionDto;
}
