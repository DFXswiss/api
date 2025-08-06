import { Injectable } from '@nestjs/common';
import { CitreaTestnetService } from 'src/integration/blockchain/citrea-testnet/citrea-testnet.service';
import { PayoutEvmService } from './base/payout-evm.service';

@Injectable()
export class PayoutCitreaTestnetService extends PayoutEvmService {
  constructor(citreaTestnetService: CitreaTestnetService) {
    super(citreaTestnetService);
  }
}