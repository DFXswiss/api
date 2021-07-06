import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectEntityManager, InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Sell } from './sell.entity';
import { CreateSellDto } from 'src/sell/dto/create-sell.dto';
import { SellRepository } from 'src/sell/sell.repository';

@Injectable()
export class SellService {
  constructor(private sellRepository: SellRepository) {}
  
  async createSell(createSellDto: CreateSellDto): Promise<void>{
    this.sellRepository.createSell(createSellDto);
  }
  
  // async createSell(user: any): Promise<string> {
  //   return '1';
  // }

  async findSellByAddress(): Promise<string> {
    return '2';
  }

  async updateSell(user: any): Promise<string> {
    return '3';
  }
}
