import { ethers } from 'ethers';

export class EvmUtil {
  static getRandomWallet(): ethers.Wallet {
    return ethers.Wallet.createRandom();
  }
}
