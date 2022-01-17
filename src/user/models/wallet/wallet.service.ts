import { BadRequestException, Injectable } from '@nestjs/common';
import { WalletRepository } from 'src/user/models/wallet/wallet.repository';
import { CreateWalletDto } from 'src/user/models/wallet/dto/create-wallet.dto';
import { UpdateWalletDto } from './dto/update-wallet.dto';
import { CryptoService } from 'src/ain/services/crypto.service';
import { Config } from 'src/config/config';

@Injectable()
export class WalletService {
  constructor(private walletRepository: WalletRepository, private cryptoService: CryptoService) {}

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

  async updateWallet(updateWalletDto: UpdateWalletDto): Promise<any> {
    return this.walletRepository.updateWallet(updateWalletDto);
  }

  private verifySignature(address: string, signature: string): boolean {
    const signatureMessage = Config.auth.signMessageWallet + address;
    return this.cryptoService.verifySignature(signatureMessage, address, signature);
  }
}
