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
  scanTimeout?: number;
  autoConfirmSecs?: number;
  payoutRouteId?: number;
  // user data only
  payoutFrequency?: PayoutFrequency;
  ep2ReportContainer?: string;
  requiresExplicitPayoutRoute?: boolean;
  requiresConfirmation?: boolean;
  // c2b payment provider related
  binancePayMerchantId?: string;
  binancePaySubMerchantId?: string;
  kucoinPaySubMerchantId?: string;
  // access key related
  accessKeys?: string[];
}
