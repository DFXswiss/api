import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectEntityManager } from '@nestjs/typeorm';
import { Fiat } from './fiat.entity';
import { CreateFiatDto } from 'src/fiat/dto/create-fiat.dto';
import { FiatRepository } from 'src/fiat/fiat.repository';

@Injectable()
export class FiatService {
  constructor(private fiatRepository: FiatRepository) {}
  
  async createFiat(createFiatDto: CreateFiatDto): Promise<void>{
    this.fiatRepository.createFiat(createFiatDto);
  }

  // async createFiat(user: any): Promise<string> {
  //   return '1';
  // }

  async findFiatByAddress(): Promise<string> {
    return '2';
  }

  async updateFiat(user: any): Promise<string> {
    return '3';
  }

  async findFiatByKey(key:any): Promise<string> {
    return '4';
  }
}
