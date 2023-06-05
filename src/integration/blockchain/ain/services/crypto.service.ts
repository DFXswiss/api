import { Injectable } from '@nestjs/common';
import { verify } from 'bitcoinjs-message';
import { MainNet } from '@defichain/jellyfish-network';
import { isEthereumAddress } from 'class-validator';
import { verifyMessage } from 'ethers/lib/utils';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import verifyCardanoSignature from '@cardano-foundation/cardano-verify-datasignature';

@Injectable()
export class CryptoService {
  private readonly defaultEthereumChain = Blockchain.ARBITRUM;
  private readonly EthereumBasedChains = [
    Blockchain.ETHEREUM,
    Blockchain.BINANCE_SMART_CHAIN,
    Blockchain.ARBITRUM,
    Blockchain.OPTIMISM,
    Blockchain.POLYGON,
  ];

  // --- ADDRESSES --- //
  public getBlockchainsBasedOn(address: string): Blockchain[] {
    if (isEthereumAddress(address)) return this.EthereumBasedChains;
    if (this.isBitcoinAddress(address)) return [Blockchain.BITCOIN];
    if (this.isLightningAddress(address)) return [Blockchain.LIGHTNING];
    if (CryptoService.isCardanoAddress(address)) return [Blockchain.CARDANO];
    return [Blockchain.DEFICHAIN];
  }

  public getDefaultBlockchainBasedOn(address: string): Blockchain {
    const chains = this.getBlockchainsBasedOn(address);
    return chains.includes(this.defaultEthereumChain)
      ? this.defaultEthereumChain
      : this.getBlockchainsBasedOn(address)[0];
  }

  private isBitcoinAddress(address: string): boolean {
    return /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,39}$/.test(address);
  }

  private isLightningAddress(address: string): boolean {
    return /^(LNURL[A-Z0-9]{25,250})$/.test(address);
  }

  public static isCardanoAddress(address: string): boolean {
    return /^stake([a-z0-9]{54})$/.test(address);
  }

  // --- SIGNATURE VERIFICATION --- //
  public verifySignature(message: string, address: string, signature: string, key?: string): boolean {
    const blockchain = this.getDefaultBlockchainBasedOn(address);

    try {
      if (this.EthereumBasedChains.includes(blockchain)) return this.verifyEthereumBased(message, address, signature);
      if (blockchain === Blockchain.BITCOIN) return this.verifyBitcoinBased(message, address, signature, null);
      if (blockchain === Blockchain.LIGHTNING) return this.verifyLightningBased(message, address, signature, null);
      if (blockchain === Blockchain.DEFICHAIN)
        return this.verifyBitcoinBased(message, address, signature, MainNet.messagePrefix);
      if (blockchain === Blockchain.CARDANO) return this.verifyCardano(message, address, signature, key);
    } catch {}

    return false;
  }

  private verifyEthereumBased(message: string, address: string, signature: string): boolean {
    // there are signatures out there, which do not have '0x' in the beginning, but for verification this is needed
    const signatureToUse = signature.startsWith('0x') ? signature : '0x' + signature;
    return verifyMessage(message, signatureToUse) === address;
  }

  private verifyBitcoinBased(message: string, address: string, signature: string, prefix: string | null): boolean {
    let isValid = false;
    try {
      isValid = verify(message, address, signature, prefix, true);
    } catch {}

    if (!isValid) isValid = verify(message, address, signature, prefix);

    return isValid;
  }

  private verifyLightningBased(
    _message: string,
    _address: string,
    _signature: string,
    _prefix: string | null,
  ): boolean {
    // TODO: correctly validate lightning signatures
    return true;
  }

  private verifyCardano(message: string, address: string, signature: string, key?: string): boolean {
    return verifyCardanoSignature(signature, key, message, address);
  }
}
