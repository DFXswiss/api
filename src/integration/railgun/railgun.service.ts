import { Injectable } from '@nestjs/common';
import { RailgunEngine, verifyED25519 } from '@railgun-community/engine';
import { toUtf8Bytes } from 'ethers/lib/utils';

@Injectable()
export class RailgunService {
  async verifySignature(message: string, address: string, signature: string): Promise<boolean> {
    const messageBytes = toUtf8Bytes(message);
    const { viewingPublicKey } = RailgunEngine.decodeAddress(address);
    const signatureBytes = new Uint8Array(Buffer.from(signature, 'hex'));
    return verifyED25519(messageBytes, viewingPublicKey, signatureBytes);
  }
}
