import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectEntityManager } from '@nestjs/typeorm';
import { Wallet } from './wallet.entity';
export class WalletService {
  async createWallet(user: any): Promise<string> {
    return '1';
  }

  async findWalletByAddress(): Promise<string> {
    return '2';
  }

  async updateWallet(user: any): Promise<string> {
    return '3';
  }

  async findWalletByKey(key:any): Promise<string> {
    return '4';
  }
}
