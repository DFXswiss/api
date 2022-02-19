import { Injectable } from '@nestjs/common';
import { WalletRepository } from 'src/user/models/wallet/wallet.repository';
import { Wallet } from './wallet.entity';

@Injectable()
export class WalletService {
  constructor(private walletRepo: WalletRepository) {}

  async getWalletOrDefault(id: number): Promise<Wallet> {
    return (await this.walletRepo.findOne(id)) ?? (await this.walletRepo.findOne(1));
  }

  // TODO: remove?
  // private verifySignature(address: string, signature: string): boolean {
  //   const signatureMessage = Config.auth.signMessageWallet + address;
  //   return this.cryptoService.verifySignature(signatureMessage, address, signature);
  // }
}
