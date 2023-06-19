export enum PaymentStatus {
  UNKNOWN = 'UNKNOWN',
  IN_FLIGHT = 'IN_FLIGHT',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
}

export interface LndPaymentsDto {
  payments: LndPaymentDto[];
}

export interface LndPaymentDto {
  payment_hash: string;
  value_sat: number;
  fee_sat: number;
  creation_date: number;
  payment_request: string;
  status: PaymentStatus;
}
