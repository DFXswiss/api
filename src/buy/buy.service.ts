import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectEntityManager, InjectRepository } from '@nestjs/typeorm';
import { User } from 'src/user/user.entity';
import { Repository } from 'typeorm';
import { Buy } from './buy.entity';
import { CreateBuyDto } from 'src/buy/dto/create-buy.dto';
import { BuyRepository } from 'src/buy/buy.repository';
import { GetBuyDto } from './dto/get-buy.dto';

@Injectable()
export class BuyService {
  constructor(private buyRepository: BuyRepository) {}
  
  async createBuy(createBuyDto: CreateBuyDto): Promise<void>{
    this.buyRepository.createBuy(createBuyDto);
  }

  async getBuy(getBuyDto: GetBuyDto): Promise<Buy> {
    return this.buyRepository.findOne({"id": getBuyDto.id});
  }

  async updateBuy(user: any): Promise<string> {
    return '3';
  }
}
