import { Injectable } from '@nestjs/common';
import { verify } from 'bitcoinjs-message';
import { MainNet } from '@defichain/jellyfish-network';
import { isEthereumAddress } from 'class-validator';
import { verifyMessage } from 'ethers/lib/utils';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';

@Injectable()
export class CryptoService {
  private readonly EthereumBasedChains = [Blockchain.ETHEREUM, Blockchain.BINANCE_SMART_CHAIN];

  // --- ADDRESSES --- //
  public getBlockchainsBasedOn(address: string): Blockchain[] {
    if (isEthereumAddress(address)) return [Blockchain.ETHEREUM, Blockchain.BINANCE_SMART_CHAIN];
    if (this.isBitcoinAddress(address)) return [Blockchain.BITCOIN];
    return [Blockchain.DEFICHAIN];
  }

  public getDefaultBlockchainBasedOn(address: string): Blockchain {
    return this.getBlockchainsBasedOn(address)[0];
  }

  private isBitcoinAddress(address: string): boolean {
    return address.match(/^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,39}$/)?.length > 1 ?? false;
  }

  // --- SIGNATURE VERIFICATION --- //
  public verifySignature(address: string, signature: string, message: string, fallbackMessage?: string): boolean {
    const blockchain = this.getDefaultBlockchainBasedOn(address);

    let isValid = this.verify(blockchain, address, signature, message);

    if (!isValid && fallbackMessage) {
      isValid = this.verify(blockchain, address, signature, fallbackMessage);
    }

    return isValid;
  }

  private verify(blockchain: Blockchain, address: string, signature: string, message: string): boolean {
    try {
      if (this.EthereumBasedChains.includes(blockchain)) return this.verifyEthereumBased(address, signature, message);
      if (blockchain === Blockchain.BITCOIN) return this.verifyBitcoinBased(address, signature, message, null);
      if (blockchain === Blockchain.DEFICHAIN)
        return this.verifyBitcoinBased(address, signature, message, MainNet.messagePrefix);
    } catch {
      return false;
    }
  }

  private verifyEthereumBased(address: string, signature: string, message: string): boolean {
    // there are addresses out there, which do not have '0x' in the beginning, but for verification this is needed
    const signatureToUse = signature.startsWith('0x') ? signature : '0x' + signature;
    return verifyMessage(message, signatureToUse) === address;
  }

  private verifyBitcoinBased(address: string, signature: string, message: string, prefix: string | null): boolean {
    let isValid = false;
    try {
      isValid = verify(message, address, signature, prefix, true);
    } catch {}

    if (!isValid) isValid = verify(message, address, signature, prefix);

    return isValid;
  }
}
