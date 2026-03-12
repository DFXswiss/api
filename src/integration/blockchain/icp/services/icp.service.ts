import { Principal } from '@dfinity/principal';
import { Injectable } from '@nestjs/common';
import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha2';
import { HttpService } from 'src/shared/services/http.service';
import { Util } from 'src/shared/utils/util';
import nacl from 'tweetnacl';
import { SignatureException } from '../../shared/exceptions/signature.exception';
import { BlockchainService } from '../../shared/util/blockchain.service';
import { InternetComputerClient } from '../icp-client';

@Injectable()
export class InternetComputerService extends BlockchainService {
  private readonly client: InternetComputerClient;

  constructor(private readonly http: HttpService) {
    super();

    this.client = new InternetComputerClient(this.http);
  }

  getDefaultClient(): InternetComputerClient {
    return this.client;
  }

  getPaymentRequest(address: string, amount: number): string {
    return `icp:${address}?amount=${Util.numberToFixedString(amount)}`;
  }

  async verifySignature(message: string, address: string, signature: string, key?: string): Promise<boolean> {
    if (!key) throw new SignatureException('Public key is required for ICP signature verification');

    const publicKeyBytes = Buffer.from(key, 'hex');

    if (publicKeyBytes.length === 32) {
      return this.verifyEd25519(message, address, publicKeyBytes, signature);
    }

    if (publicKeyBytes.length === 33 || publicKeyBytes.length === 65) {
      return this.verifySecp256k1(message, address, publicKeyBytes, signature);
    }

    throw new SignatureException(`Unsupported ICP public key length: ${publicKeyBytes.length}`);
  }

  private verifyEd25519(message: string, address: string, publicKeyBytes: Buffer, signature: string): boolean {
    try {
      const derivedPrefix = Buffer.from('302a300506032b6570032100', 'hex');
      const derivedKey = new Uint8Array([...derivedPrefix, ...publicKeyBytes]);

      const derivedPrincipal = Principal.selfAuthenticating(derivedKey);
      if (derivedPrincipal.toText() !== address) return false;

      const messageBytes = Util.stringToUint8(message, 'utf8');
      const signatureBytes = Buffer.from(signature, 'hex');

      return nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);
    } catch {
      return false;
    }
  }

  private verifySecp256k1(message: string, address: string, publicKeyBytes: Buffer, signature: string): boolean {
    try {
      const derivedPrefix =
        publicKeyBytes.length === 33
          ? Buffer.from('3036301006072a8648ce3d020106052b8104000a032200', 'hex')
          : Buffer.from('3056301006072a8648ce3d020106052b8104000a034200', 'hex');
      const derivedKey = new Uint8Array([...derivedPrefix, ...publicKeyBytes]);

      const derivedPrincipal = Principal.selfAuthenticating(derivedKey);
      if (derivedPrincipal.toText() !== address) return false;

      const messageBytes = Util.stringToUint8(message, 'utf8');
      const messageHash = sha256(messageBytes);
      const signatureBytes = Buffer.from(signature, 'hex');

      return secp256k1.verify(signatureBytes, messageHash, publicKeyBytes, { lowS: false });
    } catch {
      return false;
    }
  }
}
