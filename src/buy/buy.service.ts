import { Injectable } from '@nestjs/common';
import { CreateBuyDto } from 'src/buy/dto/create-buy.dto';
import { BuyRepository } from 'src/buy/buy.repository';
import { UpdateBuyDto } from './dto/update-buy.dto';

@Injectable()
export class BuyService {
  constructor(private buyRepository: BuyRepository) {}

  async createBuy(createBuyDto: CreateBuyDto): Promise<any> {
    return this.buyRepository.createBuy(createBuyDto);
  }

  async getBuy(id: any, user: any): Promise<any> {
    return this.buyRepository.getBuy(id, user);
  }

  async getAllBuy(user: any): Promise<any> {
    return this.buyRepository.getAllBuy(user);
  }

  async updateBuy(updateBuyDto: UpdateBuyDto): Promise<any> {
    return this.buyRepository.updateBuy(updateBuyDto);
  }
}
