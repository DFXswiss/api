import { Injectable } from '@nestjs/common';
import { FiatRepository } from 'src/shared/models/fiat/fiat.repository';
import { Fiat } from './fiat.entity';

@Injectable()
export class FiatService {
  constructor(private fiatRepo: FiatRepository) {}

  async getAllFiat(): Promise<Fiat[]> {
    return this.fiatRepo.find();
  }

  async getFiat(id: number): Promise<Fiat> {
    return this.fiatRepo.findOneBy({ id });
  }

  async getFiatByName(name: string): Promise<Fiat> {
    return this.fiatRepo.findOneBy({ name });
  }
}
