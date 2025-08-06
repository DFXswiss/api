import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { PayoutRequest } from '../../../entities/payout-request.entity';
import { PayoutCitreaTestnetService } from '../../../services/payout-citrea-testnet.service';
import { EvmStrategy } from './base/evm.strategy';

@Injectable()
export class CitreaTestnetStrategy extends EvmStrategy {
  constructor(citreaTestnetService: PayoutCitreaTestnetService) {
    super(citreaTestnetService);
  }

  get blockchain(): Blockchain {
    return Blockchain.CITREA_TESTNET;
  }

  async preparePayout(_: PayoutRequest): Promise<void> {
    // CitreaTestnet preparation logic if needed
    // Currently using default EVM preparation
    return;
  }
}