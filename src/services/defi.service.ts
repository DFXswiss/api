import { Injectable } from '@nestjs/common';
import { verify } from 'bitcoinjs-message';
import { MainNet } from '@defichain/jellyfish-network'

@Injectable()
export class DeFiService {
  public verifySignature(
    message: string,
    address: string,
    signature: string,
  ): boolean {
    let isValid = false;
    try {
      isValid = this.verify(message, address, signature);
    } catch (e) {}

    if (!isValid) {
      isValid = this.fallbackVerify(message, address, signature);
    }
    return isValid;
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
        isValid = this.verify(message, address, candidateSig);
        if (isValid) break;
      } catch (e) {}
    }
    return isValid;
  }

  private verify(
    message: string,
    address: string,
    signature: string,
  ): boolean {
    return verify(
      message,
      address,
      signature,
      MainNet.messagePrefix,
    );
  }
}
