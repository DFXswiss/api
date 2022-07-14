import { Injectable } from '@nestjs/common';
import { BuyFiat } from './buy-fiat.entity';
import { BuyFiatRepository } from './buy-fiat.repository';
import { CryptoInput } from '../crypto-input/crypto-input.entity';
import { Sell } from '../sell/sell.entity';

@Injectable()
export class BuyFiatService {
  // TODO: copy logic from CryptoSellService:
  // - Update sell volumes
  // - Activate user (move to user.service)
  // - Methods for history and statistic service

  constructor(private readonly buyFiatRepo: BuyFiatRepository) {}

  async create(cryptoInput: CryptoInput): Promise<BuyFiat> {
    const entity = this.buyFiatRepo.create();

    entity.cryptoInput = cryptoInput;
    entity.sell = cryptoInput.route as Sell;

    return await this.buyFiatRepo.save(entity);
  }
}
