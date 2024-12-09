import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { PaymentLinkRecipientDto } from '../dto/payment-link-recipient.dto';
import { PaymentQuoteStatus, PaymentStandard } from '../enums';

export enum PayoutFrequency {
  IMMEDIATE = 'Immediate',
  DAILY = 'Daily',
}

export interface PaymentLinkConfig {
  standards: PaymentStandard[];
  blockchains: Blockchain[];
  minCompletionStatus: PaymentQuoteStatus;
  displayQr: boolean;
  fee: number;
  recipient?: PaymentLinkRecipientDto;
  paymentTimeout: number;
  payoutFrequency?: PayoutFrequency;
}
