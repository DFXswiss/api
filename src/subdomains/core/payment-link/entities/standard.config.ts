import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { PaymentStandard } from '../enums';

export interface PaymentLinkConfig {
  standards: PaymentStandard[];
  blockchains: Blockchain[];
}
