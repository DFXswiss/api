import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { FiatRepository } from 'src/shared/models/fiat/fiat.repository';
import { isString } from 'util';
import { Fiat } from './fiat.entity';

@Injectable()
export class FiatService {
  constructor(private fiatRepo: FiatRepository) {}

  async getAllFiat(): Promise<Fiat[]> {
    return this.fiatRepo.find();
  }

  async getFiat(id: number): Promise<Fiat> {
    return this.fiatRepo.findOne(id);
  }

  async getFiatByName(name: string): Promise<Fiat> {
    return this.fiatRepo.findOne({ name });
  }

  // TODO: remove
  async getFiatOld(key: any): Promise<Fiat> {
    if (key.key) {
      if (!isNaN(key.key)) {
        const fiat = await this.fiatRepo.findOne({ id: key.key });

        if (fiat) return fiat;

        throw new NotFoundException('No matching fiat found');
      } else if (isString(key.key)) {
        const fiat = await this.fiatRepo.findOne({ name: key.key });

        if (fiat) return fiat;

        throw new NotFoundException('No matching fiat found');
      }
    } else if (!isNaN(key)) {
      const fiat = await this.fiatRepo.findOne({ id: key });

      if (fiat) return fiat;

      throw new NotFoundException('No matching fiat found');
    } else if (isString(key)) {
      const fiat = await this.fiatRepo.findOne({ name: key });

      if (fiat) return fiat;

      throw new NotFoundException('No matching fiat found');
    } else if (key.id) {
      const fiat = await this.fiatRepo.findOne({ id: key.id });

      if (fiat) return fiat;

      throw new NotFoundException('No matching fiat found');
    } else if (key.name) {
      const fiat = await this.fiatRepo.findOne({ name: key.name });

      if (fiat) return fiat;

      throw new NotFoundException('No matching fiat found');
    }

    throw new BadRequestException('key must be number or string or JSON-Object');
  }
}
