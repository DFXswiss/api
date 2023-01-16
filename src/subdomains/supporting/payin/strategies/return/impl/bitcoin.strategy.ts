import { Injectable } from '@nestjs/common';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInBitcoinService } from '../../../services/payin-bitcoin.service';
import { ReturnStrategy } from './base/return.strategy';

@Injectable()
export class BitcoinStrategy extends ReturnStrategy {
  constructor(protected readonly bitcoinService: PayInBitcoinService, payInRepo: PayInRepository) {
    super();
  }
}
