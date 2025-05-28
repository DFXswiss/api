import { mnemonicToSeedSync } from '@scure/bip39';
import { Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { DfxLogger } from 'src/shared/services/dfx-logger';

export const solanaDefaultPath = "m/44'/501'/0'/0'/0'";

export class SolanaWallet {
  private readonly logger = new DfxLogger(SolanaWallet);

  static create(mnemonic: string): SolanaWallet {
    const seed = mnemonicToSeedSync(mnemonic, '');
    const keypair = Keypair.fromSeed(seed.slice(0, 32));

    return new SolanaWallet(keypair);
  }

  constructor(readonly keypair: Keypair) {}

  get publicKey(): PublicKey {
    return this.keypair.publicKey;
  }

  get address(): string {
    return this.publicKey.toBase58();
  }

  signTransaction(transaction: Transaction): void {
    transaction.sign({ publicKey: this.keypair.publicKey, secretKey: this.keypair.secretKey });
  }
}
