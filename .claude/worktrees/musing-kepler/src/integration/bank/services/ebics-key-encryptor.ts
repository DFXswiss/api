import * as crypto from 'crypto';

export class EbicsKeyEncryptor {
  private readonly algorithm = 'aes-256-cbc';
  private readonly passphrase: Buffer;
  private readonly iv: Buffer;

  constructor(passphraseHex: string, ivHex: string) {
    this.passphrase = Buffer.from(passphraseHex, 'hex');
    this.iv = Buffer.from(ivHex, 'hex');
  }

  encrypt(data: string): string {
    const cipher = crypto.createCipheriv(this.algorithm, this.passphrase, this.iv);
    const encrypted = cipher.update(data, 'utf8', 'hex') + cipher.final('hex');
    return Buffer.from(encrypted).toString('base64');
  }

  decrypt(data: string): string {
    const dataStr = Buffer.from(data, 'base64').toString();
    const decipher = crypto.createDecipheriv(this.algorithm, this.passphrase, this.iv);
    const decrypted = decipher.update(dataStr, 'hex', 'utf8') + decipher.final('utf8');
    return decrypted;
  }
}
