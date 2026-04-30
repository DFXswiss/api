import { Injectable } from '@nestjs/common';
import { GnosisService } from 'src/integration/blockchain/gnosis/gnosis.service';
import { PayInEvmService } from './base/payin-evm.service';

@Injectable()
export class PayInGnosisService extends PayInEvmService {
  constructor(gnosisService: GnosisService) {
    super(gnosisService);
  }
}
