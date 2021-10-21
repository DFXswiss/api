import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateBuyDto } from 'src/user/models/buy/dto/create-buy.dto';
import { BuyRepository } from 'src/user/models/buy/buy.repository';
import { UpdateBuyDto } from './dto/update-buy.dto';
import { Buy } from './buy.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { UserService } from '../user/user.service';

@Injectable()
export class BuyService {
  constructor(private buyRepo: BuyRepository, private assetService: AssetService, private userService: UserService) {}

  async createBuy(userId: number, createBuyDto: CreateBuyDto): Promise<Buy> {
    createBuyDto.user = await this.userService.getUser(userId);
    return this.buyRepo.createBuy(createBuyDto, this.assetService);
  }

  async getBuy(id: number, userId: number): Promise<Buy> {
    const buy = await this.buyRepo.findOne({ where: { id, user: { id: userId } } });

    if (!buy) throw new NotFoundException('No matching buy route for id found');

    return buy;
  }

  async getAllBuy(userId: number): Promise<Buy[]> {
    return this.buyRepo.find({ user: { id: userId } });
  }

  async updateBuy(userId: number, updateBuyDto: UpdateBuyDto): Promise<Buy> {
    updateBuyDto.address = (await this.userService.getUser(userId)).address;
    return this.buyRepo.updateBuy(updateBuyDto);
  }

  async count(): Promise<number> {
    return this.buyRepo.count();
  }
}
