import { Injectable } from '@nestjs/common';
import { SepoliaService } from 'src/integration/blockchain/sepolia/sepolia.service';
import { PayoutEvmService } from './payout-evm.service';

@Injectable()
export class PayoutSepoliaService extends PayoutEvmService {
  constructor(sepoliaService: SepoliaService) {
    super(sepoliaService);
  }
}
