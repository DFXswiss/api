import { Injectable } from '@nestjs/common';
import { CreateSellDto } from 'src/user/models/sell/dto/create-sell.dto';
import { UpdateSellDto } from 'src/user/models/sell/dto/update-sell.dto';
import { SellRepository } from 'src/user/models/sell/sell.repository';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { UserService } from '../user/user.service';

@Injectable()
export class SellService {
  constructor(private sellRepo: SellRepository, private fiatService: FiatService, private userService: UserService) {}

  async createSell(userId: number, createSellDto: CreateSellDto): Promise<any> {
    createSellDto.user = await this.userService.getUser(userId);
    return this.sellRepo.createSell(createSellDto, this.fiatService);
  }

  async getSell(id: any, address: string): Promise<any> {
    return this.sellRepo.getSell(id, address);
  }

  async getAllSell(address: string): Promise<any> {
    return this.sellRepo.getAllSell(address);
  }

  async updateSell(updateSellDto: UpdateSellDto): Promise<any> {
    return this.sellRepo.updateSell(updateSellDto);
  }

  async count(): Promise<number> {
    return this.sellRepo.count();
  }
}
