import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateBuyDto } from 'src/buy/dto/create-buy.dto';
import { BuyRepository } from 'src/buy/buy.repository';
import { UpdateBuyDto } from './dto/update-buy.dto';
import { Buy } from './buy.entity';

@Injectable()
export class BuyService {
  constructor(private buyRepo: BuyRepository) {}

  async createBuy(createBuyDto: CreateBuyDto): Promise<Buy> {
    return this.buyRepo.createBuy(createBuyDto);
  }

  async getBuy(id: number, userId: number): Promise<Buy> {
    const buy = await this.buyRepo.findOne({ where: { id, user: { id: userId} } });

    if (!buy) throw new NotFoundException('No matching buy route for id found');

    return buy;
  }

  async getAllBuy(userId: number): Promise<Buy[]> {
    return this.buyRepo.find({ user: { id: userId } });
  }

  async updateBuy(updateBuyDto: UpdateBuyDto): Promise<Buy> {
    return this.buyRepo.updateBuy(updateBuyDto);
  }
}
