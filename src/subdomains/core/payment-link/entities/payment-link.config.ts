import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { PaymentLinkRecipientDto } from '../dto/payment-link.dto';
import { PaymentQuoteStatus, PaymentStandard } from '../enums';

export interface PaymentLinkConfig {
  standards: PaymentStandard[];
  blockchains: Blockchain[];
  minCompletionStatus: PaymentQuoteStatus;
  displayQr: boolean;
  fee: number;
  recipient?: PaymentLinkRecipientDto;
}
