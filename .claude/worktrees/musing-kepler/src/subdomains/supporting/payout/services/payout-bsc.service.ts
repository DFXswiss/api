import { Injectable } from '@nestjs/common';
import { BscService } from 'src/integration/blockchain/bsc/bsc.service';
import { PayoutEvmService } from './payout-evm.service';

@Injectable()
export class PayoutBscService extends PayoutEvmService {
  constructor(bscService: BscService) {
    super(bscService);
  }
}
