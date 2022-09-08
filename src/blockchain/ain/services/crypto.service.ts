import { Injectable } from '@nestjs/common';
import { verify } from 'bitcoinjs-message';
import { MainNet } from '@defichain/jellyfish-network';
import { isEthereumAddress } from 'class-validator';
import { verifyMessage } from 'ethers/lib/utils';
import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';
import { Config } from 'src/config/config';

@Injectable()
export class CryptoService {
  public verifySignature(message: string, address: string, signature: string): boolean {
    const blockchains = this.getBlockchainsBasedOn(address);
    const defichainFallbackMessage = Config.auth.signMessage + address;

    let isValid = false;
    try {
      isValid = this.verify(message, address, signature, blockchains);

      if (!isValid && blockchains.includes(Blockchain.DEFICHAIN)) {
        isValid = this.verify(defichainFallbackMessage, address, signature, blockchains);
      }
    } catch (e) {}

    if (!isValid && !blockchains.includes(Blockchain.ETHEREUM)) {
      isValid = this.fallbackVerify(message, address, signature, blockchains);

      if (!isValid && blockchains.includes(Blockchain.DEFICHAIN)) {
        isValid = this.fallbackVerify(defichainFallbackMessage, address, signature, blockchains);
      }
    }
    return isValid;
  }

  public getBlockchainsBasedOn(address: string): Blockchain[] {
    if (isEthereumAddress(address)) return [Blockchain.ETHEREUM, Blockchain.BINANCE_SMART_CHAIN];
    if (this.isBitcoinAddress(address)) return [Blockchain.BITCOIN];
    return [Blockchain.DEFICHAIN];
  }

  private isBitcoinAddress(address: string): boolean {
    return address.match(/^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,39}$/)?.length > 1 ?? false;
  }

  private fallbackVerify(message: string, address: string, signature: string, blockchains: Blockchain[]) {
    let isValid = false;
    const flags = [...Array(12).keys()].map((i) => i + 31);
    for (const flag of flags) {
      const flagByte = Buffer.alloc(1);
      flagByte.writeInt8(flag);
      let sigBuffer = Buffer.from(signature, 'base64').slice(1);
      sigBuffer = Buffer.concat([flagByte, sigBuffer]);
      const candidateSig = sigBuffer.toString('base64');
      try {
        isValid = this.verify(message, address, candidateSig, blockchains);
        if (isValid) break;
      } catch (e) {}
    }
    return isValid;
  }

  private verify(message: string, address: string, signature: string, blockchains: Blockchain[]): boolean {
    if (blockchains.includes(Blockchain.ETHEREUM)) return this.verifyEthereum(message, address, signature);
    if (blockchains.includes(Blockchain.BITCOIN)) return this.verifyBitcoin(message, address, signature);
    return this.verifyDefichain(message, address, signature);
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
