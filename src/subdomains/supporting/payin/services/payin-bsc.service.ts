import { Injectable } from '@nestjs/common';
import { BscService } from 'src/integration/blockchain/bsc/bsc.service';
import { PayInEvmService } from './payin-evm.service';

@Injectable()
export class PayInBscService extends PayInEvmService {
  constructor(bscService: BscService) {
    super(bscService);
  }
}
