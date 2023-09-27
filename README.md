# DFX API

DFX is a crypto on- and off-ramp with an open API that can be integrated by anyone. This page explains the basic concepts of the API. If you don't want to bother with API calls, you can integrate our ready-to-use web widget with a few lines of code (see the [services repository](https://github.com/DFXswiss/services#dfx-services)) or use our [React API npm package](https://www.npmjs.com/package/@dfx.swiss/react).

## API Documentation

- [Swagger](#swagger)
- [Registration](#registration)
- [KYC](#kyc-optional)
- [Transactions](#transactions)
  - [Buy Crypto](#buy-crypto)
  - [Sell Crypto](#sell-crypto)
  - [Bank Accounts](#bank-accounts-optional)
- [Integration Example](#integration-example)
- [Appendix](#appendix)

### Swagger

- [Swagger UI](https://api.dfx.swiss)
- [Swagger JSON](https://api.dfx.swiss/swagger-json)

### Registration

Each user who wants to use the service must be registered separately with their blockchain address and a signature to prove ownership.

#### Initial Wallet Setup (optional)

Contact [support](mailto:support@dfx.swiss) to register your wallet name. This is used to identify all users that signed up with your wallet. This step is optional.

#### Sign Up

1. Get the sign message from [sign-message endpoint](https://api.dfx.swiss/swagger/#/Auth/AuthController_getSignMessage) (with the user's address) and sign it with the corresponding private key
1. Register the user with the [sign-up endpoint](https://api.dfx.swiss/swagger/#/Auth/AuthController_signUp). `wallet` and `usedRef` are optional:
   - Use the wallet name (`wallet`) from step [initial setup](#initial-wallet-setup-optional)
   - See [below](#referral-program) for more information on the referral program (`usedRef`)
1. Now you can get your JWT access token (with address & signature) with the [sign-in endpoint](https://api.dfx.swiss/swagger/#/Auth/AuthController_signIn)

#### Notifications

If a user wants to get notified about ongoing transactions, he can register his email address with the [user endpoint](https://api.dfx.swiss/swagger/#/User/UserController_updateUser)

#### Referral Program

- Basic information about the referral program can be found in the FAQ on our [homepage](https://dfx.swiss/defichain/)
- A referral code can only be set once during [user registration](#registration) (`usedRef` parameter)
- Every user will receive his own referral code after the first successful transaction. It can be get from the [user detail endpoint](https://api.dfx.swiss/swagger/#/User/UserController_getUserDetail).

### KYC (optional)

KYC is not required for a daily transaction volume up to 1000 EUR/CHF. To increase the transaction volume, the user needs to be verified with a KYC process, which can be done on the DFX KYC page.

1. Get the user's KYC hash from [user endpoint](https://api.dfx.swiss/swagger/#/User/UserController_getUser)
1. Open then link to the KYC page: `https://payment.dfx.swiss/kyc?code=<kyc-hash>`

### Transactions

#### Buy Crypto

_Get a quote_

1. Get all available assets with the [asset endpoint](https://api.dfx.swiss/swagger/#/Asset/AssetController_getAllAsset)
   - This endpoint will return all assets compatible with the user's address, which might be assets on multiple blockchains. The query parameter (optional) can be used to filter for specific blockchains.
   - Only assets with the `buyable` field set to `true` can be bought
1. Get all available currencies with the [fiat endpoint](https://api.dfx.swiss/swagger/#/Fiat/FiatController_getAllFiat)
   - Only fiats with the `sellable` field set to `true` can be used to buy crypto
1. Get a quote with the [buy quote endpoint](https://api.dfx.swiss/swagger/#/Buy/BuyController_getBuyQuote)

_Get payment infos_

1. Get all available assets with the [asset endpoint](https://api.dfx.swiss/swagger/#/Asset/AssetController_getAllAsset)
   - This endpoint will return all assets compatible with the user's address, which might be assets on multiple blockchains. The query parameter (optional) can be used to filter for specific blockchains.
   - Only assets with the `buyable` field set to `true` can be bought
1. Get all available currencies with the [fiat endpoint](https://api.dfx.swiss/swagger/#/Fiat/FiatController_getAllFiat)
   - Only fiats with the `sellable` field set to `true` can be used to buy crypto
1. Get the payment information with the [buy payment endpoint](https://api.dfx.swiss/swagger/#/Buy/BuyController_createBuyWithPaymentInfo)
1. Do a bank transfer with the provided payment infos
   - Ensure compliance with minimum deposit and KYC limits
1. The crypto asset will be sent to the user's blockchain address as soon as the bank transfer is completed

#### Sell Crypto

_Get a quote_

1. Get all available assets with the [asset endpoint](https://api.dfx.swiss/swagger/#/Asset/AssetController_getAllAsset)
   - Only assets with the `sellable` field set to `true` can be sold
1. Get all available currencies with the [fiat endpoint](https://api.dfx.swiss/swagger/#/Fiat/FiatController_getAllFiat)
   - Only fiats with the `buyable` field set to `true` can be used to sell crypto
1. Get a quote with the [sell quote endpoint](https://api.dfx.swiss/swagger/#/Sell/SellController_getSellQuote)

_Get payment infos_

<em>In order to perform bank transactions, DFX needs to know the name and address of the recipient. Therefore, user data must be collected once before a sale can be made. The user data can be updated with the [kyc data endpoint](https://api.dfx.swiss/swagger#/KYC/KycController_updateKycData). Required fields are `mail, phone, firstname, surname, street, houseNumber, location, zip, country`. For non personal accounts, `organizationName, organizationStreet, organizationHouseNumber, organizationLocation, organizationZip, organizationCountry` are also required.</em>

1. Update user data, if required (check with `kycDataComplete` field from [user endpoint](https://api.dfx.swiss/swagger/#/User/UserController_getUser))
1. Get all available assets with the [asset endpoint](https://api.dfx.swiss/swagger/#/Asset/AssetController_getAllAsset)
   - Only assets with the `sellable` field set to `true` can be sold
1. Get all available currencies with the [fiat endpoint](https://api.dfx.swiss/swagger/#/Fiat/FiatController_getAllFiat)
   - Only fiats with the `buyable` field set to `true` can be used to sell crypto
1. Get the payment information with the [sell payment endpoint](https://api.dfx.swiss/swagger/#/Sell/SellController_createSellWithPaymentInfo)
1. Do a blockchain transaction to the provided deposit address
   - Ensure compliance with minimum deposit and KYC limits
1. The fiat will be sent to the specified bank account as soon as the blockchain transaction is completed

#### Bank Accounts (optional)

- All bank accounts of a user can be fetched with the [bank account endpoint](https://api.dfx.swiss/swagger/#/BankAccount/BankAccountController_getAllUserBankAccount)
- A call to the buy or sell payment info endpoints will automatically create a bank account for the provided IBAN
- This can be used to improve UX and show the previously used IBANs to the user
- Bank accounts (label, preferred currency) can be updated with the [update endpoint](https://api.dfx.swiss/swagger/#/BankAccount/BankAccountController_updateBankAccount)
- Bank accounts can be created directly with the [create endpoint](https://api.dfx.swiss/swagger/#/BankAccount/BankAccountController_createBankAccount)

### Integration Example

- DFX.swiss is integrated in the [DFX.swiss exchange](https://github.com/DFXswiss/exchange)

### Appendix

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
  private readonly seed = [
    /* PUT YOUR SEED HERE */
  ]; // 24 word mnemonic seed phrase

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
