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
import { UpdateBuyDto } from './dto/update-buy.dto';

@Injectable()
export class BuyService {
  constructor(private buyRepository: BuyRepository) {}
  
  async createBuy(createBuyDto: CreateBuyDto): Promise<any>{
    return this.buyRepository.createBuy(createBuyDto);
  }

  async getBuy(key: any,address: string): Promise<any> {
    return this.buyRepository.getBuy(key,address);
  }

  async getAllBuy(address: string): Promise<any> {
    return this.buyRepository.getAllBuy(address);
  }

  async updateBuy(updateBuyDto: UpdateBuyDto): Promise<any> {
    return this.buyRepository.updateBuy(updateBuyDto);
  }
}
