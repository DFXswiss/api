import { Injectable, NotFoundException } from '@nestjs/common';
import { BuyFiatRepository } from 'src/subdomains/core/sell-crypto/buy-fiat/buy-fiat.repository';
import { CreateFiatOutputDto } from './dto/create-fiat-output.dto';
import { FiatOutput } from './fiat-output.entity';
import { FiatOutputRepository } from './fiat-output.repository';

@Injectable()
export class FiatOutputService {
  constructor(private readonly fiatOutputRepo: FiatOutputRepository, private readonly buyFiatRepo: BuyFiatRepository) {}

  async create({ type, buyFiatId }: CreateFiatOutputDto): Promise<FiatOutput> {
    const buyFiat = await this.buyFiatRepo.findOne({ where: { id: buyFiatId } });
    if (!buyFiat) throw new NotFoundException('Buy fiat not found');

    const entity = this.fiatOutputRepo.create({ type, buyFiat });

    return await this.fiatOutputRepo.save(entity);
  }
}
