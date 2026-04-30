import { BaseAddress, Bip32PrivateKey, Credential, NetworkInfo } from '@emurgo/cardano-serialization-lib-nodejs';
import { mnemonicToEntropy } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';

/**
 * Creates a Cardano wallet from a mnemonic phrase
 * Uses CIP-1852 derivation: m/1852'/1815'/account'/role/index
 */
export class CardanoWallet {
  static createFromMnemonic(mnemonic: string, accountIndex = 0, addressIndex = 0): CardanoWallet {
    const accountKey = CardanoWallet.createAccountKey(mnemonic, accountIndex);

    const paymentKey = accountKey.derive(0).derive(addressIndex);
    const stakeKey = accountKey.derive(2).derive(0);

    const paymentPrivateKey = paymentKey.to_raw_key();
    const paymentPublicKey = paymentPrivateKey.to_public();
    const stakePublicKey = stakeKey.to_raw_key().to_public();

    const baseAddress = BaseAddress.new(
      NetworkInfo.mainnet().network_id(),
      Credential.from_keyhash(paymentPublicKey.hash()),
      Credential.from_keyhash(stakePublicKey.hash()),
    );

    const address = baseAddress.to_address().to_bech32();
    const privateKey = Buffer.from(paymentPrivateKey.as_bytes()).toString('hex');
    const publicKey = Buffer.from(paymentPublicKey.as_bytes()).toString('hex');

    return new CardanoWallet(paymentKey, privateKey, publicKey, address);
  }

  private static createAccountKey(mnemonic: string, accountIndex: number): Bip32PrivateKey {
    const entropy = mnemonicToEntropy(mnemonic, wordlist);

    return Bip32PrivateKey.from_bip39_entropy(entropy, new Uint8Array())
      .derive(CardanoWallet.harden(1852))
      .derive(CardanoWallet.harden(1815))
      .derive(CardanoWallet.harden(accountIndex));
  }

  private static harden(num: number): number {
    return 0x80000000 + num;
  }

  constructor(
    readonly paymentKey: Bip32PrivateKey,
    readonly privateKey: string,
    readonly publicKey: string,
    readonly address: string,
  ) {}
}
