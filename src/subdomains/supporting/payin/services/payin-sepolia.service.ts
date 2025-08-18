import { Injectable } from '@nestjs/common';
import { SepoliaService } from 'src/integration/blockchain/sepolia/sepolia.service';
import { PayInEvmService } from './base/payin-evm.service';

@Injectable()
export class PayInSepoliaService extends PayInEvmService {
  constructor(sepoliaService: SepoliaService) {
    super(sepoliaService);
  }
}