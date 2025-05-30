import { PaymentLinkBlockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { PaymentLinkRecipientDto } from '../dto/payment-link-recipient.dto';
import { PaymentQuoteStatus, PaymentStandard } from '../enums';

export enum PayoutFrequency {
  IMMEDIATE = 'Immediate',
  DAILY = 'Daily',
}

export interface PaymentLinkConfig {
  standards: PaymentStandard[];
  blockchains: PaymentLinkBlockchain[];
  minCompletionStatus: PaymentQuoteStatus;
  displayQr: boolean;
  fee: number;
  recipient?: PaymentLinkRecipientDto;
  paymentTimeout: number;
  autoConfirmSecs?: number;
  payoutRouteId?: number;
  // user data only
  payoutFrequency?: PayoutFrequency;
  ep2ReportContainer?: string;
  requiresExplicitPayoutRoute?: boolean;
  // binance pay related
  binancePayMerchantId?: string;
  binancePaySubMerchantId?: string;
}
