# HTTP endpoints

Every HTTP endpoint this service exposes: **533 handlers** across 93 controller files. 223 are marked `@ApiExcludeEndpoint` and do not appear in the public Swagger schema.

## Columns

| Column | Meaning |
| ------ | ------- |
| **Ver** | API version in the URL. `1` is the default and needs no decorator; `2` comes from `@Controller({ version: [...] })`; `neutral` marks `@Version(VERSION_NEUTRAL)`, which is served without a version prefix. Six paths exist twice under different versions — an older, deprecated handler and its replacement — so the version is what makes a row unique. |
| **Dep** | `yes` when the handler carries `@ApiOperation({ deprecated: true })` |
| **Swagger** | `public` — in the Swagger schema; `hidden` — carries `@ApiExcludeEndpoint` |
| **Data access** | What the endpoint reads, taken over **all** load sites it can reach — a permission check, a lookup and the actual query all count. `whole rows` — at least one of them fetches every column of an entity; `projected` — every read names the fields it needs; `caller-defined` — the field list comes from the request, and without one every column is loaded; `none` — no read at all (external services, in-memory caches, files, pure write paths). |
| **Max cols** | Widest single query the endpoint can trigger, measured against the real entity metadata. `—` means no measurable site, not zero. |

## What the numbers say

| Data access | Endpoints | Share |
| ----------- | --------: | ----: |
| `whole rows` | 432 | 81 % |
| `none` | 97 | 18 % |
| `projected` | 2 | 0 % |
| `caller-defined` | 2 | 0 % |

Two endpoints read only what they return: `PUT /log/financial/validity`, whose query names `log.id` and `log.valid`, and `POST /gs/debug`, which assembles its select list from the request. `POST /gs/db` and `POST /gs/db/custom` project only when the caller sends a field list — `request.select(query.select)` — and load the full table otherwise. How far the test suite actually covers those reads is recorded per site in [read-path-projections.md](read-path-projections.md#which-endpoints-these-apply-to); the short answer is that the projection behind `PUT /log/financial/validity` is never executed in a test.

Among the 432 that fetch whole rows, the widest query they can trigger is **308 columns** at the median; 320 exceed 100, 90 exceed 500 and 19 exceed 1000. Postgres refuses a statement with more than 1664 columns, which is what broke every invoice and receipt in production once a single column was added elsewhere.

### How to read this column, and how not to

`Data access` is a statement about the **union** of everything an endpoint touches, not about one designated data path. An endpoint marked `whole rows` may well answer from raw SQL and still be marked, because a permission check on the way loads a full `UserData` row. That is deliberate: the question the column answers is *does this endpoint load more than it needs*, and for that any one offending site is enough. It does **not** say where the bulk of the work happens — [load-sites.md](load-sites.md) does, per site and with measured column counts.

### Deprecation

24 handlers carry `@ApiOperation({ deprecated: true })`: 21 of them fetch whole rows, 3 read nothing. They are what the duplicated paths are about — an older handler and its replacement served side by side under different versions. Note that deprecation does not follow the version: `GET /kyc/countries` is marked on **both** the v1 and the v2 handler.

### Limits of this classification

Stated exactly, so the numbers can be checked rather than believed:

- **435 of 533 endpoints rest on a call graph that is not fully resolved** — a target chosen at runtime, a method reached through inheritance, an entity manager handed into a transaction callback. This does not weaken the `whole rows` group: an unresolved edge can only add load sites, never remove one, so 432 is a lower bound.
- All 97 endpoints marked `none` are the opposite case: their graph resolved completely, or the remaining target was read in the source (27 of them, listed below). None of them rests on an unresolved edge.
- The 2 `projected` and 2 `caller-defined` endpoints do each carry an unresolved edge — a call through the entity manager inside a transaction callback. Their reads were read in the source, but the classification is not proven exhaustive the way the `none` group is.
- 3 endpoints in the `whole rows` group have no measured column count and show `—`: `POST /payIn/retry`, `GET /support/issue/:id/message/:messageId/file`, `PUT /userData/:id/volumes`. The classification holds; only the width is unknown.

### Two controller classes may share a name

`KycController`, `KycClientController` and `KycService` each exist twice, in different subdomains: the deprecated v1 generation under `generic/user/models/kyc/` and the current one under `generic/kyc/`. Rows are therefore not identified by the handler column alone — the file column is what separates them. The same holds for the 57 strategy classes that repeat a name once per family (`BitcoinStrategy` exists eight times), though none of those serves a route.

### Endpoints resolved by reading the source

For 27 endpoints the call graph ends at a target chosen at runtime. Each was read in the source and recorded here rather than left unknown, so the judgement is visible and can be challenged:

| Endpoint | Why it reads nothing |
| -------- | -------------------- |
| `POST /alchemy/addressWebhook` | HMAC check against a key held in memory |
| `GET /alchemy/addresses/:webhookId` | third-party SDK (`alchemy.notify`), no table of ours |
| `GET /auth/alby` | builds an OAuth URL; the pending state lives in memory |
| `POST /bank/yapeal/webhook` | hands off through an rxjs subject — the loading happens in the subscriber, not in the request path |
| `GET /dex/check-liquidity` | strategy registry; no strategy under `dex/strategies/{check,purchase,sell}-liquidity` contains a load site |
| `POST /dex/purchase-liquidity` | same registry as `GET /dex/check-liquidity` |
| `POST /dex/reserve-liquidity` | same registry as `GET /dex/check-liquidity` |
| `GET /dex/transfer-completion` | same registry as `GET /dex/check-liquidity` |
| `POST /dex/transfer-liquidity` | same registry as `GET /dex/check-liquidity` |
| `GET /exchange/:exchange/balances` | callback onto an exchange client, no entity involved |
| `GET /exchange/:exchange/price` | same callback as `GET /exchange/:exchange/balances` |
| `GET /exchange/:exchange/trade` | same callback as `GET /exchange/:exchange/balances` |
| `POST /exchange/:exchange/trade` | same callback as `GET /exchange/:exchange/balances` |
| `GET /exchange/:exchange/trade/history` | same callback as `GET /exchange/:exchange/balances` |
| `POST /exchange/:exchange/withdraw` | same callback as `GET /exchange/:exchange/balances` |
| `GET /exchange/:exchange/withdraw/:id` | same callback as `GET /exchange/:exchange/balances` |
| `POST /paymentLink/integrations/kucoin/webhook/cancel` | signature check; the services it reaches contain no load site |
| `POST /paymentLink/integrations/kucoin/webhook/success` | signature check; the services it reaches contain no load site |
| `POST /payout` | a factory builds the entity, then `save()` — a pure write path |
| `GET /realunit/brokerbot/buyPrice` | price from an in-memory cache, otherwise from the chain |
| `GET /realunit/brokerbot/buyShares` | same cache as `GET /realunit/brokerbot/buyPrice` |
| `GET /realunit/brokerbot/price` | same cache as `GET /realunit/brokerbot/buyPrice` |
| `GET /realunit/quote/buyPrice` | same cache as `GET /realunit/brokerbot/buyPrice` |
| `GET /realunit/quote/buyShares` | same cache as `GET /realunit/brokerbot/buyPrice` |
| `GET /realunit/quote/price` | same cache as `GET /realunit/brokerbot/buyPrice` |
| `POST /tatum/addressWebhook` | signature check, then a third-party SDK |
| `GET /version` | reads `dist/version.txt` from disk |

[read-path-projections.md](read-path-projections.md) explains the background, the criteria for converting an endpoint, and how the result is tested.

## How the values are produced

- **Endpoints** — from the routing decorators in `src/**/*.controller.ts`, each attributed to the `@Controller` scope preceding it. Decorators between the route and the method are skipped by counting parentheses, so a multi-line `@UseGuards(` cannot be mistaken for the handler. Cross-checked in both directions against the routes the framework registers at startup: all 526 distinct method/path pairs match, with no entry left over on either side.
- **Ver** — from `@Version` on the handler, otherwise from the `@Controller` scope, otherwise the configured default. Note that the version follows the class, not the folder: the controllers under `generic/kyc/` are not uniformly v2 — `KycAdminController` carries no version decorator and is therefore served under the default.
- **Data access** — the union over the call graph, following injected fields, locally constructed repositories and multi-line call chains. `find*` pulls in eager relations, `createQueryBuilder` does not, `.select([...])` is the only form that narrows the column list, and `.update()/.delete()/.insert()` are writes that load nothing.
- **Max cols** — the query is built from the real entity metadata and its SELECT list counted. Not an estimate.

## Known discrepancy

`POST /paymentLink/integrations/kucoin/webhook/cancel` appears in the source but is **not registered at runtime**: its handler in `c2b-payment-link.controller.ts` carries two `@Post` decorators, and the framework stores a single path per handler, so only `.../webhook/success` takes effect. Listed below for completeness and marked accordingly.

## Endpoints

| Method | Ver | Dep | Path | Swagger | Data access | Max cols | Handler | File |
| ------ | --- | --- | ---- | ------- | ----------- | -------: | ------- | ---- |
| GET | neutral |  | `/` | public | none | — | `AppController.home` | `app.controller.ts` |
| POST | 1 |  | `/CustodyProvider` | public | none | — | `CustodyProviderController.createCustodyProvider` | `subdomains/generic/user/models/custody-provider/custody-provider.controller.ts` |
| PUT | 1 |  | `/CustodyProvider/:id` | hidden | whole rows | 6 | `CustodyProviderController.updateCustodyProvider` | `subdomains/generic/user/models/custody-provider/custody-provider.controller.ts` |
| POST | 1 |  | `/admin/lightning/rotate-webhook-secrets` | hidden | none | — | `AdminController.rotateLightningWebhookSecrets` | `subdomains/generic/admin/admin.controller.ts` |
| POST | 1 |  | `/admin/mail` | public | whole rows | 13 | `AdminController.sendMail` | `subdomains/generic/admin/admin.controller.ts` |
| POST | 1 |  | `/admin/payout` | hidden | whole rows | 156 | `AdminController.payout` | `subdomains/generic/admin/admin.controller.ts` |
| POST | 1 |  | `/admin/sendLetter` | hidden | none | — | `AdminController.sendLetter` | `subdomains/generic/admin/admin.controller.ts` |
| POST | 1 |  | `/alchemy/addressWebhook` | public | none | — | `AlchemyController.addressWebhook` | `integration/alchemy/controllers/alchemy.controller.ts` |
| GET | 1 |  | `/alchemy/addresses/:webhookId` | public | none | — | `AlchemyController.addresses` | `integration/alchemy/controllers/alchemy.controller.ts` |
| GET | 1 |  | `/app` | public | whole rows | 6 | `AppController.createRefNew` | `app.controller.ts` |
| GET | 1 |  | `/app/:app` | hidden | whole rows | 6 | `AppController.redirectToStore` | `app.controller.ts` |
| GET | 1 |  | `/app/advertisements` | hidden | none | — | `AppController.getAds` | `app.controller.ts` |
| GET | 1 |  | `/app/announcements` | public | none | — | `AppController.getAnnouncements` | `app.controller.ts` |
| GET | 1 |  | `/app/settings/flags` | hidden | none | — | `AppController.getFlags` | `app.controller.ts` |
| GET | 1 |  | `/asset` | public | whole rows | 33 | `AssetController.getAllAsset` | `shared/models/asset/asset.controller.ts` |
| PUT | 1 |  | `/asset/:id` | public | whole rows | 33 | `AssetController.updateAsset` | `shared/models/asset/asset.controller.ts` |
| POST | 1 |  | `/auth` | public | whole rows | 643 | `AuthController.authenticate` | `subdomains/generic/user/models/auth/auth.controller.ts` |
| GET | 1 |  | `/auth/2fa` | hidden | whole rows | 253 | `AuthController.check2fa` | `subdomains/generic/user/models/auth/auth.controller.ts` |
| POST | 1 |  | `/auth/2fa` | public | whole rows | 253 | `AuthController.setup2fa` | `subdomains/generic/user/models/auth/auth.controller.ts` |
| POST | 1 |  | `/auth/2fa/verify` | public | whole rows | 253 | `AuthController.verify2fa` | `subdomains/generic/user/models/auth/auth.controller.ts` |
| GET | 1 |  | `/auth/alby` | hidden | none | — | `AuthController.signInWithAlby` | `subdomains/generic/user/models/auth/auth.controller.ts` |
| GET | 1 |  | `/auth/alby/redirect/:id` | hidden | whole rows | 643 | `AuthController.redirectAlby` | `subdomains/generic/user/models/auth/auth.controller.ts` |
| GET | 1 |  | `/auth/challenge` | hidden | whole rows | 20 | `AuthController.companyChallenge` | `subdomains/generic/user/models/auth/auth.controller.ts` |
| POST | 1 |  | `/auth/mail` | hidden | whole rows | 643 | `AuthController.signInByMail` | `subdomains/generic/user/models/auth/auth.controller.ts` |
| GET | 1 |  | `/auth/mail/confirm` | public | whole rows | 470 | `AuthController.executeMerge` | `subdomains/generic/user/models/auth/auth.controller.ts` |
| GET | 1 |  | `/auth/mail/redirect` | hidden | whole rows | 643 | `AuthController.redirectMail` | `subdomains/generic/user/models/auth/auth.controller.ts` |
| POST | 1 |  | `/auth/signIn` | hidden | whole rows | 643 | `AuthController.signIn` | `subdomains/generic/user/models/auth/auth.controller.ts` |
| GET | 1 |  | `/auth/signMessage` | public | none | — | `AuthController.getSignMessage` | `subdomains/generic/user/models/auth/auth.controller.ts` |
| POST | 1 |  | `/auth/signUp` | public | whole rows | 643 | `AuthController.signUp` | `subdomains/generic/user/models/auth/auth.controller.ts` |
| GET | 1 |  | `/auth/verifySignature` | public | whole rows | 6 | `AuthController.verifySignMessage` | `subdomains/generic/user/models/auth/auth.controller.ts` |
| GET | 1 |  | `/balance/pdf` | public | whole rows | 40 | `BalanceController.getBalancePdf` | `subdomains/supporting/balance/controllers/balance.controller.ts` |
| GET | 1 |  | `/balance/pdf/blockchains` | public | none | — | `BalanceController.getSupportedBlockchains` | `subdomains/supporting/balance/controllers/balance.controller.ts` |
| GET | 1 |  | `/bank` | public | whole rows | 46 | `BankController.getAllBanks` | `subdomains/supporting/bank/bank/bank.controller.ts` |
| PUT | 1 |  | `/bank/receiveIban` | public | whole rows | 101 | `BankController.checkReceiveIban` | `subdomains/supporting/bank/bank/bank.controller.ts` |
| POST | 1 |  | `/bank/yapeal/webhook` | public | none | — | `YapealWebhookController.handleYapealWebhook` | `integration/bank/controllers/yapeal-webhook.controller.ts` |
| GET | 1 |  | `/bankAccount` | public | whole rows | 261 | `BankAccountController.getAllUserBankAccount` | `subdomains/supporting/bank/bank-account/bank-account.controller.ts` |
| POST | 1 |  | `/bankAccount` | public | whole rows | 261 | `BankAccountController.createBankAccount` | `subdomains/supporting/bank/bank-account/bank-account.controller.ts` |
| PUT | 1 |  | `/bankAccount/:id` | public | whole rows | 261 | `BankAccountController.updateBankAccount` | `subdomains/supporting/bank/bank-account/bank-account.controller.ts` |
| POST | 1 |  | `/bankAccount/bic` | hidden | whole rows | 26 | `BankAccountController.addBankAccountBic` | `subdomains/supporting/bank/bank-account/bank-account.controller.ts` |
| POST | 1 |  | `/bankAccount/iban` | public | whole rows | 26 | `BankAccountController.addBankAccountIban` | `subdomains/supporting/bank/bank-account/bank-account.controller.ts` |
| PUT | 1 |  | `/bankData/:id` | public | whole rows | 31 | `BankDataController.updateBankData` | `subdomains/generic/user/models/bank-data/bank-data.controller.ts` |
| PUT | 1 |  | `/bankData/:id/nameCheck` | hidden | whole rows | 276 | `BankDataController.doNameCheck` | `subdomains/generic/user/models/bank-data/bank-data.controller.ts` |
| POST | 1 |  | `/bankTx` | public | whole rows | 61 | `BankTxController.uploadSepaFiles` | `subdomains/supporting/bank-tx/bank-tx/bank-tx.controller.ts` |
| PUT | 1 |  | `/bankTx/:id` | hidden | whole rows | 1051 | `BankTxController.update` | `subdomains/supporting/bank-tx/bank-tx/bank-tx.controller.ts` |
| DELETE | 1 |  | `/bankTx/:id/buyCrypto` | hidden | whole rows | 247 | `BankTxController.reset` | `subdomains/supporting/bank-tx/bank-tx/bank-tx.controller.ts` |
| PUT | 1 |  | `/bankTxRepeat/:id` | public | whole rows | 308 | `BankTxRepeatController.update` | `subdomains/supporting/bank-tx/bank-tx-repeat/bank-tx-repeat.controller.ts` |
| PUT | 1 |  | `/bankTxReturn/:id` | public | whole rows | 438 | `BankTxReturnController.update` | `subdomains/supporting/bank-tx/bank-tx-return/bank-tx-return.controller.ts` |
| POST | 1 |  | `/bankTxReturn/:id/refund` | hidden | whole rows | 727 | `BankTxReturnController.refundBuyCrypto` | `subdomains/supporting/bank-tx/bank-tx-return/bank-tx-return.controller.ts` |
| POST | 1 |  | `/blockchain/balances` | public | whole rows | 33 | `BlockchainApiController.getBalances` | `integration/blockchain/api/controllers/blockchain-api.controller.ts` |
| POST | 1 |  | `/blockchain/broadcast` | public | none | — | `BlockchainApiController.broadcastTransaction` | `integration/blockchain/api/controllers/blockchain-api.controller.ts` |
| POST | 1 |  | `/blockchain/transaction` | public | whole rows | 33 | `BlockchainApiController.createTransaction` | `integration/blockchain/api/controllers/blockchain-api.controller.ts` |
| GET | 1 |  | `/buy` | public | whole rows | 308 | `BuyController.getAllBuy` | `subdomains/core/buy-crypto/routes/buy/buy.controller.ts` |
| POST | 1 |  | `/buy` | hidden | whole rows | 364 | `BuyController.createBuy` | `subdomains/core/buy-crypto/routes/buy/buy.controller.ts` |
| GET | 1 |  | `/buy/:id` | hidden | whole rows | 308 | `BuyController.getBuy` | `subdomains/core/buy-crypto/routes/buy/buy.controller.ts` |
| PUT | 1 |  | `/buy/:id` | public | whole rows | 308 | `BuyController.updateBuyRoute` | `subdomains/core/buy-crypto/routes/buy/buy.controller.ts` |
| GET | 1 |  | `/buy/:id/history` | hidden | whole rows | 497 | `BuyController.getBuyRouteHistory` | `subdomains/core/buy-crypto/routes/buy/buy.controller.ts` |
| PUT | 1 |  | `/buy/paymentInfos` | public | whole rows | 364 | `BuyController.createBuyWithPaymentInfo` | `subdomains/core/buy-crypto/routes/buy/buy.controller.ts` |
| PUT | 1 |  | `/buy/paymentInfos/:id/confirm` | public | whole rows | 504 | `BuyController.confirmBuy` | `subdomains/core/buy-crypto/routes/buy/buy.controller.ts` |
| PUT | 1 |  | `/buy/paymentInfos/:id/invoice` | public | whole rows | 504 | `BuyController.generateInvoicePDF` | `subdomains/core/buy-crypto/routes/buy/buy.controller.ts` |
| GET | 1 |  | `/buy/personalIban` | public | whole rows | 331 | `BuyController.getAllPersonalIbans` | `subdomains/core/buy-crypto/routes/buy/buy.controller.ts` |
| POST | 1 |  | `/buy/personalIban` | public | whole rows | 253 | `BuyController.createPersonalIban` | `subdomains/core/buy-crypto/routes/buy/buy.controller.ts` |
| PUT | 1 |  | `/buy/quote` | hidden | whole rows | 143 | `BuyController.getBuyQuote` | `subdomains/core/buy-crypto/routes/buy/buy.controller.ts` |
| PUT | 1 |  | `/buyCrypto/:id` | hidden | whole rows | 1090 | `BuyCryptoController.update` | `subdomains/core/buy-crypto/process/buy-crypto.controller.ts` |
| DELETE | 1 |  | `/buyCrypto/:id/amlCheck` | hidden | whole rows | 422 | `BuyCryptoController.resetAmlCheck` | `subdomains/core/buy-crypto/process/buy-crypto.controller.ts` |
| PUT | 1 |  | `/buyCrypto/:id/amlCheck` | hidden | whole rows | 1090 | `BuyCryptoController.manualPassAmlCheck` | `subdomains/core/buy-crypto/process/buy-crypto.controller.ts` |
| POST | 1 |  | `/buyCrypto/:id/refund` | hidden | whole rows | 1051 | `BuyCryptoController.refundBuyCrypto` | `subdomains/core/buy-crypto/process/buy-crypto.controller.ts` |
| POST | 1 |  | `/buyCrypto/:id/scorechain` | hidden | whole rows | 717 | `BuyCryptoController.retriggerScorechain` | `subdomains/core/buy-crypto/process/buy-crypto.controller.ts` |
| POST | 1 |  | `/buyCrypto/:id/webhook` | public | whole rows | 844 | `BuyCryptoController.triggerWebhook` | `subdomains/core/buy-crypto/process/buy-crypto.controller.ts` |
| PUT | 1 |  | `/buyCrypto/refVolumes` | hidden | whole rows | 77 | `BuyCryptoController.updateRefVolumes` | `subdomains/core/buy-crypto/process/buy-crypto.controller.ts` |
| PUT | 1 |  | `/buyCrypto/volumes` | hidden | whole rows | 487 | `BuyCryptoController.updateBuyVolumes` | `subdomains/core/buy-crypto/process/buy-crypto.controller.ts` |
| PUT | 1 |  | `/buyFiat/:id` | hidden | whole rows | 1033 | `BuyFiatController.update` | `subdomains/core/sell-crypto/process/buy-fiat.controller.ts` |
| DELETE | 1 |  | `/buyFiat/:id/amlCheck` | hidden | whole rows | 490 | `BuyFiatController.resetAmlCheck` | `subdomains/core/sell-crypto/process/buy-fiat.controller.ts` |
| PUT | 1 |  | `/buyFiat/:id/amlCheck` | hidden | whole rows | 1033 | `BuyFiatController.manualPassAmlCheck` | `subdomains/core/sell-crypto/process/buy-fiat.controller.ts` |
| POST | 1 |  | `/buyFiat/:id/refund` | hidden | whole rows | 803 | `BuyFiatController.refundBuyFiat` | `subdomains/core/sell-crypto/process/buy-fiat.controller.ts` |
| POST | 1 |  | `/buyFiat/:id/scorechain` | hidden | whole rows | 517 | `BuyFiatController.retriggerScorechain` | `subdomains/core/sell-crypto/process/buy-fiat.controller.ts` |
| POST | 1 |  | `/buyFiat/:id/webhook` | public | whole rows | 644 | `BuyFiatController.triggerWebhook` | `subdomains/core/sell-crypto/process/buy-fiat.controller.ts` |
| PUT | 1 |  | `/buyFiat/refVolumes` | hidden | whole rows | 77 | `BuyFiatController.updateRefVolumes` | `subdomains/core/sell-crypto/process/buy-fiat.controller.ts` |
| PUT | 1 |  | `/buyFiat/volumes` | hidden | whole rows | 308 | `BuyFiatController.updateVolumes` | `subdomains/core/sell-crypto/process/buy-fiat.controller.ts` |
| GET | 1 |  | `/country` | public | whole rows | 23 | `CountryController.getAllCountry` | `shared/models/country/country.controller.ts` |
| GET | 1 |  | `/cryptoRoute` | public | none | — | `CryptoRouteController.getAllCrypto` | `subdomains/core/buy-crypto/routes/swap/crypto-route.controller.ts` |
| POST | 1 |  | `/cryptoRoute` | hidden | none | — | `CryptoRouteController.createCrypto` | `subdomains/core/buy-crypto/routes/swap/crypto-route.controller.ts` |
| GET | 1 |  | `/cryptoRoute/:id` | hidden | none | — | `CryptoRouteController.getCrypto` | `subdomains/core/buy-crypto/routes/swap/crypto-route.controller.ts` |
| PUT | 1 |  | `/cryptoRoute/:id` | hidden | none | — | `CryptoRouteController.updateCryptoRoute` | `subdomains/core/buy-crypto/routes/swap/crypto-route.controller.ts` |
| GET | 1 |  | `/cryptoRoute/:id/history` | hidden | none | — | `CryptoRouteController.getCryptoRouteHistory` | `subdomains/core/buy-crypto/routes/swap/crypto-route.controller.ts` |
| GET | 1 |  | `/custody` | public | whole rows | 253 | `CustodyController.getUserCustodyBalance` | `subdomains/core/custody/controllers/custody.controller.ts` |
| POST | 1 |  | `/custody` | public | whole rows | 364 | `CustodyController.createCustodyAccount` | `subdomains/core/custody/controllers/custody.controller.ts` |
| GET | 1 |  | `/custody/account` | public | whole rows | 253 | `CustodyAccountController.getCustodyAccounts` | `subdomains/core/custody/controllers/custody-account.controller.ts` |
| POST | 1 |  | `/custody/account` | public | whole rows | 253 | `CustodyAccountController.createCustodyAccount` | `subdomains/core/custody/controllers/custody-account.controller.ts` |
| GET | 1 |  | `/custody/account/:id` | public | whole rows | 253 | `CustodyAccountController.getCustodyAccount` | `subdomains/core/custody/controllers/custody-account.controller.ts` |
| PUT | 1 |  | `/custody/account/:id` | public | whole rows | 253 | `CustodyAccountController.updateCustodyAccount` | `subdomains/core/custody/controllers/custody-account.controller.ts` |
| GET | 1 |  | `/custody/account/:id/access` | public | whole rows | 238 | `CustodyAccountController.getAccessList` | `subdomains/core/custody/controllers/custody-account.controller.ts` |
| POST | 1 |  | `/custody/account/:id/access` | public | whole rows | 253 | `CustodyAccountController.grantAccess` | `subdomains/core/custody/controllers/custody-account.controller.ts` |
| DELETE | 1 |  | `/custody/account/:id/access/:accessId` | public | whole rows | 238 | `CustodyAccountController.revokeAccess` | `subdomains/core/custody/controllers/custody-account.controller.ts` |
| PUT | 1 |  | `/custody/account/:id/access/:accessId` | public | whole rows | 238 | `CustodyAccountController.updateAccess` | `subdomains/core/custody/controllers/custody-account.controller.ts` |
| GET | 1 |  | `/custody/account/:id/balance` | public | whole rows | 253 | `CustodyAccountController.getAccountBalance` | `subdomains/core/custody/controllers/custody-account.controller.ts` |
| GET | 1 |  | `/custody/account/:id/history` | public | whole rows | 253 | `CustodyAccountController.getAccountHistory` | `subdomains/core/custody/controllers/custody-account.controller.ts` |
| GET | 1 |  | `/custody/account/:id/order` | public | whole rows | 253 | `CustodyAccountController.getAccountOrders` | `subdomains/core/custody/controllers/custody-account.controller.ts` |
| GET | 1 |  | `/custody/account/:id/pdf` | public | whole rows | 253 | `CustodyAccountController.getAccountPdf` | `subdomains/core/custody/controllers/custody-account.controller.ts` |
| POST | 1 |  | `/custody/admin/order/:id/approve` | public | whole rows | 217 | `CustodyAdminController.approveOrder` | `subdomains/core/custody/controllers/custody.controller.ts` |
| GET | 1 |  | `/custody/admin/orders` | public | whole rows | 525 | `CustodyAdminController.getOrders` | `subdomains/core/custody/controllers/custody.controller.ts` |
| PUT | 1 |  | `/custody/admin/user/:id/balance` | public | whole rows | 308 | `CustodyAdminController.updateUserBalance` | `subdomains/core/custody/controllers/custody.controller.ts` |
| GET | 1 |  | `/custody/history` | public | whole rows | 253 | `CustodyController.getUserCustodyHistory` | `subdomains/core/custody/controllers/custody.controller.ts` |
| GET | 1 |  | `/custody/order` | public | whole rows | 19 | `CustodyController.getOrders` | `subdomains/core/custody/controllers/custody.controller.ts` |
| POST | 1 |  | `/custody/order` | public | whole rows | 364 | `CustodyController.createOrder` | `subdomains/core/custody/controllers/custody.controller.ts` |
| POST | 1 |  | `/custody/order/:id/confirm` | public | whole rows | 525 | `CustodyController.confirmOrder` | `subdomains/core/custody/controllers/custody.controller.ts` |
| GET | 1 |  | `/custody/pdf` | public | whole rows | 253 | `CustodyController.getCustodyPdf` | `subdomains/core/custody/controllers/custody.controller.ts` |
| GET | 1 |  | `/dashboard/accounting/ledger/accounts` | public | whole rows | 54 | `LedgerController.getAccounts` | `subdomains/core/accounting/controllers/ledger.controller.ts` |
| GET | 1 |  | `/dashboard/accounting/ledger/accounts/:accountId/legs` | hidden | whole rows | 30 | `LedgerController.getAccountDetail` | `subdomains/core/accounting/controllers/ledger.controller.ts` |
| GET | 1 |  | `/dashboard/accounting/ledger/equity-comparison` | hidden | whole rows | 54 | `LedgerController.getEquityComparison` | `subdomains/core/accounting/controllers/ledger.controller.ts` |
| GET | 1 |  | `/dashboard/accounting/ledger/margin` | hidden | whole rows | 11 | `LedgerController.getMargin` | `subdomains/core/accounting/controllers/ledger.controller.ts` |
| GET | 1 |  | `/dashboard/accounting/ledger/reconciliation` | hidden | whole rows | 54 | `LedgerController.getReconStatus` | `subdomains/core/accounting/controllers/ledger.controller.ts` |
| GET | 1 |  | `/dashboard/accounting/ledger/suspense` | hidden | whole rows | 11 | `LedgerController.getSuspense` | `subdomains/core/accounting/controllers/ledger.controller.ts` |
| GET | 1 |  | `/dashboard/financial/changes` | hidden | whole rows | 11 | `DashboardFinancialController.getFinancialChanges` | `subdomains/supporting/dashboard/dashboard-financial.controller.ts` |
| GET | 1 |  | `/dashboard/financial/changes/latest` | hidden | whole rows | 11 | `DashboardFinancialController.getLatestChanges` | `subdomains/supporting/dashboard/dashboard-financial.controller.ts` |
| GET | 1 |  | `/dashboard/financial/latest` | hidden | none | — | `DashboardFinancialController.getLatestBalance` | `subdomains/supporting/dashboard/dashboard-financial.controller.ts` |
| GET | 1 |  | `/dashboard/financial/log` | public | whole rows | 33 | `DashboardFinancialController.getFinancialLog` | `subdomains/supporting/dashboard/dashboard-financial.controller.ts` |
| GET | 1 |  | `/dashboard/financial/reconciliation` | public | whole rows | 229 | `DashboardReconciliationController.getReconciliation` | `subdomains/supporting/dashboard/dashboard-reconciliation.controller.ts` |
| GET | 1 |  | `/dashboard/financial/reconciliation/overview` | hidden | whole rows | 229 | `DashboardReconciliationController.getOverview` | `subdomains/supporting/dashboard/dashboard-reconciliation.controller.ts` |
| GET | 1 |  | `/dashboard/financial/ref-recipients` | hidden | whole rows | 25 | `DashboardFinancialController.getRefRewardRecipients` | `subdomains/supporting/dashboard/dashboard-financial.controller.ts` |
| POST | 1 |  | `/deposit` | public | whole rows | 6 | `DepositController.createDeposits` | `subdomains/supporting/address-pool/deposit/deposit.controller.ts` |
| PUT | 1 |  | `/deposit/lightningWebhook` | hidden | none | — | `DepositController.updateLightningDepositWebhook` | `subdomains/supporting/address-pool/deposit/deposit.controller.ts` |
| GET | 1 |  | `/deuro/info` | public | whole rows | 11 | `DEuroController.getInfo` | `integration/blockchain/deuro/controllers/deuro.controller.ts` |
| GET | 1 |  | `/dex/check-liquidity` | public | none | — | `DexController.checkLiquidity` | `subdomains/supporting/dex/dex.controller.ts` |
| PUT | 1 |  | `/dex/complete-orders` | hidden | whole rows | 156 | `DexController.completeOrders` | `subdomains/supporting/dex/dex.controller.ts` |
| GET | 1 |  | `/dex/liquidity-after-purchase` | hidden | whole rows | 156 | `DexController.fetchTargetLiquidityAfterPurchase` | `subdomains/supporting/dex/dex.controller.ts` |
| POST | 1 |  | `/dex/purchase-liquidity` | hidden | none | — | `DexController.purchaseLiquidity` | `subdomains/supporting/dex/dex.controller.ts` |
| POST | 1 |  | `/dex/reserve-liquidity` | hidden | none | — | `DexController.reserveLiquidity` | `subdomains/supporting/dex/dex.controller.ts` |
| GET | 1 |  | `/dex/transfer-completion` | hidden | none | — | `DexController.checkTransferCompletion` | `subdomains/supporting/dex/dex.controller.ts` |
| POST | 1 |  | `/dex/transfer-liquidity` | hidden | none | — | `DexController.transferLiquidity` | `subdomains/supporting/dex/dex.controller.ts` |
| GET | 1 |  | `/exchange/:exchange/balances` | public | none | — | `ExchangeController.getBalance` | `integration/exchange/controllers/exchange.controller.ts` |
| GET | 1 |  | `/exchange/:exchange/price` | hidden | none | — | `ExchangeController.getPrice` | `integration/exchange/controllers/exchange.controller.ts` |
| PUT | 1 |  | `/exchange/:exchange/sync` | hidden | whole rows | 40 | `ExchangeController.syncExchange` | `integration/exchange/controllers/exchange.controller.ts` |
| GET | 1 |  | `/exchange/:exchange/trade` | hidden | none | — | `ExchangeController.getTrades` | `integration/exchange/controllers/exchange.controller.ts` |
| POST | 1 |  | `/exchange/:exchange/trade` | hidden | none | — | `ExchangeController.trade` | `integration/exchange/controllers/exchange.controller.ts` |
| GET | 1 |  | `/exchange/:exchange/trade/history` | hidden | none | — | `ExchangeController.getTradeHistory` | `integration/exchange/controllers/exchange.controller.ts` |
| POST | 1 |  | `/exchange/:exchange/withdraw` | hidden | none | — | `ExchangeController.withdrawFunds` | `integration/exchange/controllers/exchange.controller.ts` |
| GET | 1 |  | `/exchange/:exchange/withdraw/:id` | public | none | — | `ExchangeController.getWithdraw` | `integration/exchange/controllers/exchange.controller.ts` |
| GET | 1 |  | `/exchange/trade/:id` | hidden | none | — | `ExchangeController.getTrade` | `integration/exchange/controllers/exchange.controller.ts` |
| POST | 1 |  | `/faucet` | public | whole rows | 308 | `FaucetRequestController.faucetRequest` | `subdomains/core/faucet-request/controller/faucet-request.controller.ts` |
| POST | 1 |  | `/fee` | public | whole rows | 65 | `FeeController.createFee` | `subdomains/supporting/payment/controllers/fee.controller.ts` |
| GET | 1 |  | `/fiat` | public | whole rows | 23 | `FiatController.getAllFiat` | `shared/models/fiat/fiat.controller.ts` |
| POST | 1 |  | `/fiatOutput` | public | whole rows | 377 | `FiatOutputController.create` | `subdomains/supporting/fiat-output/fiat-output.controller.ts` |
| PUT | 1 |  | `/fiatOutput/:id` | hidden | whole rows | 59 | `FiatOutputController.update` | `subdomains/supporting/fiat-output/fiat-output.controller.ts` |
| GET | 1 |  | `/frankencoin/info` | public | whole rows | 11 | `FrankencoinController.getInfo` | `integration/blockchain/frankencoin/controllers/frankencoin.controller.ts` |
| POST | 1 |  | `/gs/db` | public | caller-defined | 13 | `GsController.getDbData` | `subdomains/generic/gs/gs.controller.ts` |
| POST | 1 |  | `/gs/db/custom` | hidden | caller-defined | — | `GsController.getExtendedData` | `subdomains/generic/gs/gs.controller.ts` |
| POST | 1 |  | `/gs/debug` | hidden | projected | — | `GsController.executeDebugQuery` | `subdomains/generic/gs/gs.controller.ts` |
| POST | 1 |  | `/gs/evm/bridgeApproval` | hidden | whole rows | 33 | `GsEvmController.approveBridge` | `subdomains/generic/gs/gs-evm.controller.ts` |
| POST | 1 |  | `/gs/evm/coinTransaction` | hidden | whole rows | 6 | `GsEvmController.sendCoinTransaction` | `subdomains/generic/gs/gs-evm.controller.ts` |
| POST | 1 |  | `/gs/evm/contractApproval` | hidden | whole rows | 33 | `GsEvmController.approveContract` | `subdomains/generic/gs/gs-evm.controller.ts` |
| POST | 1 |  | `/gs/evm/contractTransaction` | hidden | none | — | `GsEvmController.sendContractTransaction` | `subdomains/generic/gs/gs-evm.controller.ts` |
| POST | 1 |  | `/gs/evm/rawTransaction` | public | whole rows | 6 | `GsEvmController.sendRawTransaction` | `subdomains/generic/gs/gs-evm.controller.ts` |
| POST | 1 |  | `/gs/evm/tokenTransaction` | hidden | whole rows | 33 | `GsEvmController.sendTokenTransaction` | `subdomains/generic/gs/gs-evm.controller.ts` |
| GET | 1 |  | `/gs/support` | hidden | whole rows | 907 | `GsController.getSupportData` | `subdomains/generic/gs/gs.controller.ts` |
| GET | neutral |  | `/health` | public | none | — | `HealthController.getHealth` | `subdomains/core/monitoring/health.controller.ts` |
| GET | neutral |  | `/health/banking` | public | none | — | `HealthController.getBankingHealth` | `subdomains/core/monitoring/health.controller.ts` |
| GET | neutral |  | `/health/external` | public | none | — | `HealthController.getExternalHealth` | `subdomains/core/monitoring/health.controller.ts` |
| GET | neutral |  | `/health/liquidity` | public | none | — | `HealthController.getLiquidityHealth` | `subdomains/core/monitoring/health.controller.ts` |
| GET | neutral |  | `/health/nodes` | public | none | — | `HealthController.getNodeHealth` | `subdomains/core/monitoring/health.controller.ts` |
| GET | neutral |  | `/health/payment` | public | none | — | `HealthController.getPaymentHealth` | `subdomains/core/monitoring/health.controller.ts` |
| GET | 1 |  | `/history` | public | whole rows | 1363 | `HistoryController.getHistory` | `subdomains/core/history/controllers/history.controller.ts` |
| GET | 1 |  | `/history/:exportType` | hidden | whole rows | 1363 | `HistoryController.getApiHistory` | `subdomains/core/history/controllers/history.controller.ts` |
| GET | 1 |  | `/history/csv` | hidden | none | — | `HistoryController.getCsv` | `subdomains/core/history/controllers/history.controller.ts` |
| POST | 1 |  | `/history/csv` | public | whole rows | 1363 | `HistoryController.createCsv` | `subdomains/core/history/controllers/history.controller.ts` |
| GET | 1 |  | `/ikna/bfs/:id` | hidden | none | — | `IknaController.getBfsResult` | `integration/ikna/controllers/ikna.controller.ts` |
| POST | 1 |  | `/ikna/bfs/address` | public | none | — | `IknaController.createBfsAddressRequest` | `integration/ikna/controllers/ikna.controller.ts` |
| GET | 1 |  | `/ikna/tag` | hidden | none | — | `IknaController.getIknaAddressTag` | `integration/ikna/controllers/ikna.controller.ts` |
| GET | 1 |  | `/juice/info` | public | whole rows | 11 | `JuiceController.getInfo` | `integration/blockchain/juice/controllers/juice.controller.ts` |
| GET | 1 | yes | `/kyc` | public | whole rows | 351 | `KycController.getKycProgressV1` | `subdomains/generic/user/models/kyc/kyc.controller.ts` |
| GET | 2 |  | `/kyc` | public | whole rows | 351 | `KycController.getKycLevel` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| POST | 1 | yes | `/kyc` | public | whole rows | 351 | `KycController.requestKycV1` | `subdomains/generic/user/models/kyc/kyc.controller.ts` |
| PUT | 2 |  | `/kyc` | public | whole rows | 364 | `KycController.continueKyc` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| GET | 2 |  | `/kyc/2fa` | public | whole rows | 253 | `KycController.check2fa` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| POST | 2 |  | `/kyc/2fa` | public | whole rows | 253 | `KycController.start2fa` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| POST | 2 |  | `/kyc/2fa/verify` | public | whole rows | 253 | `KycController.verify2fa` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| GET | 1 | yes | `/kyc/:code` | public | whole rows | 351 | `KycController.getKycProgressByCodeV1` | `subdomains/generic/user/models/kyc/kyc.controller.ts` |
| POST | 1 | yes | `/kyc/:code` | public | whole rows | 351 | `KycController.requestKycByCodeV1` | `subdomains/generic/user/models/kyc/kyc.controller.ts` |
| GET | 1 | yes | `/kyc/:code/countries` | public | whole rows | 351 | `KycController.getKycCountriesByCodeV1` | `subdomains/generic/user/models/kyc/kyc.controller.ts` |
| GET | 1 | yes | `/kyc/:id/documents` | public | whole rows | 328 | `KycClientController.getKycFilesV1` | `subdomains/generic/user/models/kyc/kyc.controller.ts` |
| GET | 1 | yes | `/kyc/:id/documents/:type` | public | whole rows | 328 | `KycClientController.getKycFileV1` | `subdomains/generic/user/models/kyc/kyc.controller.ts` |
| GET | 2 |  | `/kyc/:step` | public | whole rows | 364 | `KycController.initiateStep` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| DELETE | 1 |  | `/kyc/admin/blacklist/ip` | hidden | none | — | `KycAdminController.deleteIpToBlacklist` | `subdomains/generic/kyc/controllers/kyc-admin.controller.ts` |
| PUT | 1 |  | `/kyc/admin/blacklist/ip` | hidden | whole rows | 12 | `KycAdminController.addIpToBlacklist` | `subdomains/generic/kyc/controllers/kyc-admin.controller.ts` |
| POST | 1 |  | `/kyc/admin/ident/file/sync` | hidden | whole rows | 243 | `KycAdminController.syncIdentFiles` | `subdomains/generic/kyc/controllers/kyc-admin.controller.ts` |
| POST | 1 |  | `/kyc/admin/log` | hidden | whole rows | 253 | `KycAdminController.createLog` | `subdomains/generic/kyc/controllers/kyc-admin.controller.ts` |
| PUT | 1 |  | `/kyc/admin/log/:id` | hidden | whole rows | 17 | `KycAdminController.updateLog` | `subdomains/generic/kyc/controllers/kyc-admin.controller.ts` |
| PUT | 1 |  | `/kyc/admin/nameCheck/:id` | public | whole rows | 245 | `KycAdminController.updateNameCheckLog` | `subdomains/generic/kyc/controllers/kyc-admin.controller.ts` |
| PUT | 1 |  | `/kyc/admin/step/:id` | hidden | whole rows | 385 | `KycAdminController.updateKycStep` | `subdomains/generic/kyc/controllers/kyc-admin.controller.ts` |
| POST | 1 |  | `/kyc/admin/webhook` | hidden | whole rows | 364 | `KycAdminController.triggerWebhook` | `subdomains/generic/kyc/controllers/kyc-admin.controller.ts` |
| GET | 2 |  | `/kyc/client/payments` | public | whole rows | 1092 | `KycClientController.getAllPayments` | `subdomains/generic/kyc/controllers/kyc-client.controller.ts` |
| GET | 2 |  | `/kyc/client/users` | public | whole rows | 20 | `KycClientController.getAllKycData` | `subdomains/generic/kyc/controllers/kyc-client.controller.ts` |
| GET | 2 |  | `/kyc/client/users/:id/documents` | public | whole rows | 78 | `KycClientController.getKycFiles` | `subdomains/generic/kyc/controllers/kyc-client.controller.ts` |
| GET | 2 |  | `/kyc/client/users/:id/documents/:type` | public | whole rows | 78 | `KycClientController.getKycFile` | `subdomains/generic/kyc/controllers/kyc-client.controller.ts` |
| GET | 2 |  | `/kyc/client/users/:id/payments` | public | whole rows | 1092 | `KycClientController.getUserPayments` | `subdomains/generic/kyc/controllers/kyc-client.controller.ts` |
| GET | 1 | yes | `/kyc/countries` | public | whole rows | 351 | `KycController.getKycCountriesV1` | `subdomains/generic/user/models/kyc/kyc.controller.ts` |
| GET | 2 | yes | `/kyc/countries` | public | whole rows | 351 | `KycController.getKycCountries` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| DELETE | 2 |  | `/kyc/data/:type/:id` | hidden | whole rows | 351 | `KycController.cancelStep` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | 2 |  | `/kyc/data/additional/:id` | public | whole rows | 364 | `KycController.updateAdditionalDocumentsData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | 2 |  | `/kyc/data/address/:id` | public | whole rows | 364 | `KycController.updateAddressChangeData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | 2 |  | `/kyc/data/authority/:id` | public | whole rows | 364 | `KycController.updateAuthorityData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | 2 |  | `/kyc/data/beneficial/:id` | public | whole rows | 364 | `KycController.updateBeneficialData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | 2 |  | `/kyc/data/confirmation/:id` | public | whole rows | 364 | `KycController.updateSoleProprietorshipConfirmationData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | 2 |  | `/kyc/data/contact/:id` | hidden | whole rows | 364 | `KycController.updateContactData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| GET | 2 |  | `/kyc/data/financial/:id` | public | whole rows | 351 | `KycController.getFinancialData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | 2 |  | `/kyc/data/financial/:id` | public | whole rows | 364 | `KycController.updateFinancialData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | 2 |  | `/kyc/data/legal/:id` | public | whole rows | 364 | `KycController.updateCommercialRegisterData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | 2 |  | `/kyc/data/name/:id` | public | whole rows | 364 | `KycController.updateNameChangeData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | 2 |  | `/kyc/data/nationality/:id` | public | whole rows | 364 | `KycController.updateNationalityData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | 2 |  | `/kyc/data/operational/:id` | public | whole rows | 364 | `KycController.updateOperationalData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | 2 |  | `/kyc/data/owner/:id` | public | whole rows | 364 | `KycController.updateOwnerDirectoryData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | 2 |  | `/kyc/data/payment/:id` | public | whole rows | 364 | `KycController.updatePaymentsData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | 2 |  | `/kyc/data/personal/:id` | public | whole rows | 364 | `KycController.updatePersonalData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | 2 |  | `/kyc/data/phone/:id` | public | whole rows | 364 | `KycController.updatePhoneChangeData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | 2 |  | `/kyc/data/recall/:id` | public | whole rows | 364 | `KycController.updateRecallAgreement` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | 2 |  | `/kyc/data/recommendation/:id` | public | whole rows | 643 | `KycController.updateRecommendationData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | 2 |  | `/kyc/data/residence/:id` | public | whole rows | 364 | `KycController.updateResidencePermitData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | 2 |  | `/kyc/data/signatory/:id` | public | whole rows | 364 | `KycController.updateSignatoryPowerData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | 2 |  | `/kyc/data/statutes/:id` | public | whole rows | 364 | `KycController.updateStatutesData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| GET | 2 |  | `/kyc/file/:id` | hidden | whole rows | 264 | `KycController.getFile` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | 2 |  | `/kyc/ident/manual/:id` | hidden | whole rows | 364 | `KycController.updateIdentData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| POST | 2 |  | `/kyc/ident/sumsub` | public | whole rows | 364 | `KycController.sumsubWebhook` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| DELETE | 2 |  | `/kyc/transfer` | hidden | whole rows | 351 | `KycController.removeKycClient` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| POST | 2 |  | `/kyc/transfer` | hidden | whole rows | 364 | `KycController.addKycClient` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | 1 | yes | `/kyc/transfer` | public | whole rows | 364 | `KycController.transferKycDataV1` | `subdomains/generic/user/models/kyc/kyc.controller.ts` |
| GET | 1 | yes | `/kyc/users` | public | whole rows | 328 | `KycClientController.getAllKycDataV1` | `subdomains/generic/user/models/kyc/kyc.controller.ts` |
| GET | 1 |  | `/language` | public | whole rows | 7 | `LanguageController.getAllLanguage` | `shared/models/language/language.controller.ts` |
| PUT | 1 |  | `/limitRequest/:id` | public | whole rows | 434 | `LimitRequestController.updateUserData` | `subdomains/supporting/support-issue/limit-request.controller.ts` |
| GET | 1 |  | `/liquidityManagement/balance` | public | whole rows | 40 | `LiquidityBalanceController.getBalances` | `subdomains/core/liquidity-management/controllers/balance.controller.ts` |
| PUT | 1 |  | `/liquidityManagement/order/:id/resolveUncertain` | hidden | whole rows | 139 | `LiquidityManagementOrderController.resolveUncertainOrder` | `subdomains/core/liquidity-management/controllers/order.controller.ts` |
| GET | 1 |  | `/liquidityManagement/order/in-progress` | public | whole rows | 139 | `LiquidityManagementOrderController.getProcessingOrders` | `subdomains/core/liquidity-management/controllers/order.controller.ts` |
| GET | 1 |  | `/liquidityManagement/pipeline/:id/status` | hidden | whole rows | 112 | `LiquidityManagementPipelineController.getPipelineStatus` | `subdomains/core/liquidity-management/controllers/pipeline.controller.ts` |
| POST | 1 |  | `/liquidityManagement/pipeline/buy` | public | whole rows | 112 | `LiquidityManagementPipelineController.buyLiquidity` | `subdomains/core/liquidity-management/controllers/pipeline.controller.ts` |
| GET | 1 |  | `/liquidityManagement/pipeline/in-progress` | hidden | whole rows | 112 | `LiquidityManagementPipelineController.getProcessingPipelines` | `subdomains/core/liquidity-management/controllers/pipeline.controller.ts` |
| POST | 1 |  | `/liquidityManagement/pipeline/sell` | hidden | whole rows | 112 | `LiquidityManagementPipelineController.sellLiquidity` | `subdomains/core/liquidity-management/controllers/pipeline.controller.ts` |
| GET | 1 |  | `/liquidityManagement/pipeline/stopped` | hidden | whole rows | 112 | `LiquidityManagementPipelineController.getStoppedPipelines` | `subdomains/core/liquidity-management/controllers/pipeline.controller.ts` |
| POST | 1 |  | `/liquidityManagement/rule` | public | whole rows | 83 | `LiquidityManagementRuleController.createRule` | `subdomains/core/liquidity-management/controllers/rule.controller.ts` |
| GET | 1 |  | `/liquidityManagement/rule/:id` | hidden | whole rows | 83 | `LiquidityManagementRuleController.getRule` | `subdomains/core/liquidity-management/controllers/rule.controller.ts` |
| PUT | 1 |  | `/liquidityManagement/rule/:id` | hidden | whole rows | 83 | `LiquidityManagementRuleController.updateRule` | `subdomains/core/liquidity-management/controllers/rule.controller.ts` |
| PATCH | 1 |  | `/liquidityManagement/rule/:id/deactivate` | hidden | whole rows | 83 | `LiquidityManagementRuleController.deactivateRule` | `subdomains/core/liquidity-management/controllers/rule.controller.ts` |
| PATCH | 1 |  | `/liquidityManagement/rule/:id/reactivate` | hidden | whole rows | 83 | `LiquidityManagementRuleController.reactivateRule` | `subdomains/core/liquidity-management/controllers/rule.controller.ts` |
| PATCH | 1 |  | `/liquidityManagement/rule/:id/settings` | hidden | whole rows | 83 | `LiquidityManagementRuleController.setReactivationTime` | `subdomains/core/liquidity-management/controllers/rule.controller.ts` |
| GET | 1 |  | `/lnurla` | public | whole rows | 643 | `AuthLnurlController.signInWithLnurlAuth` | `subdomains/generic/user/models/auth/auth-lnurl.controller.ts` |
| POST | 1 |  | `/lnurla` | public | none | — | `AuthLnurlController.getLnurlAuth` | `subdomains/generic/user/models/auth/auth-lnurl.controller.ts` |
| GET | 1 |  | `/lnurla/status` | public | none | — | `AuthLnurlController.lnurlAuthStatus` | `subdomains/generic/user/models/auth/auth-lnurl.controller.ts` |
| GET | 1 |  | `/lnurld/:id` | public | none | — | `LnurldForwardController.lnurldForward` | `subdomains/generic/forwarding/controllers/lnurld-forward.controller.ts` |
| GET | 1 |  | `/lnurld/cb/:id/:var` | public | none | — | `LnurldForwardController.lnurldCallbackForward` | `subdomains/generic/forwarding/controllers/lnurld-forward.controller.ts` |
| GET | 1 |  | `/lnurlp/:id` | public | whole rows | 545 | `LnUrlPForwardController.lnUrlPForward` | `subdomains/generic/forwarding/controllers/lnurlp-forward.controller.ts` |
| POST | 1 |  | `/lnurlp/:id` | public | whole rows | 545 | `LnUrlPForwardController.activatePublicPayment` | `subdomains/generic/forwarding/controllers/lnurlp-forward.controller.ts` |
| DELETE | 1 |  | `/lnurlp/cancel/:id` | public | whole rows | 545 | `LnUrlPForwardController.cancelPayment` | `subdomains/generic/forwarding/controllers/lnurlp-forward.controller.ts` |
| GET | 1 |  | `/lnurlp/cb/:id` | public | whole rows | 545 | `LnUrlPForwardController.lnUrlPCallbackForward` | `subdomains/generic/forwarding/controllers/lnurlp-forward.controller.ts` |
| GET | 1 |  | `/lnurlp/tx/:id` | public | whole rows | 545 | `LnUrlPForwardController.txHexForward` | `subdomains/generic/forwarding/controllers/lnurlp-forward.controller.ts` |
| GET | 1 |  | `/lnurlp/wait/:id` | public | whole rows | 545 | `LnUrlPForwardController.waitForPayment` | `subdomains/generic/forwarding/controllers/lnurlp-forward.controller.ts` |
| GET | 1 |  | `/lnurlw/:id` | public | none | — | `LnUrlWForwardController.lnUrlWForward` | `subdomains/generic/forwarding/controllers/lnurlw-forward.controller.ts` |
| GET | 1 |  | `/lnurlw/cb/:id` | public | none | — | `LnUrlWForwardController.lnUrlWCallbackForward` | `subdomains/generic/forwarding/controllers/lnurlw-forward.controller.ts` |
| POST | 1 |  | `/log` | public | whole rows | 11 | `LogController.create` | `subdomains/supporting/log/log.controller.ts` |
| PUT | 1 |  | `/log/:id` | hidden | whole rows | 11 | `LogController.update` | `subdomains/supporting/log/log.controller.ts` |
| PUT | 1 |  | `/log/financial/validity` | hidden | projected | 11 | `LogController.setFinancialLogValidity` | `subdomains/supporting/log/log.controller.ts` |
| GET | 1 |  | `/monitoring/data` | public | none | — | `MonitoringController.getSystemState` | `subdomains/core/monitoring/monitoring.controller.ts` |
| POST | 1 |  | `/monitoring/data` | hidden | none | — | `MonitoringController.onWebhook` | `subdomains/core/monitoring/monitoring.controller.ts` |
| GET | 1 |  | `/mros` | hidden | whole rows | 243 | `MrosController.getAll` | `subdomains/supporting/mros/mros.controller.ts` |
| POST | 1 |  | `/mros` | public | whole rows | 253 | `MrosController.createMros` | `subdomains/supporting/mros/mros.controller.ts` |
| GET | 1 |  | `/mros/:id` | hidden | whole rows | 243 | `MrosController.getById` | `subdomains/supporting/mros/mros.controller.ts` |
| PUT | 1 |  | `/mros/:id` | hidden | whole rows | 98 | `MrosController.updateMros` | `subdomains/supporting/mros/mros.controller.ts` |
| POST | 1 |  | `/node/:node/:mode/cmd` | hidden | none | — | `NodeController.cmdForMode` | `integration/blockchain/bitcoin/node/node.controller.ts` |
| POST | 1 |  | `/node/:node/:mode/rpc` | hidden | none | — | `NodeController.rpcForMode` | `integration/blockchain/bitcoin/node/node.controller.ts` |
| GET | 1 |  | `/node/:node/:mode/tx/:txId` | hidden | none | — | `NodeController.waitForTxForMode` | `integration/blockchain/bitcoin/node/node.controller.ts` |
| POST | 1 |  | `/node/:node/cmd` | hidden | none | — | `NodeController.cmd` | `integration/blockchain/bitcoin/node/node.controller.ts` |
| POST | 1 |  | `/node/:node/rpc` | public | none | — | `NodeController.rpc` | `integration/blockchain/bitcoin/node/node.controller.ts` |
| GET | 1 |  | `/node/:node/tx/:txId` | hidden | none | — | `NodeController.waitForTx` | `integration/blockchain/bitcoin/node/node.controller.ts` |
| POST | 1 |  | `/notification/send-mail` | public | whole rows | 13 | `NotificationController.sendMail` | `subdomains/supporting/notification/notification.controller.ts` |
| POST | 1 |  | `/payIn` | public | whole rows | 545 | `PayInController.createPayIn` | `subdomains/supporting/payin/controllers/payin.controller.ts` |
| POST | 1 |  | `/payIn/lnurlpDeposit/:uniqueId` | public | none | — | `PayInWebhookController.deposit` | `subdomains/supporting/payin/controllers/payin-webhook.controller.ts` |
| POST | 1 |  | `/payIn/lnurlpPayment/:uniqueId` | hidden | none | — | `PayInWebhookController.payment` | `subdomains/supporting/payin/controllers/payin-webhook.controller.ts` |
| POST | 1 |  | `/payIn/poll` | hidden | none | — | `PayInController.pollAddress` | `subdomains/supporting/payin/controllers/payin.controller.ts` |
| POST | 1 |  | `/payIn/retry` | hidden | whole rows | — | `PayInController.retryUncertainSend` | `subdomains/supporting/payin/controllers/payin.controller.ts` |
| GET | 1 |  | `/paymentLink` | public | whole rows | 513 | `PaymentLinkController.getAllPaymentLinks` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| POST | 1 |  | `/paymentLink` | public | whole rows | 545 | `PaymentLinkController.createPaymentLink` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| PUT | 1 |  | `/paymentLink` | public | whole rows | 513 | `PaymentLinkController.updatePaymentLink` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| DELETE | 1 |  | `/paymentLink/:id` | hidden | whole rows | 195 | `PaymentLinkController.deletePaymentLink` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| PUT | 1 |  | `/paymentLink/:id` | hidden | whole rows | 513 | `PaymentLinkController.updatePaymentLinkAdmin` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| PUT | 1 |  | `/paymentLink/:id/pos` | hidden | whole rows | 513 | `PaymentLinkController.createPosLinkAdmin` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| PUT | 1 |  | `/paymentLink/assign` | public | whole rows | 513 | `PaymentLinkController.assignPaymentLink` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| GET | 1 |  | `/paymentLink/config` | public | whole rows | 253 | `PaymentLinkController.getUserPaymentLinksConfig` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| PUT | 1 |  | `/paymentLink/config` | public | whole rows | 253 | `PaymentLinkController.updateUserPaymentLinksConfig` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| GET | 1 |  | `/paymentLink/history` | public | whole rows | 545 | `PaymentLinkController.getPaymentHistory` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| POST | 1 |  | `/paymentLink/integration/binance/activate/:id` | public | whole rows | 513 | `C2BPaymentLinkController.activateBinancePay` | `subdomains/core/payment-link/controllers/c2b-payment-link.controller.ts` |
| POST | 1 |  | `/paymentLink/integration/binance/webhook` | hidden | whole rows | 545 | `C2BPaymentLinkController.binancePayWebhook` | `subdomains/core/payment-link/controllers/c2b-payment-link.controller.ts` |
| POST | 1 |  | `/paymentLink/integration/kucoin/activate/:id` | public | whole rows | 513 | `C2BPaymentLinkController.activateKucoinPay` | `subdomains/core/payment-link/controllers/c2b-payment-link.controller.ts` |
| POST | 1 |  | `/paymentLink/integrations/kucoin/webhook/cancel` ⚠️ | hidden | none | — | `C2BPaymentLinkController.kucoinPayWebhook` | `subdomains/core/payment-link/controllers/c2b-payment-link.controller.ts` |
| POST | 1 |  | `/paymentLink/integrations/kucoin/webhook/success` | hidden | none | — | `C2BPaymentLinkController.kucoinPayWebhook` | `subdomains/core/payment-link/controllers/c2b-payment-link.controller.ts` |
| GET | 1 |  | `/paymentLink/locations` | public | whole rows | 513 | `PaymentLinkController.getLocations` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| POST | 1 |  | `/paymentLink/merchant` | public | whole rows | 253 | `PaymentLinkController.createMerchant` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| DELETE | 1 |  | `/paymentLink/payment` | public | whole rows | 545 | `PaymentLinkController.cancelPayment` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| GET | 1 |  | `/paymentLink/payment` | hidden | whole rows | 545 | `PaymentLinkController.createInvoicePayment` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| POST | 1 |  | `/paymentLink/payment` | public | whole rows | 545 | `PaymentLinkController.createPayment` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| PUT | 1 |  | `/paymentLink/payment/:id` | public | whole rows | 545 | `PaymentLinkController.updatePaymentLinkPayment` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| PUT | 1 |  | `/paymentLink/payment/confirm` | public | whole rows | 513 | `PaymentLinkController.confirmPayment` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| GET | 1 |  | `/paymentLink/payment/wait` | public | whole rows | 513 | `PaymentLinkController.waitForPayment` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| PUT | 1 |  | `/paymentLink/pos` | public | whole rows | 513 | `PaymentLinkController.createPosLink` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| GET | 1 |  | `/paymentLink/recipient` | public | whole rows | 472 | `PaymentLinkController.getPaymentRecipient` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| GET | 1 |  | `/paymentLink/standard` | public | none | — | `PaymentStandardController.getAll` | `subdomains/core/payment-link/controllers/payment-standard.controller.ts` |
| GET | 1 |  | `/paymentLink/standard/:id` | public | none | — | `PaymentStandardController.getById` | `subdomains/core/payment-link/controllers/payment-standard.controller.ts` |
| GET | 1 |  | `/paymentLink/stickers` | hidden | whole rows | 513 | `PaymentLinkController.generateOcpStickers` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| GET | 1 |  | `/paymentLink/walletApp` | public | whole rows | 33 | `WalletAppController.getAll` | `subdomains/core/payment-link/controllers/wallet-app.controller.ts` |
| GET | 1 |  | `/paymentLink/walletApp/:id` | public | whole rows | 33 | `WalletAppController.getById` | `subdomains/core/payment-link/controllers/wallet-app.controller.ts` |
| GET | 1 |  | `/paymentLink/walletApp/recommended` | public | whole rows | 33 | `WalletAppController.getRecommended` | `subdomains/core/payment-link/controllers/wallet-app.controller.ts` |
| POST | 1 |  | `/payout` | public | none | — | `PayoutController.doPayout` | `subdomains/supporting/payout/payout.controller.ts` |
| GET | 1 |  | `/payout/completion` | hidden | whole rows | 123 | `PayoutController.checkOrderCompletion` | `subdomains/supporting/payout/payout.controller.ts` |
| POST | 1 |  | `/payout/retry` | hidden | whole rows | 123 | `PayoutController.retryUncertainPayout` | `subdomains/supporting/payout/payout.controller.ts` |
| POST | 1 |  | `/payout/speedup` | hidden | whole rows | 123 | `PayoutController.speedupTransaction` | `subdomains/supporting/payout/payout.controller.ts` |
| GET | neutral |  | `/pl` | public | whole rows | 545 | `PaymentForwardController.lnUrlPForward` | `subdomains/generic/forwarding/controllers/payment-forward.controller.ts` |
| GET | 1 |  | `/plp` | public | whole rows | 545 | `PaymentLinkShortController.createInvoicePayment` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| GET | 1 |  | `/pricing` | hidden | none | — | `PricingController.getRawPrice` | `subdomains/supporting/pricing/pricing.controller.ts` |
| PUT | 1 |  | `/pricing` | hidden | whole rows | 53 | `PricingController.updatePrices` | `subdomains/supporting/pricing/pricing.controller.ts` |
| GET | 1 |  | `/pricing/price` | public | whole rows | 33 | `PricingController.getPrice` | `subdomains/supporting/pricing/pricing.controller.ts` |
| GET | 1 |  | `/realunit/account/:address` | public | whole rows | 40 | `RealUnitController.getAccountSummary` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | 1 |  | `/realunit/account/:address/history` | public | none | — | `RealUnitController.getAccountHistory` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | 1 |  | `/realunit/admin/quotes` | public | whole rows | 112 | `RealUnitController.getAdminQuotes` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| PUT | 1 |  | `/realunit/admin/quotes/:id/confirm-payment` | hidden | whole rows | 1051 | `RealUnitController.confirmPaymentReceived` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| PUT | 1 |  | `/realunit/admin/registration/:id/forward` | hidden | whole rows | 493 | `RealUnitController.forwardRegistration` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | 1 |  | `/realunit/admin/transactions` | hidden | whole rows | 362 | `RealUnitController.getAdminTransactions` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| POST | 1 |  | `/realunit/balance/pdf` | public | whole rows | 308 | `RealUnitController.getBalancePdf` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | 1 | yes | `/realunit/brokerbot/buyPrice` | public | none | — | `RealUnitController.getBrokerbotBuyPrice` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | 1 | yes | `/realunit/brokerbot/buyShares` | public | none | — | `RealUnitController.getBrokerbotBuyShares` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | 1 | yes | `/realunit/brokerbot/info` | public | whole rows | 33 | `RealUnitController.getBrokerbotInfo` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | 1 | yes | `/realunit/brokerbot/price` | public | none | — | `RealUnitController.getBrokerbotPrice` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | 1 | yes | `/realunit/brokerbot/sellPrice` | public | whole rows | 308 | `RealUnitController.getBrokerbotSellPrice` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | 1 | yes | `/realunit/brokerbot/sellShares` | public | whole rows | 308 | `RealUnitController.getBrokerbotSellShares` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| PUT | 1 |  | `/realunit/buy` | public | whole rows | 364 | `RealUnitController.getPaymentInfo` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| PUT | 1 |  | `/realunit/buy/:id/confirm` | public | whole rows | 504 | `RealUnitController.confirmBuy` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | 1 |  | `/realunit/compliance/customers` | public | whole rows | 308 | `RealUnitComplianceController.searchCustomers` | `subdomains/supporting/realunit/controllers/realunit-compliance.controller.ts` |
| GET | 1 |  | `/realunit/compliance/customers/:id` | hidden | whole rows | 826 | `RealUnitComplianceController.getCustomer` | `subdomains/supporting/realunit/controllers/realunit-compliance.controller.ts` |
| GET | 1 |  | `/realunit/compliance/customers/:id/dossier` | hidden | whole rows | 264 | `RealUnitComplianceController.downloadCustomerDossier` | `subdomains/supporting/realunit/controllers/realunit-compliance.controller.ts` |
| GET | 1 |  | `/realunit/compliance/customers/:id/files` | hidden | whole rows | 264 | `RealUnitComplianceController.getCustomerFiles` | `subdomains/supporting/realunit/controllers/realunit-compliance.controller.ts` |
| GET | 1 |  | `/realunit/compliance/customers/:id/files/:uid` | hidden | whole rows | 264 | `RealUnitComplianceController.downloadCustomerFile` | `subdomains/supporting/realunit/controllers/realunit-compliance.controller.ts` |
| GET | 1 |  | `/realunit/confirm-aktionariat` | public | whole rows | 15 | `RealUnitController.confirmAktionariat` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | 1 |  | `/realunit/holders` | public | none | — | `RealUnitController.getHolders` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | 1 |  | `/realunit/legal` | public | whole rows | 308 | `RealUnitLegalController.getLegal` | `subdomains/supporting/realunit/controllers/realunit-legal.controller.ts` |
| PUT | 1 |  | `/realunit/legal` | public | whole rows | 308 | `RealUnitLegalController.acceptLegal` | `subdomains/supporting/realunit/controllers/realunit-legal.controller.ts` |
| GET | 1 |  | `/realunit/pay/:id/status` | public | whole rows | 32 | `RealUnitController.getOcpPayStatus` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| PUT | 1 |  | `/realunit/pay/submit` | public | whole rows | 545 | `RealUnitController.submitOcpPay` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| PUT | 1 |  | `/realunit/pay/unsigned-transaction` | public | whole rows | 545 | `RealUnitController.getOcpPayUnsignedTransaction` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | 1 |  | `/realunit/price` | public | whole rows | 33 | `RealUnitController.getRealUnitPrice` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | 1 |  | `/realunit/price/history` | public | whole rows | 40 | `RealUnitController.getHistoricalPrice` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | 1 |  | `/realunit/quote/buyPrice` | public | none | — | `RealUnitController.getQuoteBuyPrice` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | 1 |  | `/realunit/quote/buyShares` | public | none | — | `RealUnitController.getQuoteBuyShares` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | 1 |  | `/realunit/quote/info` | public | whole rows | 33 | `RealUnitController.getQuoteInfo` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | 1 |  | `/realunit/quote/price` | public | none | — | `RealUnitController.getQuotePrice` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | 1 |  | `/realunit/quote/sellPrice` | public | whole rows | 308 | `RealUnitController.getQuoteSellPrice` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | 1 |  | `/realunit/quote/sellShares` | public | whole rows | 308 | `RealUnitController.getQuoteSellShares` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| POST | 1 |  | `/realunit/register/complete` | public | whole rows | 493 | `RealUnitController.completeRegistration` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | 1 |  | `/realunit/register/date` | public | none | — | `RealUnitController.getRegistrationDate` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| POST | 1 |  | `/realunit/register/email` | public | whole rows | 364 | `RealUnitController.registerEmail` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | 1 |  | `/realunit/register/status` | public | whole rows | 308 | `RealUnitController.isRegistered` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| POST | 1 |  | `/realunit/register/wallet` | public | whole rows | 493 | `RealUnitController.completeRegistrationForWalletAddress` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | 1 |  | `/realunit/registration` | public | whole rows | 308 | `RealUnitController.getRegistrationInfo` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| PUT | 1 |  | `/realunit/sell` | public | whole rows | 308 | `RealUnitController.getSellPaymentInfo` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| PUT | 1 |  | `/realunit/sell/:id/broadcast` | public | whole rows | 504 | `RealUnitController.broadcastSellTransaction` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| PUT | 1 |  | `/realunit/sell/:id/confirm` | public | whole rows | 504 | `RealUnitController.confirmSell` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| PUT | 1 |  | `/realunit/sell/:id/unsigned-transactions` | public | whole rows | 504 | `RealUnitController.getSellUnsignedTransactions` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| PUT | 1 |  | `/realunit/support/:id` | hidden | whole rows | 421 | `RealUnitSupportController.updateSupportIssue` | `subdomains/supporting/realunit/controllers/realunit-support.controller.ts` |
| GET | 1 |  | `/realunit/support/:id/data` | hidden | whole rows | 951 | `RealUnitSupportController.getIssueData` | `subdomains/supporting/realunit/controllers/realunit-support.controller.ts` |
| POST | 1 |  | `/realunit/support/:id/message` | hidden | whole rows | 441 | `RealUnitSupportController.createSupportMessage` | `subdomains/supporting/realunit/controllers/realunit-support.controller.ts` |
| GET | 1 |  | `/realunit/support/:id/message/:messageId/file` | hidden | whole rows | 421 | `RealUnitSupportController.getFile` | `subdomains/supporting/realunit/controllers/realunit-support.controller.ts` |
| GET | 1 |  | `/realunit/support/:id/messages` | hidden | whole rows | 428 | `RealUnitSupportController.getIssueMessages` | `subdomains/supporting/realunit/controllers/realunit-support.controller.ts` |
| GET | 1 |  | `/realunit/support/activity` | hidden | whole rows | 99 | `RealUnitSupportController.getSupportIssueActivity` | `subdomains/supporting/realunit/controllers/realunit-support.controller.ts` |
| GET | 1 |  | `/realunit/support/clerks` | hidden | none | — | `RealUnitSupportController.getRealUnitSupportClerks` | `subdomains/supporting/realunit/controllers/realunit-support.controller.ts` |
| GET | 1 |  | `/realunit/support/counts` | hidden | whole rows | 99 | `RealUnitSupportController.getSupportIssueCounts` | `subdomains/supporting/realunit/controllers/realunit-support.controller.ts` |
| GET | 1 |  | `/realunit/support/list` | public | whole rows | 99 | `RealUnitSupportController.getSupportIssueList` | `subdomains/supporting/realunit/controllers/realunit-support.controller.ts` |
| GET | 1 |  | `/realunit/support/statistics` | hidden | whole rows | 99 | `RealUnitSupportController.getSupportIssueStatistics` | `subdomains/supporting/realunit/controllers/realunit-support.controller.ts` |
| PUT | 1 |  | `/realunit/swap` | public | whole rows | 308 | `RealUnitController.getSwapPaymentInfo` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| PUT | 1 |  | `/realunit/swap/:id/broadcast` | public | whole rows | 504 | `RealUnitController.broadcastSwapTransaction` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| PUT | 1 |  | `/realunit/swap/:id/unsigned-transaction` | public | whole rows | 504 | `RealUnitController.getSwapUnsignedTransaction` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | 1 |  | `/realunit/tokenInfo` | public | none | — | `RealUnitController.getTokenInfo` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| POST | 1 |  | `/realunit/transactions/receipt/multi` | public | whole rows | 308 | `RealUnitController.generateHistoryMultiReceipt` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| POST | 1 |  | `/realunit/transactions/receipt/single` | public | whole rows | 308 | `RealUnitController.generateHistoryReceipt` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| PUT | 1 |  | `/realunit/transfer` | public | whole rows | 308 | `RealUnitController.prepareTransfer` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| PUT | 1 |  | `/realunit/transfer/:id/confirm` | public | whole rows | 87 | `RealUnitController.confirmTransfer` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | 1 | yes | `/realunit/wallet/status` | public | whole rows | 308 | `RealUnitController.getWalletStatus` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | 1 |  | `/recall` | hidden | whole rows | 174 | `RecallController.getAll` | `subdomains/supporting/recall/recall.controller.ts` |
| POST | 1 |  | `/recall` | public | whole rows | 308 | `RecallController.createRecall` | `subdomains/supporting/recall/recall.controller.ts` |
| GET | 1 |  | `/recall/:id` | hidden | whole rows | 174 | `RecallController.getById` | `subdomains/supporting/recall/recall.controller.ts` |
| PUT | 1 |  | `/recall/:id` | hidden | whole rows | 308 | `RecallController.updateRecall` | `subdomains/supporting/recall/recall.controller.ts` |
| GET | 1 |  | `/recommendation` | public | whole rows | 474 | `RecommendationController.getAllRecommendation` | `subdomains/generic/user/models/recommendation/recommendation.controller.ts` |
| POST | 1 |  | `/recommendation` | hidden | whole rows | 364 | `RecommendationController.createRecommendation` | `subdomains/generic/user/models/recommendation/recommendation.controller.ts` |
| PUT | 1 |  | `/recommendation/:id/confirm` | hidden | whole rows | 643 | `RecommendationController.confirmRecommendation` | `subdomains/generic/user/models/recommendation/recommendation.controller.ts` |
| PUT | 1 |  | `/recommendation/:id/reject` | hidden | whole rows | 643 | `RecommendationController.rejectRecommendation` | `subdomains/generic/user/models/recommendation/recommendation.controller.ts` |
| GET | 1 |  | `/ref` | public | none | — | `RefController.createRef` | `subdomains/core/referral/process/ref.controller.ts` |
| POST | 1 |  | `/reward/ref` | hidden | whole rows | 156 | `RefRewardController.createPendingRefRewards` | `subdomains/core/referral/reward/ref-reward.controller.ts` |
| PUT | 1 |  | `/reward/ref/:id` | hidden | whole rows | 234 | `RefRewardController.updateRefReward` | `subdomains/core/referral/reward/ref-reward.controller.ts` |
| POST | 1 |  | `/reward/ref/manual` | hidden | whole rows | 308 | `RefRewardController.createManualRefReward` | `subdomains/core/referral/reward/ref-reward.controller.ts` |
| PUT | 1 |  | `/reward/ref/volumes` | public | whole rows | 308 | `RefRewardController.updateVolumes` | `subdomains/core/referral/reward/ref-reward.controller.ts` |
| GET | 1 |  | `/route` | public | whole rows | 308 | `RouteController.getAllRoutes` | `subdomains/core/route/route.controller.ts` |
| PUT | 1 |  | `/route/:id` | hidden | whole rows | 174 | `RouteController.updateRoute` | `subdomains/core/route/route.controller.ts` |
| POST | 1 |  | `/scorechain/screening` | public | whole rows | 14 | `ScorechainController.screen` | `integration/scorechain/controllers/scorechain.controller.ts` |
| GET | 1 |  | `/sell` | public | whole rows | 308 | `SellController.getAllSell` | `subdomains/core/sell-crypto/route/sell.controller.ts` |
| POST | 1 |  | `/sell` | hidden | whole rows | 308 | `SellController.createSell` | `subdomains/core/sell-crypto/route/sell.controller.ts` |
| GET | 1 |  | `/sell/:id` | hidden | whole rows | 377 | `SellController.getSell` | `subdomains/core/sell-crypto/route/sell.controller.ts` |
| PUT | 1 |  | `/sell/:id` | public | whole rows | 308 | `SellController.updateSell` | `subdomains/core/sell-crypto/route/sell.controller.ts` |
| GET | 1 |  | `/sell/:id/history` | hidden | whole rows | 470 | `SellController.getSellRouteHistory` | `subdomains/core/sell-crypto/route/sell.controller.ts` |
| PUT | 1 |  | `/sell/paymentInfos` | public | whole rows | 308 | `SellController.createSellWithPaymentInfo` | `subdomains/core/sell-crypto/route/sell.controller.ts` |
| PUT | 1 |  | `/sell/paymentInfos/:id/confirm` | public | whole rows | 545 | `SellController.confirmSell` | `subdomains/core/sell-crypto/route/sell.controller.ts` |
| GET | 1 |  | `/sell/paymentInfos/:id/tx` | public | whole rows | 504 | `SellController.depositTx` | `subdomains/core/sell-crypto/route/sell.controller.ts` |
| PUT | 1 |  | `/sell/quote` | hidden | whole rows | 143 | `SellController.getSellQuote` | `subdomains/core/sell-crypto/route/sell.controller.ts` |
| GET | 1 |  | `/setting` | public | whole rows | 5 | `SettingController.getSettings` | `shared/models/setting/setting.controller.ts` |
| PUT | 1 |  | `/setting/:key` | hidden | whole rows | 5 | `SettingController.updateSetting` | `shared/models/setting/setting.controller.ts` |
| PUT | 1 |  | `/setting/customSignUpFees` | hidden | none | — | `SettingController.updateCustomSignUpFees` | `shared/models/setting/setting.controller.ts` |
| PUT | 1 |  | `/setting/disabledProcesses` | hidden | none | — | `SettingController.updateProcess` | `shared/models/setting/setting.controller.ts` |
| GET | 1 |  | `/setting/infoBanner` | public | none | — | `SettingController.getInfoBanner` | `shared/models/setting/setting.controller.ts` |
| POST | 1 |  | `/specialExternalAccount` | public | whole rows | 7 | `SpecialExternalAccountController.createSpecialExternalAccount` | `subdomains/supporting/payment/controllers/special-external-account.controller.ts` |
| GET | 1 |  | `/statistic` | public | none | — | `StatisticController.getAll` | `subdomains/core/statistic/statistic.controller.ts` |
| GET | 1 |  | `/statistic/status` | public | whole rows | 5 | `StatisticController.getStatus` | `subdomains/core/statistic/statistic.controller.ts` |
| GET | 1 |  | `/statistic/transactions` | public | whole rows | 419 | `StatisticController.getTransactions` | `subdomains/core/statistic/statistic.controller.ts` |
| GET | 1 |  | `/support` | public | whole rows | 593 | `SupportController.searchUserByKey` | `subdomains/generic/support/support.controller.ts` |
| GET | 1 |  | `/support/:id` | hidden | whole rows | 826 | `SupportController.getUserData` | `subdomains/generic/support/support.controller.ts` |
| GET | 1 |  | `/support/:id/ip-log-pdf` | hidden | whole rows | 12 | `SupportController.getIpLogPdf` | `subdomains/generic/support/support.controller.ts` |
| POST | 1 |  | `/support/:id/onboarding-pdf` | hidden | whole rows | 264 | `SupportController.generateOnboardingPdf` | `subdomains/generic/support/support.controller.ts` |
| GET | 1 |  | `/support/:id/scorechain` | hidden | whole rows | 14 | `SupportController.getScorechainScreenings` | `subdomains/generic/support/support.controller.ts` |
| GET | 1 |  | `/support/:id/transaction-pdf` | hidden | whole rows | 826 | `SupportController.getTransactionPdf` | `subdomains/generic/support/support.controller.ts` |
| GET | 1 |  | `/support/call-queues` | hidden | none | — | `SupportController.getCallQueues` | `subdomains/generic/support/support.controller.ts` |
| GET | 1 |  | `/support/call-queues/:queue/items` | hidden | whole rows | 672 | `SupportController.getCallQueueItems` | `subdomains/generic/support/support.controller.ts` |
| GET | 1 |  | `/support/call-queues/clerks` | hidden | none | — | `SupportController.getCallQueueClerks` | `subdomains/generic/support/support.controller.ts` |
| GET | 1 |  | `/support/issue` | public | whole rows | 450 | `SupportIssueController.getIssues` | `subdomains/supporting/support-issue/support-issue.controller.ts` |
| POST | 1 |  | `/support/issue` | public | whole rows | 493 | `SupportIssueController.createIssue` | `subdomains/supporting/support-issue/support-issue.controller.ts` |
| GET | 1 |  | `/support/issue/:id` | hidden | whole rows | 450 | `SupportIssueController.getIssue` | `subdomains/supporting/support-issue/support-issue.controller.ts` |
| PUT | 1 |  | `/support/issue/:id` | public | whole rows | 421 | `SupportIssueController.updateSupportIssue` | `subdomains/supporting/support-issue/support-issue.controller.ts` |
| PUT | 1 |  | `/support/issue/:id/close` | public | whole rows | 450 | `SupportIssueController.closeIssue` | `subdomains/supporting/support-issue/support-issue.controller.ts` |
| GET | 1 |  | `/support/issue/:id/data` | hidden | whole rows | 951 | `SupportIssueController.getIssueData` | `subdomains/supporting/support-issue/support-issue.controller.ts` |
| POST | 1 |  | `/support/issue/:id/message` | hidden | whole rows | 441 | `SupportIssueController.createSupportMessage` | `subdomains/supporting/support-issue/support-issue.controller.ts` |
| GET | 1 |  | `/support/issue/:id/message/:messageId/file` | public | whole rows | — | `SupportIssueController.getFile` | `subdomains/supporting/support-issue/support-issue.controller.ts` |
| GET | 1 |  | `/support/issue/activity` | hidden | whole rows | 7 | `SupportIssueController.getSupportIssueActivity` | `subdomains/supporting/support-issue/support-issue.controller.ts` |
| GET | 1 |  | `/support/issue/clerk` | hidden | none | — | `SupportIssueController.getSupportIssueClerk` | `subdomains/supporting/support-issue/support-issue.controller.ts` |
| GET | 1 |  | `/support/issue/clerks` | hidden | none | — | `SupportIssueController.getSupportIssueClerks` | `subdomains/supporting/support-issue/support-issue.controller.ts` |
| GET | 1 |  | `/support/issue/counts` | hidden | whole rows | 16 | `SupportIssueController.getSupportIssueCounts` | `subdomains/supporting/support-issue/support-issue.controller.ts` |
| POST | 1 |  | `/support/issue/escalation/telegram-bind` | hidden | whole rows | 5 | `SupportIssueController.bindEscalationChat` | `subdomains/supporting/support-issue/support-issue.controller.ts` |
| GET | 1 |  | `/support/issue/escalation/telegram-chats` | hidden | none | — | `SupportIssueController.getEscalationChats` | `subdomains/supporting/support-issue/support-issue.controller.ts` |
| POST | 1 |  | `/support/issue/escalation/telegram-test` | hidden | whole rows | 5 | `SupportIssueController.testEscalationChat` | `subdomains/supporting/support-issue/support-issue.controller.ts` |
| GET | 1 |  | `/support/issue/list` | public | whole rows | 16 | `SupportIssueController.getSupportIssueList` | `subdomains/supporting/support-issue/support-issue.controller.ts` |
| GET | 1 |  | `/support/issue/statistics` | hidden | whole rows | 16 | `SupportIssueController.getSupportIssueStatistics` | `subdomains/supporting/support-issue/support-issue.controller.ts` |
| POST | 1 |  | `/support/issue/support` | public | whole rows | 493 | `SupportIssueController.createIssueBySupport` | `subdomains/supporting/support-issue/support-issue.controller.ts` |
| GET | 1 |  | `/support/kycFileList` | hidden | whole rows | 253 | `SupportController.getKycFileList` | `subdomains/generic/support/support.controller.ts` |
| GET | 1 |  | `/support/kycFileStats` | hidden | whole rows | 99 | `SupportController.getKycFileStats` | `subdomains/generic/support/support.controller.ts` |
| GET | 1 |  | `/support/note` | hidden | whole rows | 9 | `SupportController.getNotes` | `subdomains/generic/support/support.controller.ts` |
| POST | 1 |  | `/support/note` | hidden | whole rows | 253 | `SupportController.createNote` | `subdomains/generic/support/support.controller.ts` |
| DELETE | 1 |  | `/support/note/:id` | hidden | whole rows | 9 | `SupportController.deleteNote` | `subdomains/generic/support/support.controller.ts` |
| PUT | 1 |  | `/support/note/:id` | hidden | whole rows | 239 | `SupportController.updateNote` | `subdomains/generic/support/support.controller.ts` |
| GET | 1 |  | `/support/note/users` | hidden | whole rows | 9 | `SupportController.listNoteUsers` | `subdomains/generic/support/support.controller.ts` |
| GET | 1 |  | `/support/pending-reviews` | hidden | whole rows | 15 | `SupportController.getPendingReviews` | `subdomains/generic/support/support.controller.ts` |
| GET | 1 |  | `/support/pending-reviews/items` | hidden | whole rows | 261 | `SupportController.getPendingReviewItems` | `subdomains/generic/support/support.controller.ts` |
| GET | 1 |  | `/support/pending-transactions` | hidden | whole rows | 672 | `SupportController.getPendingTransactions` | `subdomains/generic/support/support.controller.ts` |
| GET | 1 |  | `/support/recommendation-graph/:id/neighbors` | hidden | whole rows | 474 | `SupportController.getRecommendationGraphNeighbors` | `subdomains/generic/support/support.controller.ts` |
| GET | 1 |  | `/support/template` | hidden | whole rows | 8 | `SupportController.getTemplates` | `subdomains/generic/support/support.controller.ts` |
| POST | 1 |  | `/support/template` | hidden | whole rows | 253 | `SupportController.createTemplate` | `subdomains/generic/support/support.controller.ts` |
| DELETE | 1 |  | `/support/template/:id` | hidden | whole rows | 8 | `SupportController.deleteTemplate` | `subdomains/generic/support/support.controller.ts` |
| PUT | 1 |  | `/support/template/:id` | hidden | whole rows | 8 | `SupportController.updateTemplate` | `subdomains/generic/support/support.controller.ts` |
| GET | 1 |  | `/support/transaction/:id/refund` | hidden | whole rows | 143 | `SupportController.getTransactionRefund` | `subdomains/generic/support/support.controller.ts` |
| PUT | 1 |  | `/support/transaction/:id/refund` | hidden | whole rows | 415 | `SupportController.setTransactionRefund` | `subdomains/generic/support/support.controller.ts` |
| GET | 1 |  | `/support/transactionList` | hidden | whole rows | 20 | `SupportController.getTransactionList` | `subdomains/generic/support/support.controller.ts` |
| GET | 1 |  | `/swap` | public | whole rows | 308 | `SwapController.getAllSwap` | `subdomains/core/buy-crypto/routes/swap/swap.controller.ts` |
| POST | 1 |  | `/swap` | hidden | whole rows | 308 | `SwapController.createSwap` | `subdomains/core/buy-crypto/routes/swap/swap.controller.ts` |
| GET | 1 |  | `/swap/:id` | hidden | whole rows | 308 | `SwapController.getSwap` | `subdomains/core/buy-crypto/routes/swap/swap.controller.ts` |
| PUT | 1 |  | `/swap/:id` | public | whole rows | 396 | `SwapController.updateSwapRoute` | `subdomains/core/buy-crypto/routes/swap/swap.controller.ts` |
| GET | 1 |  | `/swap/:id/history` | hidden | whole rows | 509 | `SwapController.getSwapRouteHistory` | `subdomains/core/buy-crypto/routes/swap/swap.controller.ts` |
| PUT | 1 |  | `/swap/paymentInfos` | public | whole rows | 308 | `SwapController.createSwapWithPaymentInfo` | `subdomains/core/buy-crypto/routes/swap/swap.controller.ts` |
| PUT | 1 |  | `/swap/paymentInfos/:id/confirm` | public | whole rows | 545 | `SwapController.confirmSwap` | `subdomains/core/buy-crypto/routes/swap/swap.controller.ts` |
| GET | 1 |  | `/swap/paymentInfos/:id/tx` | public | whole rows | 504 | `SwapController.depositTx` | `subdomains/core/buy-crypto/routes/swap/swap.controller.ts` |
| PUT | 1 |  | `/swap/quote` | hidden | whole rows | 143 | `SwapController.getSwapQuote` | `subdomains/core/buy-crypto/routes/swap/swap.controller.ts` |
| POST | 1 |  | `/tatum/addressWebhook` | public | none | — | `TatumController.addressWebhook` | `integration/tatum/controllers/tatum.controller.ts` |
| PUT | 1 |  | `/trading/rule/:id` | public | whole rows | 87 | `TradingRuleController.update` | `subdomains/core/trading/controllers/trading-rule.controller.ts` |
| GET | 1 |  | `/transaction` | public | whole rows | 1363 | `TransactionController.getTransactions` | `subdomains/core/history/controllers/transaction.controller.ts` |
| PUT | 1 |  | `/transaction/:id/invoice` | public | whole rows | 331 | `TransactionController.generateInvoiceFromTransaction` | `subdomains/core/history/controllers/transaction.controller.ts` |
| PUT | 1 |  | `/transaction/:id/receipt` | public | whole rows | 331 | `TransactionController.generateReceiptFromTransaction` | `subdomains/core/history/controllers/transaction.controller.ts` |
| GET | 1 |  | `/transaction/:id/refund` | public | whole rows | 331 | `TransactionController.getTransactionRefund` | `subdomains/core/history/controllers/transaction.controller.ts` |
| PUT | 1 |  | `/transaction/:id/refund` | public | whole rows | 487 | `TransactionController.setTransactionRefundTarget` | `subdomains/core/history/controllers/transaction.controller.ts` |
| PUT | 1 |  | `/transaction/:id/target` | hidden | whole rows | 1051 | `TransactionController.setTransactionTarget` | `subdomains/core/history/controllers/transaction.controller.ts` |
| GET | 1 |  | `/transaction/ChainReport` | hidden | whole rows | 1363 | `TransactionController.getCsvChainReport` | `subdomains/core/history/controllers/transaction.controller.ts` |
| GET | 1 |  | `/transaction/CoinTracking` | public | whole rows | 1363 | `TransactionController.getCsvCT` | `subdomains/core/history/controllers/transaction.controller.ts` |
| PUT | 1 |  | `/transaction/admin/:id` | public | whole rows | 276 | `TransactionAdminController.updateTransaction` | `subdomains/supporting/payment/controllers/transaction-admin.controller.ts` |
| POST | 1 |  | `/transaction/admin/:id/stop` | hidden | whole rows | 98 | `TransactionAdminController.stopTransaction` | `subdomains/supporting/payment/controllers/transaction-admin.controller.ts` |
| POST | 1 |  | `/transaction/admin/:txId/riskAssessment` | hidden | none | — | `TransactionAdminController.createRiskAssessment` | `subdomains/supporting/payment/controllers/transaction-admin.controller.ts` |
| PUT | 1 |  | `/transaction/admin/:txId/riskAssessment/:id` | hidden | whole rows | 13 | `TransactionAdminController.updateRiskAssessment` | `subdomains/supporting/payment/controllers/transaction-admin.controller.ts` |
| GET | 1 |  | `/transaction/csv` | public | none | — | `TransactionController.getCsv` | `subdomains/core/history/controllers/transaction.controller.ts` |
| PUT | 1 |  | `/transaction/csv` | public | whole rows | 1363 | `TransactionController.createCsv` | `subdomains/core/history/controllers/transaction.controller.ts` |
| GET | 1 |  | `/transaction/detail` | hidden | whole rows | 1363 | `TransactionController.getTransactionDetails` | `subdomains/core/history/controllers/transaction.controller.ts` |
| PUT | 1 |  | `/transaction/detail/csv` | public | whole rows | 1363 | `TransactionController.createDetailCsv` | `subdomains/core/history/controllers/transaction.controller.ts` |
| GET | 1 |  | `/transaction/detail/single` | public | whole rows | 487 | `TransactionController.getSingleTransactionDetails` | `subdomains/core/history/controllers/transaction.controller.ts` |
| GET | 1 |  | `/transaction/single` | public | whole rows | 487 | `TransactionController.getSingleTransaction` | `subdomains/core/history/controllers/transaction.controller.ts` |
| GET | 1 |  | `/transaction/target` | hidden | whole rows | 134 | `TransactionController.getTransactionTargets` | `subdomains/core/history/controllers/transaction.controller.ts` |
| GET | 1 |  | `/transaction/unassigned` | public | whole rows | 356 | `TransactionController.getUnassignedTransactions` | `subdomains/core/history/controllers/transaction.controller.ts` |
| DELETE | 1 | yes | `/user` | public | whole rows | 344 | `UserController.deleteUser` | `subdomains/generic/user/models/user/user.controller.ts` |
| DELETE | 2 |  | `/user` | public | whole rows | 344 | `UserV2Controller.deleteAccount` | `subdomains/generic/user/models/user/user.controller.ts` |
| GET | 1 | yes | `/user` | public | whole rows | 328 | `UserController.getUserV1` | `subdomains/generic/user/models/user/user.controller.ts` |
| GET | 2 |  | `/user` | public | whole rows | 351 | `UserV2Controller.getUser` | `subdomains/generic/user/models/user/user.controller.ts` |
| PUT | 1 | yes | `/user` | public | whole rows | 406 | `UserController.updateUserV1` | `subdomains/generic/user/models/user/user.controller.ts` |
| PUT | 2 |  | `/user` | public | whole rows | 351 | `UserV2Controller.updateUser` | `subdomains/generic/user/models/user/user.controller.ts` |
| PUT | 1 |  | `/user/:id` | hidden | whole rows | 364 | `UserController.updateUserAdmin` | `subdomains/generic/user/models/user/user.controller.ts` |
| DELETE | 1 | yes | `/user/account` | public | whole rows | 344 | `UserController.deleteUserAccount` | `subdomains/generic/user/models/user/user.controller.ts` |
| DELETE | 2 |  | `/user/addresses/:address` | public | whole rows | 344 | `UserV2Controller.deleteAddress` | `subdomains/generic/user/models/user/user.controller.ts` |
| PUT | 2 |  | `/user/addresses/:address` | public | whole rows | 351 | `UserV2Controller.updateAddress` | `subdomains/generic/user/models/user/user.controller.ts` |
| PUT | 1 |  | `/user/apiFilter/CT` | public | whole rows | 331 | `UserController.updateApiFilter` | `subdomains/generic/user/models/user/user.controller.ts` |
| DELETE | 1 |  | `/user/apiKey/CT` | public | none | — | `UserController.deleteApiKey` | `subdomains/generic/user/models/user/user.controller.ts` |
| POST | 1 |  | `/user/apiKey/CT` | public | whole rows | 253 | `UserController.createApiKey` | `subdomains/generic/user/models/user/user.controller.ts` |
| POST | 1 |  | `/user/change` | public | whole rows | 643 | `UserController.changeUser` | `subdomains/generic/user/models/user/user.controller.ts` |
| POST | 1 |  | `/user/data` | hidden | whole rows | 406 | `UserController.updateKycData` | `subdomains/generic/user/models/user/user.controller.ts` |
| GET | 1 | yes | `/user/detail` | public | whole rows | 328 | `UserController.getUserDetailV1` | `subdomains/generic/user/models/user/user.controller.ts` |
| PUT | 1 | yes | `/user/discountCodes` | public | whole rows | 308 | `UserController.addDiscountCode` | `subdomains/generic/user/models/user/user.controller.ts` |
| PUT | 2 |  | `/user/mail` | public | whole rows | 364 | `UserV2Controller.updateUserMail` | `subdomains/generic/user/models/user/user.controller.ts` |
| POST | 2 |  | `/user/mail/verify` | public | whole rows | 364 | `UserV2Controller.verifyMail` | `subdomains/generic/user/models/user/user.controller.ts` |
| PUT | 1 |  | `/user/name` | public | whole rows | 386 | `UserController.updateUserName` | `subdomains/generic/user/models/user/user.controller.ts` |
| GET | 2 |  | `/user/profile` | public | whole rows | 253 | `UserV2Controller.getProfile` | `subdomains/generic/user/models/user/user.controller.ts` |
| GET | 1 |  | `/user/ref` | public | whole rows | 45 | `UserController.getRefInfo` | `subdomains/generic/user/models/user/user.controller.ts` |
| GET | 2 |  | `/user/ref` | public | whole rows | 98 | `UserV2Controller.getRef` | `subdomains/generic/user/models/user/user.controller.ts` |
| PUT | 2 |  | `/user/ref` | public | whole rows | 98 | `UserV2Controller.updateRefAsset` | `subdomains/generic/user/models/user/user.controller.ts` |
| PUT | 1 |  | `/user/specialCodes` | public | whole rows | 308 | `UserController.addSpecialCode` | `subdomains/generic/user/models/user/user.controller.ts` |
| GET | 1 |  | `/user/volumes` | hidden | whole rows | 45 | `UserController.getVolumes` | `subdomains/generic/user/models/user/user.controller.ts` |
| GET | 1 |  | `/userData` | public | whole rows | 253 | `UserDataController.getAllUserData` | `subdomains/generic/user/models/user-data/user-data.controller.ts` |
| POST | 1 |  | `/userData` | hidden | whole rows | 253 | `UserDataController.createEmptyUserData` | `subdomains/generic/user/models/user-data/user-data.controller.ts` |
| GET | 1 |  | `/userData/:id` | public | whole rows | 253 | `UserDataController.getUserData` | `subdomains/generic/user/models/user-data/user-data.controller.ts` |
| PUT | 1 |  | `/userData/:id` | hidden | whole rows | 384 | `UserDataController.updateUserData` | `subdomains/generic/user/models/user-data/user-data.controller.ts` |
| PUT | 1 |  | `/userData/:id/bankDatas` | hidden | whole rows | 284 | `UserDataController.addBankData` | `subdomains/generic/user/models/user-data/user-data.controller.ts` |
| DELETE | 1 |  | `/userData/:id/fee` | hidden | whole rows | 253 | `UserDataController.removeFee` | `subdomains/generic/user/models/user-data/user-data.controller.ts` |
| PUT | 1 |  | `/userData/:id/fee` | hidden | whole rows | 253 | `UserDataController.addFee` | `subdomains/generic/user/models/user-data/user-data.controller.ts` |
| POST | 1 |  | `/userData/:id/kycFile` | hidden | whole rows | 253 | `UserDataController.uploadKycFile` | `subdomains/generic/user/models/user-data/user-data.controller.ts` |
| PUT | 1 |  | `/userData/:id/merge` | hidden | whole rows | 364 | `UserDataController.mergeUserData` | `subdomains/generic/user/models/user-data/user-data.controller.ts` |
| PUT | 1 |  | `/userData/:id/volumes` | hidden | whole rows | — | `UserDataController.updateVolumes` | `subdomains/generic/user/models/user-data/user-data.controller.ts` |
| PUT | 1 |  | `/userData/auditPeriodNumbers` | hidden | whole rows | 40 | `UserDataController.calculateAuditPeriodNumbers` | `subdomains/generic/user/models/user-data/user-data.controller.ts` |
| POST | 1 |  | `/userData/download` | public | whole rows | 253 | `UserDataController.downloadUserData` | `subdomains/generic/user/models/user-data/user-data.controller.ts` |
| POST | 1 |  | `/userDataRelation` | public | whole rows | 253 | `UserDataRelationController.create` | `subdomains/generic/user/models/user-data-relation/user-data-relation.controller.ts` |
| DELETE | 1 |  | `/userDataRelation/:id` | public | none | — | `UserDataRelationController.delete` | `subdomains/generic/user/models/user-data-relation/user-data-relation.controller.ts` |
| PUT | 1 |  | `/userDataRelation/:id` | public | whole rows | 7 | `UserDataRelationController.update` | `subdomains/generic/user/models/user-data-relation/user-data-relation.controller.ts` |
| GET | neutral |  | `/version` | hidden | none | — | `AppController.getVersion` | `app.controller.ts` |
| POST | 1 |  | `/wallet` | public | none | — | `WalletController.createWallet` | `subdomains/generic/user/models/wallet/wallet.controller.ts` |
| PUT | 1 |  | `/wallet/:id` | hidden | whole rows | 20 | `WalletController.updateWallet` | `subdomains/generic/user/models/wallet/wallet.controller.ts` |

⚠️ = not registered at runtime, see *Known discrepancy* above.
