import { Injectable } from '@nestjs/common';
import { CreateSellDto } from 'src/sell/dto/create-sell.dto';
import { UpdateSellDto } from 'src/sell/dto/update-sell.dto';
import { SellRepository } from 'src/sell/sell.repository';

@Injectable()
export class SellService {
  constructor(private sellRepository: SellRepository) {}

  async createSell(createBuyDto: CreateSellDto): Promise<any> {
    return this.sellRepository.createSell(createBuyDto);
  }

  async getSell(id: any, address: string): Promise<any> {
    return this.sellRepository.getSell(id, address);
  }

  async getAllSell(address: string): Promise<any> {
    return this.sellRepository.getAllSell(address);
  }

  async updateSell(updateSellDto: UpdateSellDto): Promise<any> {
    return this.sellRepository.updateSell(updateSellDto);
  }
}
