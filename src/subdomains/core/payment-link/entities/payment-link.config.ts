import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { PaymentQuoteStatus, PaymentStandard } from '../enums';

export interface PaymentLinkConfig {
  standards: PaymentStandard[];
  blockchains: Blockchain[];
  minCompletionStatus: PaymentQuoteStatus;
  displayQr: boolean;
}
