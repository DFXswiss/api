import { Injectable } from '@nestjs/common';
import { WalletRepository } from 'src/wallet/wallet.repository';
import { CreateWalletDto } from 'src/wallet/dto/create-wallet.dto';
import { UpdateWalletDto } from './dto/update-wallet.dto';

@Injectable()
export class WalletService {
  constructor(private walletRepository: WalletRepository) {}

  async createWallet(createWalletDto: CreateWalletDto): Promise<any> {
    return this.walletRepository.createWallet(createWalletDto);
  }

  async getWallet(wallet: any): Promise<any> {
    return this.walletRepository.getWallet(wallet);
  }

  async getAllWallet(): Promise<any> {
    return this.walletRepository.getAllWallet();
  }

  async updateWallet(updatewalletDto: UpdateWalletDto): Promise<any> {
    return this.walletRepository.updateWallet(updatewalletDto);
  }
}
