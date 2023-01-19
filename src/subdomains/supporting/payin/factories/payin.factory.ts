import { Injectable } from '@nestjs/common';
import { Price } from 'src/integration/exchange/dto/price.dto';
import { CryptoInput } from '../entities/crypto-input.entity';
import { PayInEntry } from '../interfaces';

@Injectable()
export class PayInFactory {
  createFromEntry(entry: PayInEntry, referencePrices: Price[]): CryptoInput {
    const { address, txId, txType, blockHeight, amount, asset } = entry;

    return CryptoInput.create(address, txId, txType, blockHeight, amount, asset, referencePrices);
  }
}
