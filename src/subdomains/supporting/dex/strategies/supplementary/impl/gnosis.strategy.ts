import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DexGnosisService } from '../../../services/dex-gnosis.service';
import { EvmStrategy } from './base/evm.strategy';

@Injectable()
export class GnosisStrategy extends EvmStrategy {
  constructor(gnosisService: DexGnosisService) {
    super(gnosisService);
  }

  get blockchain(): Blockchain {
    return Blockchain.GNOSIS;
  }
}
