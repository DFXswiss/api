import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectEntityManager } from '@nestjs/typeorm';
import { Sell } from './sell.entity';
export class SellService {
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
