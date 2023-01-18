# DFX API

API for DFX.swiss crypto exchange

## Documentation

- [Registration](#registration)
- [KYC](#kyc-optional)
- [Transactions](#transactions)
  - [Buy Crypto](#buy-crypto)
  - [Sell Crypto](#sell-crypto)
  - [Bank Accounts](#bank-accounts-optional)
- [Integration Example](#integration-example)

### Registration

1. Contact [support](mailto:support@dfx.swiss) to register your wallet name
2. Create an address on selected blockchain (e.g. DeFiChain), see [example](#login-example) below
3. Get the sign message from [sign-message endpoint](https://api.dfx.swiss/swagger/#/auth/AuthController_getSignMessage) and sign it with the corresponding private key
4. Register the user with the [sign-up endpoint](https://api.dfx.swiss/swagger/#/auth/AuthController_signUp)
   - Use the `walletId` from step 1
   - See [below](#referral-program) for more information on the referral program (`usedRef`)
5. Now you can get your JWT access token (with address & signature) with the [sign-in endpoint](https://api.dfx.swiss/swagger/#/auth/AuthController_signIn)

#### Login Example

The following code snippet shows a way to generate login credentials for the DeFiChain blockchain.

```ts
import { MainNet, Network } from '@defichain/jellyfish-network';
import { JellyfishWallet } from '@defichain/jellyfish-wallet';
import { Bip32Options, MnemonicHdNodeProvider } from '@defichain/jellyfish-wallet-mnemonic';
import { WhaleWalletAccountProvider } from '@defichain/whale-api-wallet';
import { sign } from 'bitcoinjs-message';

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
      JellyfishWallet.PURPOSE_LIGHT_WALLET,
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
    return sign(message, privateKey, true, this.network.messagePrefix).toString('base64');
  }
}
```

#### Notifications

If a user wants to get notified about ongoing transactions, he can register his email address with the [user endpoint](https://api.dfx.swiss/swagger/#/user/UserController_updateUser)

#### Referral Program

- Basic information about the referral program can be found in the FAQ on our [homepage](https://dfx.swiss/defichain/)
- A referral code can only be set once during [user registration](#registration) (`usedRef` parameter)
- Every user will receive his own referral code after the first successful transaction. It can be get from the [user detail endpoint](https://api.dfx.swiss/swagger/#/user/UserController_getUserDetail).

### KYC (optional)

KYC is not required for a daily transaction volume up to 1000 EUR/CHF. To increase the transaction volume, the user needs to be verified with a KYC process, which can be done on the DFX KYC page.

1. Get the user's KYC hash from [user endpoint](https://api.dfx.swiss/swagger/#/user/UserController_getUser)
2. Open then link to the KYC page: `https://payment.dfx.swiss/kyc?code=<kyc-hash>`

### Transactions

#### Buy Crypto

1. Get all available assets with the [asset endpoint](https://api.dfx.swiss/swagger/#/asset/AssetController_getAllAsset)
   - This endpoint will return all assets compatible with the user's address, which might be assets on multiple blockchains. The query parameter (optional) can be used to filter for specific blockchains.
   - Only assets with the `buyable` field set to `true` can be bought
2. Get all available currencies with the [fiat endpoint](https://api.dfx.swiss/swagger/#/fiat/FiatController_getAllFiat)
   - Only fiats with the `sellable` field set to `true` can be used to buy crypto
3. Get the payment information with the [buy payment endpoint](https://api.dfx.swiss/swagger/#/buy/BuyController_createBuyWithPaymentInfo)
4. Do a bank transfer with the provided payment infos
   - Ensure compliance with minimum deposit and KYC limits
5. The crypto asset will be sent to the user's blockchain address as soon as the bank transfer is completed

#### Sell Crypto

1. Get all available assets with the [asset endpoint](https://api.dfx.swiss/swagger/#/asset/AssetController_getAllAsset)
   - Only assets with the `sellable` field set to `true` can be sold
2. Get all available currencies with the [fiat endpoint](https://api.dfx.swiss/swagger/#/fiat/FiatController_getAllFiat)
   - Only fiats with the `buyable` field set to `true` can be used to sell crypto
3. Get the payment information with the [sell payment endpoint](https://api.dfx.swiss/swagger/#/sell/SellController_createSellWithPaymentInfo)
4. Do a blockchain transaction to the provided deposit address
   - Ensure compliance with minimum deposit and KYC limits
5. The fiat will be sent to the specified bank account as soon as the blockchain transaction is completed

#### Bank Accounts (optional)

- All bank accounts of a user can be fetched with the [bank account endpoint](https://api.dfx.swiss/swagger/#/bankAccount/BankAccountController_getAllUserBankAccount)
- A call to the buy or sell payment info endpoints will automatically create a bank account for the provided IBAN
- This can be used to improve UX and show the previously used IBANs to the user
- Bank accounts (label, preferred currency) can be updated with the [update endpoint](https://api.dfx.swiss/swagger/#/bankAccount/BankAccountController_updateBankAccount)
- Bank accounts can be created directly with the [create endpoint](https://api.dfx.swiss/swagger/#/bankAccount/BankAccountController_createBankAccount)

### Integration Example

- DFX.swiss is integrated in the [DFX.swiss exchange](https://github.com/DFXswiss/exchange)
