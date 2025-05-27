import { Injectable } from '@nestjs/common';
import { GnosisService } from 'src/integration/blockchain/gnosis/gnosis.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { LiquidityOrderRepository } from '../repositories/liquidity-order.repository';
import { DexEvmService } from './base/dex-evm.service';

@Injectable()
export class DexGnosisService extends DexEvmService {
  constructor(liquidityOrderRepo: LiquidityOrderRepository, gnosisService: GnosisService) {
    super(liquidityOrderRepo, gnosisService, 'ETH', Blockchain.GNOSIS);
  }
}
