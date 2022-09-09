import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { UpdateFiatOutputDto } from './dto/update-fiat-output.dto';
import { FiatOutput } from './fiat-output.entity';
import { FiatOutputRepository } from './fiat-output.repository';

@Injectable()
export class FiatOutputService {
  constructor(private fiatOutputRepo: FiatOutputRepository) {}

  async create(fiatOutput: Partial<FiatOutput>): Promise<Partial<FiatOutput>> {
    let entity = await this.fiatOutputRepo.findOne({ accountServiceRef: fiatOutput.accountServiceRef });
    if (entity)
      throw new ConflictException(
        `There is already a fiat output with the accountServiceRef: ${fiatOutput.accountServiceRef}`,
      );

    entity = await this.fiatOutputRepo.create(fiatOutput);
    return await this.fiatOutputRepo.save(entity);
  }

  async update(fiatOutputId: number, dto: UpdateFiatOutputDto): Promise<FiatOutput> {
    const fiatOutput = await this.fiatOutputRepo.findOne(fiatOutputId);
    if (!fiatOutput) throw new NotFoundException('FiatOutput not found');

    return await this.fiatOutputRepo.save(fiatOutput);
  }
}
