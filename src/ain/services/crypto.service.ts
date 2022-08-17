import { Injectable } from '@nestjs/common';
import { verify } from 'bitcoinjs-message';
import { MainNet } from '@defichain/jellyfish-network';
import { isEthereumAddress } from 'class-validator';
import { verifyMessage } from 'ethers/lib/utils';
import { Blockchain } from '../node/node.service';

@Injectable()
export class CryptoService {
  public verifySignature(message: string, address: string, signature: string, blockchain: Blockchain): boolean {
    let isValid = false;
    try {
      isValid = this.verify(message, address, signature, blockchain);
    } catch (e) {}

    if (!isValid) {
      isValid = this.fallbackVerify(message, address, signature);
    }
    return isValid;
  }

  public getBlockchainBasedOn(address: string): Blockchain {
    if (isEthereumAddress(address)) return Blockchain.ETHEREUM;
    if (this.isBitcoinAddress(address)) return Blockchain.BITCOIN;
    return Blockchain.DEFICHAIN;
  }

  private isBitcoinAddress(address: string): boolean {
    return address.match(/^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,39}$/)?.length > 1 ?? false;
  }

  private fallbackVerify(message: string, address: string, signature: string) {
    let isValid = false;
    const flags = [...Array(12).keys()].map((i) => i + 31);
    for (const flag of flags) {
      const flagByte = Buffer.alloc(1);
      flagByte.writeInt8(flag);
      let sigBuffer = Buffer.from(signature, 'base64').slice(1);
      sigBuffer = Buffer.concat([flagByte, sigBuffer]);
      const candidateSig = sigBuffer.toString('base64');
      try {
        isValid = this.verify(message, address, candidateSig, Blockchain.DEFICHAIN);
        if (isValid) break;
      } catch (e) {}
    }
    return isValid;
  }

  private verify(message: string, address: string, signature: string, blockchain: Blockchain): boolean {
    switch (blockchain) {
      case Blockchain.ETHEREUM:
        return this.verifyEthereum(message, address, signature);
      case Blockchain.BITCOIN:
        return this.verifyBitcoin(message, address, signature);
      default:
        return this.verifyDefichain(message, address, signature);
    }
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
