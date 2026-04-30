import { Injectable } from '@nestjs/common';
import { CitreaTestnetService } from 'src/integration/blockchain/citrea-testnet/citrea-testnet.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { LiquidityOrderRepository } from '../repositories/liquidity-order.repository';
import { DexEvmService } from './base/dex-evm.service';

@Injectable()
export class DexCitreaTestnetService extends DexEvmService {
  constructor(liquidityOrderRepo: LiquidityOrderRepository, citreaTestnetService: CitreaTestnetService) {
    super(liquidityOrderRepo, citreaTestnetService, 'cBTC', Blockchain.CITREA_TESTNET);
  }
}
