import { Injectable } from '@nestjs/common';
import Arweave from 'arweave';
import { Util } from 'src/shared/utils/util';

@Injectable()
export class ArweaveService {
  async verifySignature(message: string, signature: string, key: string): Promise<boolean> {
    const messageHash = Util.createHash(message);

    return Arweave.crypto.verify(
      key,
      Util.stringToUint8(messageHash, 'hex'),
      Util.stringToUint8(signature, 'base64url'),
    );
  }
}
