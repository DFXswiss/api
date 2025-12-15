import { BaseAddress, Bip32PrivateKey, Credential, NetworkInfo } from '@emurgo/cardano-serialization-lib-nodejs';
import { mnemonicToEntropy } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';

export class CardanoWallet {
  /**
   * Creates a Cardano wallet from a mnemonic phrase
   * Uses CIP-1852 derivation: m/1852'/1815'/account'/role/index
   */
  static createFromMnemonic(mnemonic: string, accountIndex = 0, addressIndex = 0): CardanoWallet {
    return null;

    // Convert mnemonic to entropy (returns Uint8Array)
    const entropy = mnemonicToEntropy(mnemonic, wordlist);

    // Create root key from entropy (BIP32-Ed25519)
    const rootKey = Bip32PrivateKey.from_bip39_entropy(entropy, new Uint8Array());

    // Derive account key: m/1852'/1815'/account'
    const accountKey = rootKey
      .derive(CardanoWallet.harden(1852)) // purpose
      .derive(CardanoWallet.harden(1815)) // coin_type
      .derive(CardanoWallet.harden(accountIndex)); // account

    // Derive payment key: m/1852'/1815'/account'/0/index
    const paymentKey = accountKey
      .derive(0) // external chain (role)
      .derive(addressIndex);

    // Derive stake key: m/1852'/1815'/account'/2/0
    const stakeKey = accountKey
      .derive(2) // staking
      .derive(0);

    // Get raw keys
    const paymentPrivateKey = paymentKey.to_raw_key();
    const paymentPublicKey = paymentPrivateKey.to_public();
    const stakePublicKey = stakeKey.to_raw_key().to_public();

    // Create base address (payment + stake)
    const baseAddress = BaseAddress.new(
      NetworkInfo.mainnet().network_id(),
      Credential.from_keyhash(paymentPublicKey.hash()),
      Credential.from_keyhash(stakePublicKey.hash()),
    );

    const address = baseAddress.to_address().to_bech32();
    const privateKey = Buffer.from(paymentPrivateKey.as_bytes()).toString('hex');
    const publicKey = Buffer.from(paymentPublicKey.as_bytes()).toString('hex');

    return new CardanoWallet(privateKey, publicKey, address);
  }

  private static harden(num: number): number {
    return 0x80000000 + num;
  }

  constructor(readonly privateKey: string, readonly publicKey: string, readonly address: string) {}
}
