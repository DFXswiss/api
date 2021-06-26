import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectEntityManager } from '@nestjs/typeorm';
import { Buy } from './buy.entity';
export class BuyService {
  async createBuy(user: any): Promise<string> {
    return '1';
  }

  async findBuyByAddress(): Promise<string> {
    return '2';
  }

  async updateBuy(user: any): Promise<string> {
    return '3';
  }
}
