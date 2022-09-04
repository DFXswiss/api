import { Injectable } from '@nestjs/common';
import { BSCService } from 'src/blockchain/bsc/bsc.service';
import { PayoutEVMService } from './payout-evm.service';

@Injectable()
export class PayoutBSCService extends PayoutEVMService {
  constructor(bscService: BSCService) {
    super(bscService);
  }
}
