import { BadRequestException, Injectable } from '@nestjs/common';
import { WalletRepository } from 'src/wallet/wallet.repository';
import { CreateWalletDto } from 'src/wallet/dto/create-wallet.dto';
import { UpdateWalletDto } from './dto/update-wallet.dto';
import { DeFiService } from 'src/services/defi.service';

@Injectable()
export class WalletService {
  constructor(private walletRepository: WalletRepository, private deFiService: DeFiService) {}

  async createWallet(createWalletDto: CreateWalletDto): Promise<any> {
    if (!this.verifySignature(createWalletDto.address, createWalletDto.signature)) {
      throw new BadRequestException('Wrong signature');
    }

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

  private verifySignature(address: string, signature: string): boolean {
    const signatureMessage = process.env.SIGN_MESSAGE_WALLET + address;
    return this.deFiService.verifySignature(signatureMessage, address, signature);
  }
}
