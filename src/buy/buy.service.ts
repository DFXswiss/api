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
import { UpdateBuyDto } from './dto/update-buy.dto';

@Injectable()
export class BuyService {
  constructor(private buyRepository: BuyRepository) {}
  
  async createBuy(createBuyDto: CreateBuyDto): Promise<void>{
    this.buyRepository.createBuy(createBuyDto);
  }

  async getBuy(getBuyDto: GetBuyDto): Promise<Buy> {
    return this.buyRepository.getBuy(getBuyDto);
  }

  async getAllBuy(address: string): Promise<Buy> {
    return this.buyRepository.getAllBuy(address);
  }

  async updateBuy(updateBuyDto: UpdateBuyDto): Promise<string> {
    return this.buyRepository.updateBuy(updateBuyDto);
  }
}
