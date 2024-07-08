import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';

export enum PaymentLinkStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

export enum PaymentLinkPaymentStatus {
  PENDING = 'Pending',
  COMPLETED = 'Completed',
  CANCELLED = 'Cancelled',
  EXPIRED = 'Expired',
}

export enum PaymentLinkPaymentMode {
  SINGLE = 'single',
  MULTIPLE = 'multiple',
}

export interface TransferPrice {
  asset: string;
  amount: number;
  method: Blockchain;
}
