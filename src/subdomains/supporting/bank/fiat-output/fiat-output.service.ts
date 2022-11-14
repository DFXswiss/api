import { Injectable } from '@nestjs/common';
import { CreateFiatOutputDto } from './dto/create-fiat-output.dto';
import { FiatOutput } from './fiat-output.entity';
import { FiatOutputRepository } from './fiat-output.repository';

@Injectable()
export class FiatOutputService {
  constructor(private readonly fiatOutputRepo: FiatOutputRepository) {}

  async create(createBuyFiatDto?: CreateFiatOutputDto): Promise<FiatOutput> {
    const entity = this.fiatOutputRepo.create(createBuyFiatDto);

    return await this.fiatOutputRepo.save(entity);
  }
}
