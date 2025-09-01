# DFX API

DFX is a crypto on- and off-ramp with an open API that can be integrated by anyone. This page explains the basic concepts of the API. If you don't want to bother with API calls, you can integrate our ready-to-use web widget with a few lines of code (see the [services repository](https://github.com/DFXswiss/services#dfx-services)) or use our [React API npm package](https://www.npmjs.com/package/@dfx.swiss/react).

## Environments

- Productive API URL: [api.dfx.swiss](https://api.dfx.swiss)
- Test (sandbox) API URL: [dev.api.dfx.swiss](https://dev.api.dfx.swiss)

Links to the productive API are used in the further documentation.

### Swagger

- Productive environment
  - [Swagger UI](https://api.dfx.swiss)
  - [Swagger JSON](https://api.dfx.swiss/swagger-json)
- Test environment
  - [Swagger UI](https://dev.api.dfx.swiss)
  - [Swagger JSON](https://dev.api.dfx.swiss/swagger-json)

## On-/Off-Ramp

This section explains the key concepts for using the DFX on-ramp and off-ramp.

- [Authentication](#authentication)
- [KYC](#kyc-optional)
- [Transactions](#transactions)
  - [Buy Crypto](#buy-crypto)
  - [Sell Crypto](#sell-crypto)
  - [Bank Accounts](#bank-accounts-optional)
- [Integration Example](#integration-example)

### Authentication

Each user who wants to use the service must be registered separately with their blockchain address and a signature to prove ownership.

#### Initial Wallet Setup (optional)

Contact [support](mailto:support@dfx.swiss) to register your wallet name. This is used to identify all users that signed up with your wallet. This step is optional.

#### Sign-Up / Sign-In

1. Get the sign message from [sign-message endpoint](https://api.dfx.swiss/swagger/#/Auth/AuthController_getSignMessage) (with the user's address) and sign it with the corresponding private key
1. Sign the user up or in with the [auth endpoint](https://api.dfx.swiss/swagger/#/Auth/AuthController_authenticate). This call will register a new user, if the user does not exist yet. If there is already a user with the same address, the user will be signed in. The response contains a JWT access token, which can be used for further API calls (bearer authentication). `usedRef`, `wallet` and `specialCode` parameters are optional. `usedRef` and `wallet` are only taken into account on user registration.
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

## Open CryptoPay

This section explains the concepts behind the administrative API for the DFX implementation of the [Open CryptoPay](https://opencryptopay.io/) standard. There are two different ways to authenticate API requests. For admin access (only required for a one-time setup or configuration changes), a time-limited JWT access token must be used. For productive operation on POS systems, it is recommended to use a static access key with limited rights. The key can be obtained from payment link config (see [config](#config)).

### Admin API

#### Authentication

Use the [auth endpoint](https://api.dfx.swiss/swagger#/Auth/AuthController_authenticate) to obtain a JWT access token with the credentials (`address` and `signature`) obtained during onboarding. This token can be used for further API calls (bearer authentication).

#### History

A list of payment links, including the processed payments, can be obtained from [history endpoint](https://api.dfx.swiss/swagger#/Payment%20Link/PaymentLinkController_getPaymentHistory). Query parameters can be used to pre-filter the list.

#### Config

The default payment link config can be fetched with [get config endpoint](https://api.dfx.swiss/swagger#/Payment%20Link/PaymentLinkController_getUserPaymentLinksConfig) and updated with [update config endpoint](https://api.dfx.swiss/swagger#/Payment%20Link/PaymentLinkController_updateUserPaymentLinksConfig). The static access key (from `accessKey` field) can be used for productive operation.

### Operation API

#### Create Payment Link

For every POS terminal or cash register, a payment link should be created using the [payment link endpoint](https://api.dfx.swiss/swagger#/Payment%20Link/PaymentLinkController_createPaymentLink). This is a one-time setup call, but is recommended to be done at device (POS) boot up. The endpoint will return an HTTP 409 error if a payment link with the same `externalId` (see below) already exists.

No parameters are required, it is though strongly recommended to provide an `externalId`, which should correspond to a unique POS ID. This ID is utilized in the payment process.

The endpoint will return a URL in the `frontendUrl` field, which can be used to generate a static POS QR code. Customers can scan this QR with their camera or wallet to pay at the linked POS.

#### Process Payments

The following steps must be carried out at the POS if a customer wants to pay with crypto.

1. [Create a payment](https://api.dfx.swiss/swagger#/Payment%20Link/PaymentLinkController_createPayment): A payment can be created for a specific payment link by sending the POS ID in the `externalLinkId` query parameter. `amount` and `externalId` should be sent in the body, whereas the latter is a unique payment ID. This ID is also used for all subsequent request. The currency is linked to the bank details provided during onboarding and does not need to be provided.

   The endpoint will return a URL in the `payment.frontendUrl` field, which can be used to dynamically generate a payment QR code. Customers can scan this QR with their camera or wallet to execute the payment.

1. [Wait for payment](https://api.dfx.swiss/swagger#/Payment%20Link/PaymentLinkController_waitForPayment): This API endpoint can be used to wait for a change on a pending payment. It blocks until the payment either is completed, cancelled or expired. The response will contain the result in the `payment.status` field. Please use the `externalPaymentId` query parameter to select the payment to be waited on.

1. [Confirm a payment](https://api.dfx.swiss/swagger#/Payment%20Link/PaymentLinkController_confirmPayment) (optional): A payment can be confirmed for documentation purposes. This can only be done after it is completed (paid by the customer). Please use the `externalPaymentId` query parameter to select the payment to be confirmed.

1. [Cancel a payment](https://api.dfx.swiss/swagger#/Payment%20Link/PaymentLinkController_cancelPayment) (optional): A payment can be cancelled as long at it is still pending. Please use the `externalPaymentId` query parameter to select the payment to be cancelled.
