import { Injectable } from '@nestjs/common';
import { EthereumService } from 'src/integration/blockchain/ethereum/ethereum.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { LiquidityOrderRepository } from '../repositories/liquidity-order.repository';
import { DexEvmService } from './dex-evm.service';

@Injectable()
export class DexEthereumService extends DexEvmService {
  constructor(liquidityOrderRepo: LiquidityOrderRepository, ethereumService: EthereumService) {
    super(liquidityOrderRepo, ethereumService, 'ETH', Blockchain.ETHEREUM);
  }
}
