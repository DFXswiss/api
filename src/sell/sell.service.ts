import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectEntityManager, InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Sell } from './sell.entity';

@Injectable()
export class SellService {
  constructor(
    @InjectRepository(Sell)
    private sellRepository: Repository<Sell>,
  ) {}
  async createSell(user: any): Promise<string> {
    return '1';
  }

  async findSellByAddress(): Promise<string> {
    return '2';
  }

  async updateSell(user: any): Promise<string> {
    return '3';
  }
}
