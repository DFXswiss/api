# DFX API

API for DFX.swiss crypto exchange

## Authentication
The following code snippet shows a way to generate login credentials.
```ts
import { MainNet, Network } from "@defichain/jellyfish-network";
import { JellyfishWallet } from "@defichain/jellyfish-wallet";
import { Bip32Options, MnemonicHdNodeProvider } from "@defichain/jellyfish-wallet-mnemonic";
import { WhaleWalletAccountProvider } from "@defichain/whale-api-wallet";
import { sign } from "bitcoinjs-message";

export class DfxLoginHelper {
  private readonly network = MainNet;
  private readonly seed = [ /* PUT YOUR SEED HERE */ ]; // 24 word mnemonic seed phrase

  async generateCredentials(uniqueUserId: number): Promise<{ address: string; signature: string }> {
    const { address, privateKey } = await this.getAccount(uniqueUserId);

    const signMessage = await this.getSignMessage(address);
    const signature = this.signMessage(signMessage, privateKey);

    return { address, signature };
  }

  // --- HELPER METHODS --- //
  private async getAccount(id: number): Promise<{ address: string; privateKey: Buffer }> {
    const wallet = new JellyfishWallet(
      MnemonicHdNodeProvider.fromWords(this.seed, this.bip32OptionsBasedOn(this.network)),
      new WhaleWalletAccountProvider(undefined, this.network),
      JellyfishWallet.COIN_TYPE_DFI,
      JellyfishWallet.PURPOSE_LIGHT_WALLET
    );

    return {
      address: await wallet.get(id).getAddress(),
      privateKey: await wallet.get(id).privateKey(),
    };
  }

  private bip32OptionsBasedOn(network: Network): Bip32Options {
    return {
      bip32: {
        public: network.bip32.publicPrefix,
        private: network.bip32.privatePrefix,
      },
      wif: network.wifPrefix,
    };
  }

  private async getSignMessage(address: string): Promise<string> {
    // GET DFX SIGN MESSAGE WITH API CALL
    return 'TODO';
  }

  private signMessage(message: string, privateKey: Buffer): string {
    return sign(message, privateKey, true, this.network.messagePrefix).toString("base64");
  }
}
```