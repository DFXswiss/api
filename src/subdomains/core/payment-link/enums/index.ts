export enum PaymentLinkStatus {
  ACTIVE = 'Active',
  INACTIVE = 'Inactive',
}

export enum PaymentLinkPaymentStatus {
  PENDING = 'Pending',
  COMPLETED = 'Completed',
  CANCELLED = 'Cancelled',
  EXPIRED = 'Expired',
}

export enum PaymentLinkPaymentQuoteStatus {
  ACTUAL = 'Actual',
  CANCELLED = 'Cancelled',
  EXPIRED = 'Expired',
}

export enum PaymentActivationStatus {
  PENDING = 'Pending',
  EXPIRED = 'Expired',
  CANCELLED = 'Cancelled',
  COMPLETED = 'Completed',
}

export enum PaymentLinkPaymentMode {
  SINGLE = 'Single',
  MULTIPLE = 'Multiple',
}
