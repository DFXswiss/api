import { Injectable } from '@nestjs/common';
import { verify } from 'bitcoinjs-message';
import { MainNet } from '@defichain/jellyfish-network';
import { isEthereumAddress } from 'class-validator';
import { verifyMessage } from 'ethers/lib/utils';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';

@Injectable()
export class CryptoService {
  private readonly EthereumBasedChains = [Blockchain.ETHEREUM, Blockchain.BINANCE_SMART_CHAIN];
  private readonly BitcoinBasedChains = [Blockchain.BITCOIN, Blockchain.DEFICHAIN];

  // --- ADDRESSES --- //
  public getBlockchainsBasedOn(address: string): Blockchain {
    if (isEthereumAddress(address)) return Blockchain.ETHEREUM;
    if (this.isBitcoinAddress(address)) return Blockchain.BITCOIN;
    return Blockchain.DEFICHAIN;
  }

  private isBitcoinAddress(address: string): boolean {
    return address.match(/^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,39}$/)?.length > 1 ?? false;
  }

  // --- SIGNATURE VERIFICATION --- //
  public verifySignature(address: string, signature: string, message: string, fallbackMessage?: string): boolean {
    const blockchain = this.getBlockchainsBasedOn(address);

    let isValid = this.doVerify(blockchain, address, signature, message);

    if (!isValid && fallbackMessage) {
      isValid = this.doVerify(blockchain, address, signature, fallbackMessage);
    }

    return isValid;
  }

  private doVerify(blockchain: Blockchain, address: string, signature: string, message: string): boolean {
    let isValid = this.verify(message, address, signature, blockchain);

    if (!isValid && this.BitcoinBasedChains.includes(blockchain)) {
      isValid = this.fallbackVerify(message, address, signature, blockchain);
    }

    return isValid;
  }

  private verify(message: string, address: string, signature: string, blockchain: Blockchain): boolean {
    try {
      if (this.EthereumBasedChains.includes(blockchain)) return this.verifyEthereum(message, address, signature);
      if (blockchain === Blockchain.BITCOIN) return this.verifyBitcoin(message, address, signature);
      if (blockchain === Blockchain.DEFICHAIN) return this.verifyDefichain(message, address, signature);
    } catch {
      return false;
    }
  }

  private fallbackVerify(message: string, address: string, signature: string, blockchain: Blockchain): boolean {
    let isValid = false;

    const flags = [...Array(12).keys()].map((i) => i + 31);
    for (const flag of flags) {
      const flagByte = Buffer.alloc(1);
      flagByte.writeInt8(flag);
      let sigBuffer = Buffer.from(signature, 'base64').slice(1);
      sigBuffer = Buffer.concat([flagByte, sigBuffer]);
      const candidateSig = sigBuffer.toString('base64');

      isValid = this.verify(message, address, candidateSig, blockchain);
      if (isValid) break;
    }

    return isValid;
  }

  private verifyEthereum(message: string, address: string, signature: string): boolean {
    // there are ETH signings out there, which do not have '0x' in the beginning, but for verification this is needed
    const signatureToUse = signature.startsWith('0x') ? signature : '0x' + signature;
    return verifyMessage(message, signatureToUse) === address;
  }

  private verifyBitcoin(message: string, address: string, signature: string): boolean {
    try {
      return verify(message, address, signature, null, true);
    } catch (e) {
      if (e.message === 'checkSegwitAlways can only be used with a compressed pubkey signature flagbyte') {
        // If message created with uncompressed private key, it will throw this error
        // in this case we should re-try with checkSegwitAlways flag off
        // node_modules/bitcoinjs-message/index.js:187
        return verify(message, address, signature);
      }
      throw e;
    }
  }

  private verifyDefichain(message: string, address: string, signature: string): boolean {
    return verify(message, address, signature, MainNet.messagePrefix);
  }
}
