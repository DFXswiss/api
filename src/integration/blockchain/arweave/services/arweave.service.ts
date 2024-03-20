import { Injectable } from '@nestjs/common';
import Arweave from 'arweave';
import { Util } from 'src/shared/utils/util';

@Injectable()
export class ArweaveService {
  async verifySignature(message: string, signature: string, key: string): Promise<boolean> {
    return Arweave.crypto.verify(key, Util.stringToUint8(message, 'hex'), Util.stringToUint8(signature, 'hex'));
  }
}
