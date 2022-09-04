import { Injectable } from '@nestjs/common';
import { EthereumClient } from 'src/blockchain/ethereum/ethereum-client';
import { DexEthereumService } from '../../services/dex-ethereum.service';
import { CheckLiquidityEVMStrategy } from './base/check-liquidity-evm.strategy';

@Injectable()
export class CheckLiquidityETHStrategy extends CheckLiquidityEVMStrategy<EthereumClient> {
  constructor(dexEthereumService: DexEthereumService) {
    super(dexEthereumService);
  }
}
