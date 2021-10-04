import { Injectable } from '@nestjs/common';
import { CreateFiatDto } from 'src/shared/models/fiat/dto/create-fiat.dto';
import { UpdateFiatDto } from './dto/update-fiat.dto';
import { FiatRepository } from 'src/shared/models/fiat/fiat.repository';

@Injectable()
export class FiatService {
  constructor(private fiatRepository: FiatRepository) {}

  async createFiat(createFiatDto: CreateFiatDto): Promise<any> {
    return this.fiatRepository.createFiat(createFiatDto);
  }

  async getAllFiat(): Promise<any> {
    return this.fiatRepository.getAllFiat();
  }

  async updateFiat(fiat: UpdateFiatDto): Promise<any> {
    return this.fiatRepository.updateFiat(fiat);
  }

  async getFiat(key: any): Promise<any> {
    return this.fiatRepository.getFiat(key);
  }
}
