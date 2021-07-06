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


@Injectable()
export class BuyService {
  constructor(private buyRepository: BuyRepository) {}
  
  async createBuy(createBuyDto: CreateBuyDto): Promise<void>{
    this.buyRepository.createBuy(createBuyDto);
  }
  
  // async createBuy(user: any): Promise<string> {
  //   return '1';
  // }

  async getBuy(): Promise<Buy> {
    return this.buyRepository.findOne({"id": "8FhuD5a5qWYk5mtQnfMP7gF5oTaKMkMQQ1:0"});
  }

  async updateBuy(user: any): Promise<string> {
    return '3';
  }
}
