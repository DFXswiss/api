import { Injectable } from '@nestjs/common';
import { EthereumService } from 'src/blockchain/ethereum/ethereum.service';
import { PayoutEVMService } from './payout-evm.service';

@Injectable()
export class PayoutEthereumService extends PayoutEVMService {
  constructor(ethereumService: EthereumService) {
    super(ethereumService);
  }
}
