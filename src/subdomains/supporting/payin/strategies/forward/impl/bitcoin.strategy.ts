import { Injectable } from '@nestjs/common';
import { PayInBitcoinService } from '../../../services/payin-bitcoin.service';
import { PayInRepository } from '../../../repositories/payin.repository';
import { ForwardStrategy } from './base/forward.strategy';

@Injectable()
export class BitcoinStrategy extends ForwardStrategy {
  constructor(protected readonly bitcoinService: PayInBitcoinService, payInRepo: PayInRepository) {
    super();
  }
}
