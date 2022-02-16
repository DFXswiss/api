import { Injectable } from '@nestjs/common';
import { WalletRepository } from 'src/user/models/wallet/wallet.repository';
import { Wallet } from './wallet.entity';

@Injectable()
export class WalletService {
  constructor(private walletRepo: WalletRepository) {}

  async getWallet(id: number): Promise<Wallet> {
    return this.walletRepo.findOne(id);
  }

  // TODO: remove?
  // private verifySignature(address: string, signature: string): boolean {
  //   const signatureMessage = Config.auth.signMessageWallet + address;
  //   return this.cryptoService.verifySignature(signatureMessage, address, signature);
  // }
}
