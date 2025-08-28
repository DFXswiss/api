import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import {
  getEnabledBlockchains,
  getEnabledPaymentLinkBlockchains,
  isBlockchainEnabled,
} from 'src/integration/blockchain/shared/enums/blockchain-config';

@Injectable()
export class BlockchainAvailabilityService {
  isBlockchainEnabled(blockchain: Blockchain): boolean {
    return isBlockchainEnabled(blockchain, Config.environment);
  }

  getEnabledBlockchains(): Blockchain[] {
    return getEnabledBlockchains(Config.environment);
  }

  getEnabledPaymentLinkBlockchains(): Blockchain[] {
    return getEnabledPaymentLinkBlockchains(Config.environment);
  }
}