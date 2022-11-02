import { Injectable } from '@nestjs/common';
import { EthereumService } from 'src/integration/blockchain/ethereum/ethereum.service';
import { PayoutEvmService } from './payout-evm.service';

@Injectable()
export class PayoutEthereumService extends PayoutEvmService {
  constructor(ethereumService: EthereumService) {
    super(ethereumService);
  }
}
