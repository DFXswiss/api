import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectEntityManager, InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Wallet } from './wallet.entity';
import { WalletRepository } from 'src/wallet/wallet.repository';
import { CreateWalletDto } from 'src/wallet/dto/create-wallet.dto';

@Injectable()
export class WalletService {
    constructor(private walletRepository: WalletRepository) {}
  
  async createWallet(createWalletDto: CreateWalletDto): Promise<void>{
    this.walletRepository.createWallet(createWalletDto);
  }

  // async createWallet(user: any): Promise<string> {
  //   return '1';
  // }

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
