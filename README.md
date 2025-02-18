# DFX API

DFX is a crypto on- and off-ramp with an open API that can be integrated by anyone. This page explains the basic concepts of the API. If you don't want to bother with API calls, you can integrate our ready-to-use web widget with a few lines of code (see the [services repository](https://github.com/DFXswiss/services#dfx-services)) or use our [React API npm package](https://www.npmjs.com/package/@dfx.swiss/react).

## API Documentation

- [Swagger](#swagger)
- [Authentication](#authentication)
- [KYC](#kyc-optional)
- [Transactions](#transactions)
  - [Buy Crypto](#buy-crypto)
  - [Sell Crypto](#sell-crypto)
  - [Bank Accounts](#bank-accounts-optional)
- [Integration Example](#integration-example)

### Swagger

- [Swagger UI](https://api.dfx.swiss)
- [Swagger JSON](https://api.dfx.swiss/swagger-json)

### Authentication

Each user who wants to use the service must be registered separately with their blockchain address and a signature to prove ownership.

#### Initial Wallet Setup (optional)

Contact [support](mailto:support@dfx.swiss) to register your wallet name. This is used to identify all users that signed up with your wallet. This step is optional.

#### Sign-Up / Sign-In

1. Get the sign message from [sign-message endpoint](https://api.dfx.swiss/swagger/#/Auth/AuthController_getSignMessage) (with the user's address) and sign it with the corresponding private key
1. Sign the user up or in with the [auth endpoint](https://api.dfx.swiss/swagger/#/Auth/AuthController_authenticate). This call will register a new user, if the user does not exist yet. If there is already a user with the same address, the user will be signed in. The response contains a JWT access token, which can be used for further API calls. `usedRef`, `wallet` and `specialCode` parameters are optional. `usedRef` and `wallet` are only taken into account on user registration.
   - Use the wallet name (`wallet`) from step [initial setup](#initial-wallet-setup-optional)
   - See [below](#referral-program) for more information on the referral program (`usedRef`)

Alternatively the [sign-up](https://api.dfx.swiss/swagger/#/Auth/AuthController_signUp) and [sign-in](https://api.dfx.swiss/swagger/#/Auth/AuthController_signIn) endpoints can be used if only one functionality (sign-up or sign-in) is required.

#### Notifications

If a user wants to get notified about ongoing transactions, he can register his email address with the [user endpoint](https://api.dfx.swiss/swagger/#/User/UserController_updateUser)

#### Referral Program

- Basic information about the referral program can be found in our [FAQ](https://docs.dfx.swiss/en/faq)
- A referral code can only be set once during [user registration](#authentication) (`usedRef` parameter)
- Every user will receive his own referral code after the first successful transaction. It can be got from the [user endpoint](https://api.dfx.swiss/swagger/#/User/UserV2Controller_getUser).
- Details about the referred users can be got from the [ref endpoint](https://api.dfx.swiss/swagger/#/User/UserV2Controller_getRef).

### KYC (optional)

KYC is not required for a monthly transaction volume up to 1000 CHF. To increase the transaction volume, the user needs to be verified with a KYC process, which can be done on the DFX KYC page. Just open then link to the KYC page with the user's API access token: `https://app.dfx.swiss/kyc?session=<jwt-access-token>`

The current KYC level of a user can be read using the [user endpoint](https://api.dfx.swiss/swagger/#/User/UserV2Controller_getUser). The different levels are listed below.

- Level 10: Contact data recorded (mail)
- Level 20: Personal data recorded (account type, name, address, phone number)
- Level 30: Successful identification with ID or passport
- Level 40: Financial background queried (income, assets, business activity)
- Level 50: Risk analysis carried out (start of the business relationship between DFX and the user)

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

<em>In order to perform bank transactions, DFX needs to know the name and address of the recipient (KYC level ≥ 20). Therefore, user data must be collected once before a sale can be made. The user data can be updated with the [kyc data endpoint](https://api.dfx.swiss/swagger#/User/UserController_updateKycData). Required fields are `accountType, mail, phone, firstname, lastName, address (street, city, zip, country)`. For non personal accounts, `organizationName, organizationAddress (street, city, zip, country)` are also required.</em>

1. Update user data, if required (check with `kyc.dataComplete` field from [user endpoint](https://api.dfx.swiss/swagger/#/User/UserV2Controller_getUser))
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

- DFX.swiss is integrated in the [DFX.swiss Services](https://github.com/DFXswiss/services)
