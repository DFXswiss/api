import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectEntityManager, InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Wallet } from './wallet.entity';

@Injectable()
export class WalletService {
  constructor(
    @InjectRepository(Wallet)
    private walletRepository: Repository<Wallet>,
  ) {}
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
