# HTTP endpoints

Every HTTP endpoint this service exposes: **533 handlers** across 93 controller files. 223 are marked `@ApiExcludeEndpoint` and do not appear in the public Swagger schema.

## Columns

| Column | Meaning |
| ------ | ------- |
| **Swagger** | `public` — in the Swagger schema; `hidden` — carries `@ApiExcludeEndpoint` |
| **Load** | How the endpoint reaches its data. `eager` — through `find`/`findOne` on a repository, which pulls in TypeORM's automatic eager relations; `projected` — through `createQueryBuilder` with an explicit field list or raw SQL, which does not; `none` — no database access at all. Every endpoint is classified; there are no unknowns. |
| **Cols** | Columns the query actually selects, measured from the TypeORM metadata (largest load site reachable from the handler) |
| **Fields** | Fields of the response DTO, nested DTOs included |
| **Ratio** | Cols ÷ Fields — how much is loaded per field returned |

`n/a` means the column does not apply — an endpoint returning `void` has no field count. `—` means the value could not be determined statically, **not** that it is zero. See *Coverage* below.

## Why this list exists

`Load = eager` marks the endpoints that load whole object graphs instead of the fields they return. TypeORM expands eager relations recursively, so a plain `findOne()` on `UserData` already selects 253 columns across 8 joins, and one on `LimitRequest` selects 434 across 15 — before any `relations` option is added. Endpoints reached only through a query builder with an explicit field list do not have that property.

The `Ratio` column quantifies it where both sides are known. It is the basis for deciding which read paths are worth converting to explicit projections.

[read-path-projections.md](read-path-projections.md) explains the background, the criteria for converting an endpoint, and how the result is tested.

## Which endpoints the test definition applies to

The four test levels in [read-path-projections.md](read-path-projections.md) exist to prove that a projection loads every field the response needs. They therefore apply to exactly one group: the **27 endpoints marked `projected`** — those already select an explicit field list, so a forgotten field would silently yield an empty value.

They do **not** apply to the 211 endpoints marked `none`: without a database access there is no field list that could be incomplete. And they do not yet apply to the 295 marked `eager` — those load everything anyway, so nothing can be missing. They become subject to the tests at the moment they are converted.

## How the values are produced

- **Endpoints** — from the routing decorators in `src/**/*.controller.ts`, each attributed to the `@Controller` scope preceding it. Four files declare two controller classes with different base paths, one declares `@Controller()` without an argument. Cross-checked in both directions against the routes the framework registers at startup: all 526 distinct method/path pairs match.
- **Load** — from the call chain between handler and repository (up to ten levels). The rule is mechanical: eager relations apply to the `find*` family, not to `createQueryBuilder` or raw SQL.
- **Cols** — measured against the real entity metadata: the query is built and its SELECT list counted. Not an estimate.
- **Fields** — field count of the declared response DTO, nested DTOs resolved recursively.

## Coverage

| | Endpoints | Share |
| --- | --- | --- |
| `eager` — loads object graphs | 295 | 55 % |
| `projected` — explicit field list or raw SQL | 27 | 5 % |
| `none` — no database access | 211 | 40 % |
| unclassified | 0 | 0 % |
| Column count measured | 295 | 55 % |
| Field count known | 220 | 41 % |
| — returns `void`, no fields to count | 113 | 21 % |
| — returns no DTO (entity, string, record) | 172 | 32 % |
| — genuinely unrecognised | 28 | 5 % |
| Both, so `Ratio` available | 134 | 25 % |

Most blanks in **Fields** are not measurement gaps: an endpoint returning `void` has nothing to count, and one returning an entity or a raw type has no declared field set. Only 28 are genuinely unrecognised. Those show `—`, the others `n/a`.

`Eager = ?` is a real limit: a call somewhere in the chain could not be attributed, typically a method reached through inheritance or a dynamically chosen target. A missing `Cols` means no load site was attributable to the handler.

Where both sides are known, the median ratio is **16×** — 14 endpoints exceed 100×.

## Known discrepancy

`POST /paymentLink/integrations/kucoin/webhook/cancel` appears in the source but is **not registered at runtime**: its handler in `c2b-payment-link.controller.ts` carries two `@Post` decorators, and the framework stores a single path per handler, so only `.../webhook/success` takes effect. Listed below for completeness and marked accordingly.

## Endpoints

| Method | Path | Swagger | Load | Cols | Fields | Ratio | Handler | File |
| ------ | ---- | ------- | ----- | ---: | -----: | ----: | ------- | ---- |
| GET | `/` | public | none | — | n/a | n/a | `AppController.home` | `app.controller.ts` |
| POST | `/CustodyProvider` | public | none | — | n/a | n/a | `CustodyProviderController.createCustodyProvider` | `subdomains/generic/user/models/custody-provider/custody-provider.controller.ts` |
| PUT | `/CustodyProvider/:id` | hidden | eager | 6 | n/a | n/a | `CustodyProviderController.updateCustodyProvider` | `subdomains/generic/user/models/custody-provider/custody-provider.controller.ts` |
| POST | `/admin/lightning/rotate-webhook-secrets` | hidden | none | — | n/a | n/a | `AdminController.rotateLightningWebhookSecrets` | `subdomains/generic/admin/admin.controller.ts` |
| POST | `/admin/mail` | public | none | — | n/a | n/a | `AdminController.sendMail` | `subdomains/generic/admin/admin.controller.ts` |
| POST | `/admin/payout` | hidden | eager | 156 | n/a | n/a | `AdminController.payout` | `subdomains/generic/admin/admin.controller.ts` |
| POST | `/admin/sendLetter` | hidden | none | — | n/a | n/a | `AdminController.sendLetter` | `subdomains/generic/admin/admin.controller.ts` |
| POST | `/alchemy/addressWebhook` | public | none | — | n/a | n/a | `AlchemyController.addressWebhook` | `integration/alchemy/controllers/alchemy.controller.ts` |
| GET | `/alchemy/addresses/:webhookId` | public | none | — | n/a | n/a | `AlchemyController.addresses` | `integration/alchemy/controllers/alchemy.controller.ts` |
| GET | `/app` | public | eager | 6 | n/a | n/a | `AppController.createRefNew` | `app.controller.ts` |
| GET | `/app/:app` | hidden | eager | 6 | n/a | n/a | `AppController.redirectToStore` | `app.controller.ts` |
| GET | `/app/advertisements` | hidden | none | — | — | — | `AppController.getAds` | `app.controller.ts` |
| GET | `/app/announcements` | public | none | — | 3 | — | `AppController.getAnnouncements` | `app.controller.ts` |
| GET | `/app/settings/flags` | hidden | none | — | 7 | — | `AppController.getFlags` | `app.controller.ts` |
| GET | `/asset` | public | projected | — | 3 | — | `AssetController.getAllAsset` | `shared/models/asset/asset.controller.ts` |
| PUT | `/asset/:id` | public | eager | 33 | n/a | n/a | `AssetController.updateAsset` | `shared/models/asset/asset.controller.ts` |
| POST | `/auth` | public | eager | 78 | 1 | 78× | `AuthController.authenticate` | `subdomains/generic/user/models/auth/auth.controller.ts` |
| GET | `/auth/2fa` | hidden | eager | 253 | n/a | n/a | `AuthController.check2fa` | `subdomains/generic/user/models/auth/auth.controller.ts` |
| POST | `/auth/2fa` | public | eager | 253 | 3 | 84× | `AuthController.setup2fa` | `subdomains/generic/user/models/auth/auth.controller.ts` |
| POST | `/auth/2fa/verify` | public | eager | 253 | n/a | n/a | `AuthController.verify2fa` | `subdomains/generic/user/models/auth/auth.controller.ts` |
| GET | `/auth/alby` | hidden | none | — | — | — | `AuthController.signInWithAlby` | `subdomains/generic/user/models/auth/auth.controller.ts` |
| GET | `/auth/alby/redirect/:id` | hidden | eager | 78 | — | — | `AuthController.redirectAlby` | `subdomains/generic/user/models/auth/auth.controller.ts` |
| GET | `/auth/challenge` | hidden | eager | 20 | 1 | 20× | `AuthController.companyChallenge` | `subdomains/generic/user/models/auth/auth.controller.ts` |
| POST | `/auth/mail` | hidden | eager | 20 | n/a | n/a | `AuthController.signInByMail` | `subdomains/generic/user/models/auth/auth.controller.ts` |
| GET | `/auth/mail/confirm` | public | eager | 470 | 2 | 235× | `AuthController.executeMerge` | `subdomains/generic/user/models/auth/auth.controller.ts` |
| GET | `/auth/mail/redirect` | hidden | eager | 253 | 1 | 253× | `AuthController.redirectMail` | `subdomains/generic/user/models/auth/auth.controller.ts` |
| POST | `/auth/signIn` | hidden | eager | 78 | 1 | 78× | `AuthController.signIn` | `subdomains/generic/user/models/auth/auth.controller.ts` |
| GET | `/auth/signMessage` | public | none | — | 2 | — | `AuthController.getSignMessage` | `subdomains/generic/user/models/auth/auth.controller.ts` |
| POST | `/auth/signUp` | public | eager | 78 | 1 | 78× | `AuthController.signUp` | `subdomains/generic/user/models/auth/auth.controller.ts` |
| GET | `/auth/verifySignature` | public | eager | 6 | 1 | 6× | `AuthController.verifySignMessage` | `subdomains/generic/user/models/auth/auth.controller.ts` |
| GET | `/balance/pdf` | public | none | — | 1 | — | `BalanceController.getBalancePdf` | `subdomains/supporting/balance/controllers/balance.controller.ts` |
| GET | `/balance/pdf/blockchains` | public | none | — | n/a | n/a | `BalanceController.getSupportedBlockchains` | `subdomains/supporting/balance/controllers/balance.controller.ts` |
| GET | `/bank` | public | eager | 13 | 4 | 3× | `BankController.getAllBanks` | `subdomains/supporting/bank/bank/bank.controller.ts` |
| PUT | `/bank/receiveIban` | public | eager | 101 | 1 | 101× | `BankController.checkReceiveIban` | `subdomains/supporting/bank/bank/bank.controller.ts` |
| POST | `/bank/yapeal/webhook` | public | none | — | n/a | n/a | `YapealWebhookController.handleYapealWebhook` | `integration/bank/controllers/yapeal-webhook.controller.ts` |
| GET | `/bankAccount` | public | eager | 261 | 14 | 19× | `BankAccountController.AuthGuard` | `subdomains/supporting/bank/bank-account/bank-account.controller.ts` |
| POST | `/bankAccount` | public | eager | 253 | 14 | 18× | `BankAccountController.createBankAccount` | `subdomains/supporting/bank/bank-account/bank-account.controller.ts` |
| PUT | `/bankAccount/:id` | public | eager | 261 | 14 | 19× | `BankAccountController.updateBankAccount` | `subdomains/supporting/bank/bank-account/bank-account.controller.ts` |
| POST | `/bankAccount/bic` | hidden | eager | 26 | n/a | n/a | `BankAccountController.addBankAccountBic` | `subdomains/supporting/bank/bank-account/bank-account.controller.ts` |
| POST | `/bankAccount/iban` | public | eager | 26 | n/a | n/a | `BankAccountController.addBankAccountIban` | `subdomains/supporting/bank/bank-account/bank-account.controller.ts` |
| PUT | `/bankData/:id` | public | eager | 31 | n/a | n/a | `BankDataController.updateBankData` | `subdomains/generic/user/models/bank-data/bank-data.controller.ts` |
| PUT | `/bankData/:id/nameCheck` | hidden | eager | 261 | n/a | n/a | `BankDataController.doNameCheck` | `subdomains/generic/user/models/bank-data/bank-data.controller.ts` |
| POST | `/bankTx` | public | eager | 61 | n/a | n/a | `BankTxController.uploadSepaFiles` | `subdomains/supporting/bank-tx/bank-tx/bank-tx.controller.ts` |
| PUT | `/bankTx/:id` | hidden | eager | 1051 | n/a | n/a | `BankTxController.update` | `subdomains/supporting/bank-tx/bank-tx/bank-tx.controller.ts` |
| DELETE | `/bankTx/:id/buyCrypto` | hidden | eager | 247 | n/a | n/a | `BankTxController.reset` | `subdomains/supporting/bank-tx/bank-tx/bank-tx.controller.ts` |
| PUT | `/bankTxRepeat/:id` | public | eager | 240 | n/a | n/a | `BankTxRepeatController.update` | `subdomains/supporting/bank-tx/bank-tx-repeat/bank-tx-repeat.controller.ts` |
| PUT | `/bankTxReturn/:id` | public | eager | 438 | n/a | n/a | `BankTxReturnController.update` | `subdomains/supporting/bank-tx/bank-tx-return/bank-tx-return.controller.ts` |
| POST | `/bankTxReturn/:id/refund` | hidden | eager | 727 | n/a | n/a | `BankTxReturnController.refundBuyCrypto` | `subdomains/supporting/bank-tx/bank-tx-return/bank-tx-return.controller.ts` |
| POST | `/blockchain/balances` | public | eager | 33 | 4 | 8× | `BlockchainApiController.getBalances` | `integration/blockchain/api/controllers/blockchain-api.controller.ts` |
| POST | `/blockchain/broadcast` | public | none | — | 1 | — | `BlockchainApiController.broadcastTransaction` | `integration/blockchain/api/controllers/blockchain-api.controller.ts` |
| POST | `/blockchain/transaction` | public | eager | 33 | 4 | 8× | `BlockchainApiController.createTransaction` | `integration/blockchain/api/controllers/blockchain-api.controller.ts` |
| GET | `/buy` | public | eager | 56 | 30 | 2× | `BuyController.getAllBuy` | `subdomains/core/buy-crypto/routes/buy/buy.controller.ts` |
| POST | `/buy` | hidden | eager | 364 | 30 | 12× | `BuyController.createBuy` | `subdomains/core/buy-crypto/routes/buy/buy.controller.ts` |
| GET | `/buy/:id` | hidden | eager | 134 | 30 | 4× | `BuyController.getBuy` | `subdomains/core/buy-crypto/routes/buy/buy.controller.ts` |
| PUT | `/buy/:id` | public | eager | 56 | 30 | 2× | `BuyController.updateBuyRoute` | `subdomains/core/buy-crypto/routes/buy/buy.controller.ts` |
| GET | `/buy/:id/history` | hidden | eager | 497 | — | — | `BuyController.getBuyRouteHistory` | `subdomains/core/buy-crypto/routes/buy/buy.controller.ts` |
| PUT | `/buy/paymentInfos` | public | eager | 78 | 69 | 1× | `BuyController.createBuyWithPaymentInfo` | `subdomains/core/buy-crypto/routes/buy/buy.controller.ts` |
| PUT | `/buy/paymentInfos/:id/confirm` | public | eager | 504 | n/a | n/a | `BuyController.confirmBuy` | `subdomains/core/buy-crypto/routes/buy/buy.controller.ts` |
| PUT | `/buy/paymentInfos/:id/invoice` | public | eager | 504 | 1 | 504× | `BuyController.generateInvoicePDF` | `subdomains/core/buy-crypto/routes/buy/buy.controller.ts` |
| GET | `/buy/personalIban` | public | eager | 101 | 9 | 11× | `BuyController.getAllPersonalIbans` | `subdomains/core/buy-crypto/routes/buy/buy.controller.ts` |
| POST | `/buy/personalIban` | public | none | — | 9 | — | `BuyController.AuthGuard` | `subdomains/core/buy-crypto/routes/buy/buy.controller.ts` |
| PUT | `/buy/quote` | hidden | eager | 23 | 29 | 1× | `BuyController.getBuyQuote` | `subdomains/core/buy-crypto/routes/buy/buy.controller.ts` |
| PUT | `/buyCrypto/:id` | hidden | eager | 1090 | n/a | n/a | `BuyCryptoController.update` | `subdomains/core/buy-crypto/process/buy-crypto.controller.ts` |
| PUT | `/buyCrypto/:id/amlCheck` | hidden | eager | 363 | n/a | n/a | `BuyCryptoController.manualPassAmlCheck` | `subdomains/core/buy-crypto/process/buy-crypto.controller.ts` |
| DELETE | `/buyCrypto/:id/amlCheck` | hidden | eager | 422 | n/a | n/a | `BuyCryptoController.resetAmlCheck` | `subdomains/core/buy-crypto/process/buy-crypto.controller.ts` |
| POST | `/buyCrypto/:id/refund` | hidden | eager | 1051 | n/a | n/a | `BuyCryptoController.refundBuyCrypto` | `subdomains/core/buy-crypto/process/buy-crypto.controller.ts` |
| POST | `/buyCrypto/:id/scorechain` | hidden | eager | 717 | n/a | n/a | `BuyCryptoController.retriggerScorechain` | `subdomains/core/buy-crypto/process/buy-crypto.controller.ts` |
| POST | `/buyCrypto/:id/webhook` | public | eager | 844 | n/a | n/a | `BuyCryptoController.triggerWebhook` | `subdomains/core/buy-crypto/process/buy-crypto.controller.ts` |
| PUT | `/buyCrypto/refVolumes` | hidden | projected | — | n/a | n/a | `BuyCryptoController.updateRefVolumes` | `subdomains/core/buy-crypto/process/buy-crypto.controller.ts` |
| PUT | `/buyCrypto/volumes` | hidden | eager | 487 | n/a | n/a | `BuyCryptoController.updateBuyVolumes` | `subdomains/core/buy-crypto/process/buy-crypto.controller.ts` |
| PUT | `/buyFiat/:id` | hidden | eager | 1033 | n/a | n/a | `BuyFiatController.update` | `subdomains/core/sell-crypto/process/buy-fiat.controller.ts` |
| PUT | `/buyFiat/:id/amlCheck` | hidden | eager | 201 | n/a | n/a | `BuyFiatController.manualPassAmlCheck` | `subdomains/core/sell-crypto/process/buy-fiat.controller.ts` |
| DELETE | `/buyFiat/:id/amlCheck` | hidden | eager | 490 | n/a | n/a | `BuyFiatController.resetAmlCheck` | `subdomains/core/sell-crypto/process/buy-fiat.controller.ts` |
| POST | `/buyFiat/:id/refund` | hidden | eager | 803 | n/a | n/a | `BuyFiatController.refundBuyFiat` | `subdomains/core/sell-crypto/process/buy-fiat.controller.ts` |
| POST | `/buyFiat/:id/scorechain` | hidden | eager | 517 | n/a | n/a | `BuyFiatController.retriggerScorechain` | `subdomains/core/sell-crypto/process/buy-fiat.controller.ts` |
| POST | `/buyFiat/:id/webhook` | public | eager | 644 | n/a | n/a | `BuyFiatController.triggerWebhook` | `subdomains/core/sell-crypto/process/buy-fiat.controller.ts` |
| PUT | `/buyFiat/refVolumes` | hidden | projected | — | n/a | n/a | `BuyFiatController.updateRefVolumes` | `subdomains/core/sell-crypto/process/buy-fiat.controller.ts` |
| PUT | `/buyFiat/volumes` | hidden | eager | 201 | n/a | n/a | `BuyFiatController.updateVolumes` | `subdomains/core/sell-crypto/process/buy-fiat.controller.ts` |
| GET | `/country` | public | eager | 23 | 12 | 2× | `CountryController.getAllCountry` | `shared/models/country/country.controller.ts` |
| GET | `/cryptoRoute` | public | none | — | n/a | n/a | `CryptoRouteController.getAllCrypto` | `subdomains/core/buy-crypto/routes/swap/crypto-route.controller.ts` |
| POST | `/cryptoRoute` | hidden | none | — | n/a | n/a | `CryptoRouteController.createCrypto` | `subdomains/core/buy-crypto/routes/swap/crypto-route.controller.ts` |
| GET | `/cryptoRoute/:id` | hidden | none | — | n/a | n/a | `CryptoRouteController.getCrypto` | `subdomains/core/buy-crypto/routes/swap/crypto-route.controller.ts` |
| PUT | `/cryptoRoute/:id` | hidden | none | — | n/a | n/a | `CryptoRouteController.updateCryptoRoute` | `subdomains/core/buy-crypto/routes/swap/crypto-route.controller.ts` |
| GET | `/cryptoRoute/:id/history` | hidden | none | — | n/a | n/a | `CryptoRouteController.getCryptoRouteHistory` | `subdomains/core/buy-crypto/routes/swap/crypto-route.controller.ts` |
| GET | `/custody` | public | eager | 253 | 12 | 21× | `CustodyController.getUserCustodyBalance` | `subdomains/core/custody/controllers/custody.controller.ts` |
| POST | `/custody` | public | eager | 23 | 1 | 23× | `CustodyController.createCustodyAccount` | `subdomains/core/custody/controllers/custody.controller.ts` |
| GET | `/custody/account` | public | eager | 253 | 8 | 32× | `CustodyAccountController.getCustodyAccounts` | `subdomains/core/custody/controllers/custody-account.controller.ts` |
| POST | `/custody/account` | public | none | — | 8 | — | `CustodyAccountController.createCustodyAccount` | `subdomains/core/custody/controllers/custody-account.controller.ts` |
| GET | `/custody/account/:id` | public | eager | 253 | 8 | 32× | `CustodyAccountController.getCustodyAccount` | `subdomains/core/custody/controllers/custody-account.controller.ts` |
| PUT | `/custody/account/:id` | public | none | — | 8 | — | `CustodyAccountController.updateCustodyAccount` | `subdomains/core/custody/controllers/custody-account.controller.ts` |
| GET | `/custody/account/:id/access` | public | eager | 238 | 4 | 60× | `CustodyAccountController.getAccessList` | `subdomains/core/custody/controllers/custody-account.controller.ts` |
| POST | `/custody/account/:id/access` | public | none | — | 4 | — | `CustodyAccountController.grantAccess` | `subdomains/core/custody/controllers/custody-account.controller.ts` |
| PUT | `/custody/account/:id/access/:accessId` | public | none | — | 4 | — | `CustodyAccountController.updateAccess` | `subdomains/core/custody/controllers/custody-account.controller.ts` |
| DELETE | `/custody/account/:id/access/:accessId` | public | none | — | n/a | n/a | `CustodyAccountController.revokeAccess` | `subdomains/core/custody/controllers/custody-account.controller.ts` |
| GET | `/custody/account/:id/balance` | public | eager | 253 | 12 | 21× | `CustodyAccountController.getAccountBalance` | `subdomains/core/custody/controllers/custody-account.controller.ts` |
| GET | `/custody/account/:id/history` | public | eager | 253 | 6 | 42× | `CustodyAccountController.getAccountHistory` | `subdomains/core/custody/controllers/custody-account.controller.ts` |
| GET | `/custody/account/:id/order` | public | projected | — | 8 | — | `CustodyAccountController.getAccountOrders` | `subdomains/core/custody/controllers/custody-account.controller.ts` |
| GET | `/custody/account/:id/pdf` | public | eager | 253 | 1 | 253× | `CustodyAccountController.getAccountPdf` | `subdomains/core/custody/controllers/custody-account.controller.ts` |
| POST | `/custody/admin/order/:id/approve` | public | eager | 217 | n/a | n/a | `CustodyAdminController.approveOrder` | `subdomains/core/custody/controllers/custody.controller.ts` |
| GET | `/custody/admin/orders` | public | none | — | n/a | n/a | `CustodyAdminController.getOrders` | `subdomains/core/custody/controllers/custody.controller.ts` |
| PUT | `/custody/admin/user/:id/balance` | public | eager | 118 | n/a | n/a | `CustodyAdminController.updateUserBalance` | `subdomains/core/custody/controllers/custody.controller.ts` |
| GET | `/custody/history` | public | eager | 253 | 6 | 42× | `CustodyController.getUserCustodyHistory` | `subdomains/core/custody/controllers/custody.controller.ts` |
| GET | `/custody/order` | public | projected | — | 8 | — | `CustodyController.getOrders` | `subdomains/core/custody/controllers/custody.controller.ts` |
| POST | `/custody/order` | public | eager | 377 | 50 | 8× | `CustodyController.createOrder` | `subdomains/core/custody/controllers/custody.controller.ts` |
| POST | `/custody/order/:id/confirm` | public | eager | 525 | n/a | n/a | `CustodyController.confirmOrder` | `subdomains/core/custody/controllers/custody.controller.ts` |
| GET | `/custody/pdf` | public | eager | 253 | 1 | 253× | `CustodyController.getCustodyPdf` | `subdomains/core/custody/controllers/custody.controller.ts` |
| GET | `/dashboard/accounting/ledger/accounts` | public | eager | 54 | 13 | 4× | `LedgerController.getAccounts` | `subdomains/core/accounting/controllers/ledger.controller.ts` |
| GET | `/dashboard/accounting/ledger/accounts/:accountId/legs` | hidden | eager | 8 | 24 | 0× | `LedgerController.getAccountDetail` | `subdomains/core/accounting/controllers/ledger.controller.ts` |
| GET | `/dashboard/accounting/ledger/equity-comparison` | hidden | projected | — | 10 | — | `LedgerController.getEquityComparison` | `subdomains/core/accounting/controllers/ledger.controller.ts` |
| GET | `/dashboard/accounting/ledger/margin` | hidden | none | — | 11 | — | `LedgerController.getMargin` | `subdomains/core/accounting/controllers/ledger.controller.ts` |
| GET | `/dashboard/accounting/ledger/reconciliation` | hidden | eager | 54 | 11 | 5× | `LedgerController.getReconStatus` | `subdomains/core/accounting/controllers/ledger.controller.ts` |
| GET | `/dashboard/accounting/ledger/suspense` | hidden | projected | — | 12 | — | `LedgerController.getSuspense` | `subdomains/core/accounting/controllers/ledger.controller.ts` |
| GET | `/dashboard/financial/changes` | hidden | projected | — | 5 | — | `DashboardFinancialController.getFinancialChanges` | `subdomains/supporting/dashboard/dashboard-financial.controller.ts` |
| GET | `/dashboard/financial/changes/latest` | hidden | projected | — | 4 | — | `DashboardFinancialController.getLatestChanges` | `subdomains/supporting/dashboard/dashboard-financial.controller.ts` |
| GET | `/dashboard/financial/latest` | hidden | none | — | 8 | — | `DashboardFinancialController.getLatestBalance` | `subdomains/supporting/dashboard/dashboard-financial.controller.ts` |
| GET | `/dashboard/financial/log` | public | none | — | 8 | — | `DashboardFinancialController.getFinancialLog` | `subdomains/supporting/dashboard/dashboard-financial.controller.ts` |
| GET | `/dashboard/financial/reconciliation` | public | eager | 46 | — | — | `DashboardReconciliationController.getReconciliation` | `subdomains/supporting/dashboard/dashboard-reconciliation.controller.ts` |
| GET | `/dashboard/financial/reconciliation/overview` | hidden | eager | 33 | — | — | `DashboardReconciliationController.getOverview` | `subdomains/supporting/dashboard/dashboard-reconciliation.controller.ts` |
| GET | `/dashboard/financial/ref-recipients` | hidden | none | — | 3 | — | `DashboardFinancialController.getRefRewardRecipients` | `subdomains/supporting/dashboard/dashboard-financial.controller.ts` |
| POST | `/deposit` | public | none | — | n/a | n/a | `DepositController.createDeposits` | `subdomains/supporting/address-pool/deposit/deposit.controller.ts` |
| PUT | `/deposit/lightningWebhook` | hidden | none | — | n/a | n/a | `DepositController.updateLightningDepositWebhook` | `subdomains/supporting/address-pool/deposit/deposit.controller.ts` |
| GET | `/deuro/info` | public | eager | 11 | — | — | `DEuroController.getInfo` | `integration/blockchain/deuro/controllers/deuro.controller.ts` |
| GET | `/dex/check-liquidity` | public | none | — | n/a | n/a | `DexController.checkLiquidity` | `subdomains/supporting/dex/dex.controller.ts` |
| PUT | `/dex/complete-orders` | hidden | eager | 156 | n/a | n/a | `DexController.completeOrders` | `subdomains/supporting/dex/dex.controller.ts` |
| GET | `/dex/liquidity-after-purchase` | hidden | eager | 156 | n/a | n/a | `DexController.fetchTargetLiquidityAfterPurchase` | `subdomains/supporting/dex/dex.controller.ts` |
| POST | `/dex/purchase-liquidity` | hidden | none | — | n/a | n/a | `DexController.purchaseLiquidity` | `subdomains/supporting/dex/dex.controller.ts` |
| POST | `/dex/reserve-liquidity` | hidden | none | — | n/a | n/a | `DexController.reserveLiquidity` | `subdomains/supporting/dex/dex.controller.ts` |
| GET | `/dex/transfer-completion` | hidden | none | — | n/a | n/a | `DexController.checkTransferCompletion` | `subdomains/supporting/dex/dex.controller.ts` |
| POST | `/dex/transfer-liquidity` | hidden | none | — | n/a | n/a | `DexController.transferLiquidity` | `subdomains/supporting/dex/dex.controller.ts` |
| GET | `/exchange/:exchange/balances` | public | none | — | n/a | n/a | `ExchangeController.getBalance` | `integration/exchange/controllers/exchange.controller.ts` |
| GET | `/exchange/:exchange/price` | hidden | none | — | n/a | n/a | `ExchangeController.getPrice` | `integration/exchange/controllers/exchange.controller.ts` |
| PUT | `/exchange/:exchange/sync` | hidden | eager | 33 | n/a | n/a | `ExchangeController.syncExchange` | `integration/exchange/controllers/exchange.controller.ts` |
| GET | `/exchange/:exchange/trade` | hidden | none | — | n/a | n/a | `ExchangeController.getTrades` | `integration/exchange/controllers/exchange.controller.ts` |
| POST | `/exchange/:exchange/trade` | hidden | none | — | n/a | n/a | `ExchangeController.trade` | `integration/exchange/controllers/exchange.controller.ts` |
| GET | `/exchange/:exchange/trade/history` | hidden | none | — | n/a | n/a | `ExchangeController.getTradeHistory` | `integration/exchange/controllers/exchange.controller.ts` |
| POST | `/exchange/:exchange/withdraw` | hidden | none | — | n/a | n/a | `ExchangeController.withdrawFunds` | `integration/exchange/controllers/exchange.controller.ts` |
| GET | `/exchange/:exchange/withdraw/:id` | public | none | — | n/a | n/a | `ExchangeController.getWithdraw` | `integration/exchange/controllers/exchange.controller.ts` |
| GET | `/exchange/trade/:id` | hidden | none | — | n/a | n/a | `ExchangeController.getTrade` | `integration/exchange/controllers/exchange.controller.ts` |
| POST | `/faucet` | public | eager | 78 | 23 | 3× | `FaucetRequestController.faucetRequest` | `subdomains/core/faucet-request/controller/faucet-request.controller.ts` |
| POST | `/fee` | public | eager | 65 | n/a | n/a | `FeeController.createFee` | `subdomains/supporting/payment/controllers/fee.controller.ts` |
| GET | `/fiat` | public | eager | 23 | 4 | 6× | `FiatController.getAllFiat` | `shared/models/fiat/fiat.controller.ts` |
| POST | `/fiatOutput` | public | eager | 377 | n/a | n/a | `FiatOutputController.create` | `subdomains/supporting/fiat-output/fiat-output.controller.ts` |
| PUT | `/fiatOutput/:id` | hidden | eager | 59 | n/a | n/a | `FiatOutputController.update` | `subdomains/supporting/fiat-output/fiat-output.controller.ts` |
| GET | `/frankencoin/info` | public | eager | 11 | — | — | `FrankencoinController.getInfo` | `integration/blockchain/frankencoin/controllers/frankencoin.controller.ts` |
| POST | `/gs/db` | public | none | — | n/a | n/a | `GsController.getDbData` | `subdomains/generic/gs/gs.controller.ts` |
| POST | `/gs/db/custom` | hidden | none | — | n/a | n/a | `GsController.getExtendedData` | `subdomains/generic/gs/gs.controller.ts` |
| POST | `/gs/debug` | hidden | projected | — | n/a | n/a | `GsController.executeDebugQuery` | `subdomains/generic/gs/gs.controller.ts` |
| POST | `/gs/evm/bridgeApproval` | hidden | eager | 33 | n/a | n/a | `GsEvmController.approveBridge` | `subdomains/generic/gs/gs-evm.controller.ts` |
| POST | `/gs/evm/coinTransaction` | hidden | eager | 6 | n/a | n/a | `GsEvmController.sendCoinTransaction` | `subdomains/generic/gs/gs-evm.controller.ts` |
| POST | `/gs/evm/contractApproval` | hidden | eager | 33 | n/a | n/a | `GsEvmController.approveContract` | `subdomains/generic/gs/gs-evm.controller.ts` |
| POST | `/gs/evm/contractTransaction` | hidden | none | — | n/a | n/a | `GsEvmController.sendContractTransaction` | `subdomains/generic/gs/gs-evm.controller.ts` |
| POST | `/gs/evm/rawTransaction` | public | eager | 6 | n/a | n/a | `GsEvmController.sendRawTransaction` | `subdomains/generic/gs/gs-evm.controller.ts` |
| POST | `/gs/evm/tokenTransaction` | hidden | eager | 33 | n/a | n/a | `GsEvmController.sendTokenTransaction` | `subdomains/generic/gs/gs-evm.controller.ts` |
| GET | `/gs/support` | hidden | eager | 907 | n/a | n/a | `GsController.getSupportData` | `subdomains/generic/gs/gs.controller.ts` |
| GET | `/health` | public | none | — | n/a | n/a | `HealthController.getHealth` | `subdomains/core/monitoring/health.controller.ts` |
| GET | `/health/banking` | public | none | — | n/a | n/a | `HealthController.getBankingHealth` | `subdomains/core/monitoring/health.controller.ts` |
| GET | `/health/external` | public | none | — | n/a | n/a | `HealthController.getExternalHealth` | `subdomains/core/monitoring/health.controller.ts` |
| GET | `/health/liquidity` | public | none | — | n/a | n/a | `HealthController.getLiquidityHealth` | `subdomains/core/monitoring/health.controller.ts` |
| GET | `/health/nodes` | public | none | — | n/a | n/a | `HealthController.getNodeHealth` | `subdomains/core/monitoring/health.controller.ts` |
| GET | `/health/payment` | public | none | — | n/a | n/a | `HealthController.getPaymentHealth` | `subdomains/core/monitoring/health.controller.ts` |
| GET | `/history` | public | none | — | 35 | — | `HistoryController.getHistory` | `subdomains/core/history/controllers/history.controller.ts` |
| GET | `/history/:exportType` | hidden | eager | 331 | 1 | 331× | `HistoryController.getApiHistory` | `subdomains/core/history/controllers/history.controller.ts` |
| GET | `/history/csv` | hidden | none | — | n/a | n/a | `HistoryController.getCsv` | `subdomains/core/history/controllers/history.controller.ts` |
| POST | `/history/csv` | public | none | — | n/a | n/a | `HistoryController.createCsv` | `subdomains/core/history/controllers/history.controller.ts` |
| GET | `/ikna/bfs/:id` | hidden | none | — | n/a | n/a | `IknaController.getBfsResult` | `integration/ikna/controllers/ikna.controller.ts` |
| POST | `/ikna/bfs/address` | public | none | — | n/a | n/a | `IknaController.createBfsAddressRequest` | `integration/ikna/controllers/ikna.controller.ts` |
| GET | `/ikna/tag` | hidden | none | — | n/a | n/a | `IknaController.getIknaAddressTag` | `integration/ikna/controllers/ikna.controller.ts` |
| GET | `/juice/info` | public | eager | 11 | — | — | `JuiceController.getInfo` | `integration/blockchain/juice/controllers/juice.controller.ts` |
| GET | `/kyc` | public | none | — | 13 | — | `KycController.getKycLevel` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| GET | `/kyc` | public | none | — | n/a | n/a | `KycController.getKycProgressV1` | `subdomains/generic/user/models/kyc/kyc.controller.ts` |
| POST | `/kyc` | public | none | — | n/a | n/a | `KycController.requestKycV1` | `subdomains/generic/user/models/kyc/kyc.controller.ts` |
| PUT | `/kyc` | public | none | — | 5 | — | `KycController.continueKyc` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| GET | `/kyc/2fa` | public | eager | 253 | n/a | n/a | `KycController.check2fa` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| POST | `/kyc/2fa` | public | none | — | 3 | — | `KycController.start2fa` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| POST | `/kyc/2fa/verify` | public | none | — | n/a | n/a | `KycController.verify2fa` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| GET | `/kyc/:code` | public | none | — | n/a | n/a | `KycController.getKycProgressByCodeV1` | `subdomains/generic/user/models/kyc/kyc.controller.ts` |
| POST | `/kyc/:code` | public | none | — | n/a | n/a | `KycController.requestKycByCodeV1` | `subdomains/generic/user/models/kyc/kyc.controller.ts` |
| GET | `/kyc/:code/countries` | public | eager | 23 | 12 | 2× | `KycController.getKycCountriesByCodeV1` | `subdomains/generic/user/models/kyc/kyc.controller.ts` |
| GET | `/kyc/:id/documents` | public | eager | 78 | 2 | 39× | `KycClientController.getKycFilesV1` | `subdomains/generic/user/models/kyc/kyc.controller.ts` |
| GET | `/kyc/:id/documents/:type` | public | eager | 328 | n/a | n/a | `KycClientController.getKycFileV1` | `subdomains/generic/user/models/kyc/kyc.controller.ts` |
| GET | `/kyc/:step` | public | projected | — | 5 | — | `KycController.initiateStep` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | `/kyc/admin/blacklist/ip` | hidden | projected | — | n/a | n/a | `KycAdminController.addIpToBlacklist` | `subdomains/generic/kyc/controllers/kyc-admin.controller.ts` |
| DELETE | `/kyc/admin/blacklist/ip` | hidden | none | — | n/a | n/a | `KycAdminController.deleteIpToBlacklist` | `subdomains/generic/kyc/controllers/kyc-admin.controller.ts` |
| POST | `/kyc/admin/ident/file/sync` | hidden | eager | 243 | n/a | n/a | `KycAdminController.syncIdentFiles` | `subdomains/generic/kyc/controllers/kyc-admin.controller.ts` |
| POST | `/kyc/admin/log` | hidden | eager | 253 | n/a | n/a | `KycAdminController.createLog` | `subdomains/generic/kyc/controllers/kyc-admin.controller.ts` |
| PUT | `/kyc/admin/log/:id` | hidden | eager | 17 | n/a | n/a | `KycAdminController.updateLog` | `subdomains/generic/kyc/controllers/kyc-admin.controller.ts` |
| PUT | `/kyc/admin/nameCheck/:id` | public | eager | 245 | n/a | n/a | `KycAdminController.updateNameCheckLog` | `subdomains/generic/kyc/controllers/kyc-admin.controller.ts` |
| PUT | `/kyc/admin/step/:id` | hidden | eager | 385 | n/a | n/a | `KycAdminController.updateKycStep` | `subdomains/generic/kyc/controllers/kyc-admin.controller.ts` |
| POST | `/kyc/admin/webhook` | hidden | eager | 243 | n/a | n/a | `KycAdminController.triggerWebhook` | `subdomains/generic/kyc/controllers/kyc-admin.controller.ts` |
| GET | `/kyc/client/payments` | public | eager | 1092 | n/a | n/a | `KycClientController.getAllPayments` | `subdomains/generic/kyc/controllers/kyc-client.controller.ts` |
| GET | `/kyc/client/users` | public | eager | 20 | 1 | 20× | `KycClientController.getAllKycData` | `subdomains/generic/kyc/controllers/kyc-client.controller.ts` |
| GET | `/kyc/client/users/:id/documents` | public | eager | 78 | 2 | 39× | `KycClientController.getKycFiles` | `subdomains/generic/kyc/controllers/kyc-client.controller.ts` |
| GET | `/kyc/client/users/:id/documents/:type` | public | eager | 78 | n/a | n/a | `KycClientController.getKycFile` | `subdomains/generic/kyc/controllers/kyc-client.controller.ts` |
| GET | `/kyc/client/users/:id/payments` | public | eager | 1092 | n/a | n/a | `KycClientController.getUserPayments` | `subdomains/generic/kyc/controllers/kyc-client.controller.ts` |
| GET | `/kyc/countries` | public | eager | 23 | 12 | 2× | `KycController.getKycCountries` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| GET | `/kyc/countries` | public | eager | 23 | 12 | 2× | `KycController.getKycCountriesV1` | `subdomains/generic/user/models/kyc/kyc.controller.ts` |
| DELETE | `/kyc/data/:type/:id` | hidden | none | — | n/a | n/a | `KycController.cancelStep` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | `/kyc/data/additional/:id` | public | none | — | n/a | n/a | `KycController.updateAdditionalDocumentsData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | `/kyc/data/address/:id` | public | none | — | n/a | n/a | `KycController.updateAddressChangeData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | `/kyc/data/authority/:id` | public | none | — | n/a | n/a | `KycController.updateAuthorityData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | `/kyc/data/beneficial/:id` | public | eager | 23 | n/a | n/a | `KycController.updateBeneficialData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | `/kyc/data/confirmation/:id` | public | none | — | n/a | n/a | `KycController.updateSoleProprietorshipConfirmationData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | `/kyc/data/contact/:id` | hidden | none | — | n/a | n/a | `KycController.updateContactData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| GET | `/kyc/data/financial/:id` | public | eager | 7 | n/a | n/a | `KycController.getFinancialData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | `/kyc/data/financial/:id` | public | none | — | n/a | n/a | `KycController.updateFinancialData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | `/kyc/data/legal/:id` | public | none | — | n/a | n/a | `KycController.updateCommercialRegisterData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | `/kyc/data/name/:id` | public | none | — | n/a | n/a | `KycController.updateNameChangeData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | `/kyc/data/nationality/:id` | public | eager | 23 | n/a | n/a | `KycController.updateNationalityData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | `/kyc/data/operational/:id` | public | none | — | n/a | n/a | `KycController.updateOperationalData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | `/kyc/data/owner/:id` | public | none | — | n/a | n/a | `KycController.updateOwnerDirectoryData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | `/kyc/data/payment/:id` | public | eager | 23 | n/a | n/a | `KycController.updatePaymentsData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | `/kyc/data/personal/:id` | public | eager | 23 | n/a | n/a | `KycController.updatePersonalData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | `/kyc/data/phone/:id` | public | eager | 13 | n/a | n/a | `KycController.updatePhoneChangeData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | `/kyc/data/recall/:id` | public | eager | 23 | n/a | n/a | `KycController.updateRecallAgreement` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | `/kyc/data/recommendation/:id` | public | eager | 308 | n/a | n/a | `KycController.updateRecommendationData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | `/kyc/data/residence/:id` | public | none | — | n/a | n/a | `KycController.updateResidencePermitData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | `/kyc/data/signatory/:id` | public | eager | 23 | n/a | n/a | `KycController.updateSignatoryPowerData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | `/kyc/data/statutes/:id` | public | none | — | n/a | n/a | `KycController.updateStatutesData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| GET | `/kyc/file/:id` | hidden | eager | 264 | 5 | 53× | `KycController.getFile` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | `/kyc/ident/manual/:id` | hidden | eager | 23 | n/a | n/a | `KycController.updateIdentData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| POST | `/kyc/ident/sumsub` | public | none | — | n/a | n/a | `KycController.sumsubWebhook` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| POST | `/kyc/transfer` | hidden | eager | 20 | n/a | n/a | `KycController.addKycClient` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | `/kyc/transfer` | public | eager | 331 | n/a | n/a | `KycController.transferKycDataV1` | `subdomains/generic/user/models/kyc/kyc.controller.ts` |
| DELETE | `/kyc/transfer` | hidden | eager | 20 | n/a | n/a | `KycController.removeKycClient` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| GET | `/kyc/users` | public | eager | 561 | 3 | 187× | `KycClientController.getAllKycDataV1` | `subdomains/generic/user/models/kyc/kyc.controller.ts` |
| GET | `/language` | public | eager | 7 | 5 | 1× | `LanguageController.getAllLanguage` | `shared/models/language/language.controller.ts` |
| PUT | `/limitRequest/:id` | public | eager | 434 | n/a | n/a | `LimitRequestController.updateUserData` | `subdomains/supporting/support-issue/limit-request.controller.ts` |
| GET | `/liquidityManagement/balance` | public | eager | 40 | n/a | n/a | `LiquidityBalanceController.getBalances` | `subdomains/core/liquidity-management/controllers/balance.controller.ts` |
| PUT | `/liquidityManagement/order/:id/resolveUncertain` | hidden | eager | 139 | n/a | n/a | `LiquidityManagementOrderController.resolveUncertainOrder` | `subdomains/core/liquidity-management/controllers/order.controller.ts` |
| GET | `/liquidityManagement/order/in-progress` | public | eager | 139 | n/a | n/a | `LiquidityManagementOrderController.getProcessingOrders` | `subdomains/core/liquidity-management/controllers/order.controller.ts` |
| GET | `/liquidityManagement/pipeline/:id/status` | hidden | eager | 112 | n/a | n/a | `LiquidityManagementPipelineController.getPipelineStatus` | `subdomains/core/liquidity-management/controllers/pipeline.controller.ts` |
| POST | `/liquidityManagement/pipeline/buy` | public | none | — | n/a | n/a | `LiquidityManagementPipelineController.buyLiquidity` | `subdomains/core/liquidity-management/controllers/pipeline.controller.ts` |
| GET | `/liquidityManagement/pipeline/in-progress` | hidden | eager | 112 | n/a | n/a | `LiquidityManagementPipelineController.getProcessingPipelines` | `subdomains/core/liquidity-management/controllers/pipeline.controller.ts` |
| POST | `/liquidityManagement/pipeline/sell` | hidden | none | — | n/a | n/a | `LiquidityManagementPipelineController.sellLiquidity` | `subdomains/core/liquidity-management/controllers/pipeline.controller.ts` |
| GET | `/liquidityManagement/pipeline/stopped` | hidden | eager | 112 | n/a | n/a | `LiquidityManagementPipelineController.getStoppedPipelines` | `subdomains/core/liquidity-management/controllers/pipeline.controller.ts` |
| POST | `/liquidityManagement/rule` | public | none | — | 9 | — | `LiquidityManagementRuleController.createRule` | `subdomains/core/liquidity-management/controllers/rule.controller.ts` |
| GET | `/liquidityManagement/rule/:id` | hidden | eager | 83 | 9 | 9× | `LiquidityManagementRuleController.getRule` | `subdomains/core/liquidity-management/controllers/rule.controller.ts` |
| PUT | `/liquidityManagement/rule/:id` | hidden | eager | 83 | n/a | n/a | `LiquidityManagementRuleController.updateRule` | `subdomains/core/liquidity-management/controllers/rule.controller.ts` |
| PATCH | `/liquidityManagement/rule/:id/deactivate` | hidden | eager | 83 | 9 | 9× | `LiquidityManagementRuleController.deactivateRule` | `subdomains/core/liquidity-management/controllers/rule.controller.ts` |
| PATCH | `/liquidityManagement/rule/:id/reactivate` | hidden | eager | 83 | 9 | 9× | `LiquidityManagementRuleController.reactivateRule` | `subdomains/core/liquidity-management/controllers/rule.controller.ts` |
| PATCH | `/liquidityManagement/rule/:id/settings` | hidden | eager | 83 | 9 | 9× | `LiquidityManagementRuleController.setReactivationTime` | `subdomains/core/liquidity-management/controllers/rule.controller.ts` |
| GET | `/lnurla` | public | none | — | 2 | — | `AuthLnurlController.signInWithLnurlAuth` | `subdomains/generic/user/models/auth/auth-lnurl.controller.ts` |
| POST | `/lnurla` | public | none | — | 2 | — | `AuthLnurlController.getLnurlAuth` | `subdomains/generic/user/models/auth/auth-lnurl.controller.ts` |
| GET | `/lnurla/status` | public | none | — | 2 | — | `AuthLnurlController.lnurlAuthStatus` | `subdomains/generic/user/models/auth/auth-lnurl.controller.ts` |
| GET | `/lnurld/:id` | public | none | — | — | — | `LnurldForwardController.lnurldForward` | `subdomains/generic/forwarding/controllers/lnurld-forward.controller.ts` |
| GET | `/lnurld/cb/:id/:var` | public | none | — | — | — | `LnurldForwardController.lnurldCallbackForward` | `subdomains/generic/forwarding/controllers/lnurld-forward.controller.ts` |
| GET | `/lnurlp/:id` | public | none | — | n/a | n/a | `LnUrlPForwardController.lnUrlPForward` | `subdomains/generic/forwarding/controllers/lnurlp-forward.controller.ts` |
| POST | `/lnurlp/:id` | public | eager | 490 | — | — | `LnUrlPForwardController.activatePublicPayment` | `subdomains/generic/forwarding/controllers/lnurlp-forward.controller.ts` |
| DELETE | `/lnurlp/cancel/:id` | public | eager | 545 | 14 | 39× | `LnUrlPForwardController.cancelPayment` | `subdomains/generic/forwarding/controllers/lnurlp-forward.controller.ts` |
| GET | `/lnurlp/cb/:id` | public | projected | — | n/a | n/a | `LnUrlPForwardController.lnUrlPCallbackForward` | `subdomains/generic/forwarding/controllers/lnurlp-forward.controller.ts` |
| GET | `/lnurlp/tx/:id` | public | none | — | n/a | n/a | `LnUrlPForwardController.txHexForward` | `subdomains/generic/forwarding/controllers/lnurlp-forward.controller.ts` |
| GET | `/lnurlp/wait/:id` | public | eager | 545 | 1 | 545× | `LnUrlPForwardController.waitForPayment` | `subdomains/generic/forwarding/controllers/lnurlp-forward.controller.ts` |
| GET | `/lnurlw/:id` | public | none | — | — | — | `LnUrlWForwardController.lnUrlWForward` | `subdomains/generic/forwarding/controllers/lnurlw-forward.controller.ts` |
| GET | `/lnurlw/cb/:id` | public | none | — | n/a | n/a | `LnUrlWForwardController.lnUrlWCallbackForward` | `subdomains/generic/forwarding/controllers/lnurlw-forward.controller.ts` |
| POST | `/log` | public | none | — | n/a | n/a | `LogController.create` | `subdomains/supporting/log/log.controller.ts` |
| PUT | `/log/:id` | hidden | eager | 11 | n/a | n/a | `LogController.update` | `subdomains/supporting/log/log.controller.ts` |
| PUT | `/log/financial/validity` | hidden | none | — | n/a | n/a | `LogController.setFinancialLogValidity` | `subdomains/supporting/log/log.controller.ts` |
| GET | `/monitoring/data` | public | none | — | n/a | n/a | `MonitoringController.getSystemState` | `subdomains/core/monitoring/monitoring.controller.ts` |
| POST | `/monitoring/data` | hidden | none | — | n/a | n/a | `MonitoringController.onWebhook` | `subdomains/core/monitoring/monitoring.controller.ts` |
| GET | `/mros` | hidden | eager | 243 | n/a | n/a | `MrosController.getAll` | `subdomains/supporting/mros/mros.controller.ts` |
| POST | `/mros` | public | eager | 253 | n/a | n/a | `MrosController.createMros` | `subdomains/supporting/mros/mros.controller.ts` |
| GET | `/mros/:id` | hidden | eager | 243 | n/a | n/a | `MrosController.getById` | `subdomains/supporting/mros/mros.controller.ts` |
| PUT | `/mros/:id` | hidden | eager | 78 | n/a | n/a | `MrosController.updateMros` | `subdomains/supporting/mros/mros.controller.ts` |
| POST | `/node/:node/:mode/cmd` | hidden | none | — | n/a | n/a | `NodeController.cmdForMode` | `integration/blockchain/bitcoin/node/node.controller.ts` |
| POST | `/node/:node/:mode/rpc` | hidden | none | — | n/a | n/a | `NodeController.rpcForMode` | `integration/blockchain/bitcoin/node/node.controller.ts` |
| GET | `/node/:node/:mode/tx/:txId` | hidden | none | — | n/a | n/a | `NodeController.waitForTxForMode` | `integration/blockchain/bitcoin/node/node.controller.ts` |
| POST | `/node/:node/cmd` | hidden | none | — | n/a | n/a | `NodeController.cmd` | `integration/blockchain/bitcoin/node/node.controller.ts` |
| POST | `/node/:node/rpc` | public | none | — | n/a | n/a | `NodeController.rpc` | `integration/blockchain/bitcoin/node/node.controller.ts` |
| GET | `/node/:node/tx/:txId` | hidden | none | — | n/a | n/a | `NodeController.waitForTx` | `integration/blockchain/bitcoin/node/node.controller.ts` |
| POST | `/notification/send-mail` | public | none | — | n/a | n/a | `NotificationController.sendMail` | `subdomains/supporting/notification/notification.controller.ts` |
| POST | `/payIn` | public | none | — | n/a | n/a | `PayInController.createPayIn` | `subdomains/supporting/payin/controllers/payin.controller.ts` |
| POST | `/payIn/lnurlpDeposit/:uniqueId` | public | none | — | n/a | n/a | `PayInWebhookController.deposit` | `subdomains/supporting/payin/controllers/payin-webhook.controller.ts` |
| POST | `/payIn/lnurlpPayment/:uniqueId` | hidden | none | — | n/a | n/a | `PayInWebhookController.payment` | `subdomains/supporting/payin/controllers/payin-webhook.controller.ts` |
| POST | `/payIn/poll` | hidden | none | — | n/a | n/a | `PayInController.pollAddress` | `subdomains/supporting/payin/controllers/payin.controller.ts` |
| POST | `/payIn/retry` | hidden | eager | — | n/a | n/a | `PayInController.retryUncertainSend` | `subdomains/supporting/payin/controllers/payin.controller.ts` |
| GET | `/paymentLink` | public | projected | 513 | 15 | 34× | `PaymentLinkController.getAllPaymentLinks` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| POST | `/paymentLink` | public | eager | 472 | 15 | 31× | `PaymentLinkController.createPaymentLink` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| PUT | `/paymentLink` | public | none | — | 15 | — | `PaymentLinkController.updatePaymentLink` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| PUT | `/paymentLink/:id` | hidden | eager | 513 | n/a | n/a | `PaymentLinkController.updatePaymentLinkAdmin` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| DELETE | `/paymentLink/:id` | hidden | eager | 195 | n/a | n/a | `PaymentLinkController.deletePaymentLink` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| PUT | `/paymentLink/:id/pos` | hidden | eager | 513 | n/a | n/a | `PaymentLinkController.createPosLinkAdmin` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| PUT | `/paymentLink/assign` | public | eager | 472 | 15 | 31× | `PaymentLinkController.assignPaymentLink` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| GET | `/paymentLink/config` | public | eager | 253 | 1 | 253× | `PaymentLinkController.getUserPaymentLinksConfig` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| PUT | `/paymentLink/config` | public | none | — | n/a | n/a | `PaymentLinkController.updateUserPaymentLinksConfig` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| GET | `/paymentLink/history` | public | none | — | 16 | — | `PaymentLinkController.getPaymentHistory` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| POST | `/paymentLink/integration/binance/activate/:id` | public | none | — | n/a | n/a | `C2BPaymentLinkController.activateBinancePay` | `subdomains/core/payment-link/controllers/c2b-payment-link.controller.ts` |
| POST | `/paymentLink/integration/binance/webhook` | hidden | none | — | — | — | `C2BPaymentLinkController.binancePayWebhook` | `subdomains/core/payment-link/controllers/c2b-payment-link.controller.ts` |
| POST | `/paymentLink/integration/kucoin/activate/:id` | public | none | — | n/a | n/a | `C2BPaymentLinkController.activateKucoinPay` | `subdomains/core/payment-link/controllers/c2b-payment-link.controller.ts` |
| POST | `/paymentLink/integrations/kucoin/webhook/cancel` ⚠️ | hidden | none | — | — | — | `C2BPaymentLinkController.kucoinPayWebhook` | `subdomains/core/payment-link/controllers/c2b-payment-link.controller.ts` |
| POST | `/paymentLink/integrations/kucoin/webhook/success` | hidden | none | — | — | — | `C2BPaymentLinkController.kucoinPayWebhook` | `subdomains/core/payment-link/controllers/c2b-payment-link.controller.ts` |
| GET | `/paymentLink/locations` | public | eager | 513 | 5 | 103× | `PaymentLinkController.getLocations` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| POST | `/paymentLink/merchant` | public | none | — | n/a | n/a | `PaymentLinkController.createMerchant` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| GET | `/paymentLink/payment` | hidden | eager | 472 | — | — | `PaymentLinkController.createInvoicePayment` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| POST | `/paymentLink/payment` | public | eager | 472 | 15 | 31× | `PaymentLinkController.createPayment` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| DELETE | `/paymentLink/payment` | public | none | — | 15 | — | `PaymentLinkController.cancelPayment` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| PUT | `/paymentLink/payment/:id` | public | eager | 32 | n/a | n/a | `PaymentLinkController.updatePaymentLinkPayment` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| PUT | `/paymentLink/payment/confirm` | public | none | — | 15 | — | `PaymentLinkController.confirmPayment` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| GET | `/paymentLink/payment/wait` | public | none | — | 15 | — | `PaymentLinkController.waitForPayment` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| PUT | `/paymentLink/pos` | public | none | — | 1 | — | `PaymentLinkController.createPosLink` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| GET | `/paymentLink/recipient` | public | none | — | 10 | — | `PaymentLinkController.getPaymentRecipient` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| GET | `/paymentLink/standard` | public | none | — | 5 | — | `PaymentStandardController.getAll` | `subdomains/core/payment-link/controllers/payment-standard.controller.ts` |
| GET | `/paymentLink/standard/:id` | public | projected | — | 5 | — | `PaymentStandardController.getById` | `subdomains/core/payment-link/controllers/payment-standard.controller.ts` |
| GET | `/paymentLink/stickers` | hidden | none | — | n/a | n/a | `PaymentLinkController.generateOcpStickers` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| GET | `/paymentLink/walletApp` | public | none | — | 33 | — | `WalletAppController.getAll` | `subdomains/core/payment-link/controllers/wallet-app.controller.ts` |
| GET | `/paymentLink/walletApp/:id` | public | eager | 15 | 33 | 0× | `WalletAppController.getById` | `subdomains/core/payment-link/controllers/wallet-app.controller.ts` |
| GET | `/paymentLink/walletApp/recommended` | public | eager | 15 | 33 | 0× | `WalletAppController.getRecommended` | `subdomains/core/payment-link/controllers/wallet-app.controller.ts` |
| POST | `/payout` | public | none | — | n/a | n/a | `PayoutController.doPayout` | `subdomains/supporting/payout/payout.controller.ts` |
| GET | `/payout/completion` | hidden | none | — | n/a | n/a | `PayoutController.checkOrderCompletion` | `subdomains/supporting/payout/payout.controller.ts` |
| POST | `/payout/retry` | hidden | eager | 123 | n/a | n/a | `PayoutController.retryUncertainPayout` | `subdomains/supporting/payout/payout.controller.ts` |
| POST | `/payout/speedup` | hidden | eager | 123 | n/a | n/a | `PayoutController.speedupTransaction` | `subdomains/supporting/payout/payout.controller.ts` |
| GET | `/pl` | public | none | — | n/a | n/a | `PaymentForwardController.lnUrlPForward` | `subdomains/generic/forwarding/controllers/payment-forward.controller.ts` |
| GET | `/plp` | public | eager | 472 | — | — | `PaymentLinkShortController.createInvoicePayment` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| GET | `/pricing` | hidden | none | — | n/a | n/a | `PricingController.getRawPrice` | `subdomains/supporting/pricing/pricing.controller.ts` |
| PUT | `/pricing` | hidden | eager | 53 | n/a | n/a | `PricingController.updatePrices` | `subdomains/supporting/pricing/pricing.controller.ts` |
| GET | `/pricing/price` | public | none | — | n/a | n/a | `PricingController.getPrice` | `subdomains/supporting/pricing/pricing.controller.ts` |
| GET | `/realunit/account/:address` | public | none | — | 9 | — | `RealUnitController.getAccountSummary` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | `/realunit/account/:address/history` | public | none | — | 25 | — | `RealUnitController.getAccountHistory` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | `/realunit/admin/quotes` | public | eager | 112 | 8 | 14× | `RealUnitController.getAdminQuotes` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| PUT | `/realunit/admin/quotes/:id/confirm-payment` | hidden | eager | 61 | n/a | n/a | `RealUnitController.confirmPaymentReceived` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| PUT | `/realunit/admin/registration/:id/forward` | hidden | eager | 323 | n/a | n/a | `RealUnitController.forwardRegistration` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | `/realunit/admin/transactions` | hidden | eager | 362 | 8 | 45× | `RealUnitController.getAdminTransactions` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| POST | `/realunit/balance/pdf` | public | eager | 78 | 1 | 78× | `RealUnitController.getBalancePdf` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | `/realunit/brokerbot/buyPrice` | public | none | — | 5 | — | `RealUnitController.getBrokerbotBuyPrice` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | `/realunit/brokerbot/buyShares` | public | none | — | 5 | — | `RealUnitController.getBrokerbotBuyShares` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | `/realunit/brokerbot/info` | public | none | — | 8 | — | `RealUnitController.getBrokerbotInfo` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | `/realunit/brokerbot/price` | public | none | — | 3 | — | `RealUnitController.getBrokerbotPrice` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | `/realunit/brokerbot/sellPrice` | public | eager | 78 | 4 | 20× | `RealUnitController.getBrokerbotSellPrice` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | `/realunit/brokerbot/sellShares` | public | eager | 78 | 4 | 20× | `RealUnitController.getBrokerbotSellShares` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| PUT | `/realunit/buy` | public | eager | 364 | 37 | 10× | `RealUnitController.getPaymentInfo` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| PUT | `/realunit/buy/:id/confirm` | public | none | — | 1 | — | `RealUnitController.confirmBuy` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | `/realunit/compliance/customers` | public | eager | 253 | 7 | 36× | `RealUnitComplianceController.searchCustomers` | `subdomains/supporting/realunit/controllers/realunit-compliance.controller.ts` |
| GET | `/realunit/compliance/customers/:id` | hidden | eager | 826 | 93 | 9× | `RealUnitComplianceController.getCustomer` | `subdomains/supporting/realunit/controllers/realunit-compliance.controller.ts` |
| GET | `/realunit/compliance/customers/:id/dossier` | hidden | eager | 264 | n/a | n/a | `RealUnitComplianceController.downloadCustomerDossier` | `subdomains/supporting/realunit/controllers/realunit-compliance.controller.ts` |
| GET | `/realunit/compliance/customers/:id/files` | hidden | eager | 264 | 4 | 66× | `RealUnitComplianceController.getCustomerFiles` | `subdomains/supporting/realunit/controllers/realunit-compliance.controller.ts` |
| GET | `/realunit/compliance/customers/:id/files/:uid` | hidden | eager | 264 | 5 | 53× | `RealUnitComplianceController.downloadCustomerFile` | `subdomains/supporting/realunit/controllers/realunit-compliance.controller.ts` |
| GET | `/realunit/confirm-aktionariat` | public | none | — | 3 | — | `RealUnitController.confirmAktionariat` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | `/realunit/holders` | public | none | — | 10 | — | `RealUnitController.getHolders` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | `/realunit/legal` | public | eager | 78 | 6 | 13× | `RealUnitLegalController.getLegal` | `subdomains/supporting/realunit/controllers/realunit-legal.controller.ts` |
| PUT | `/realunit/legal` | public | eager | 78 | 6 | 13× | `RealUnitLegalController.acceptLegal` | `subdomains/supporting/realunit/controllers/realunit-legal.controller.ts` |
| GET | `/realunit/pay/:id/status` | public | eager | 32 | 1 | 32× | `RealUnitController.getOcpPayStatus` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| PUT | `/realunit/pay/submit` | public | none | — | 1 | — | `RealUnitController.submitOcpPay` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| PUT | `/realunit/pay/unsigned-transaction` | public | projected | — | 5 | — | `RealUnitController.getOcpPayUnsignedTransaction` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | `/realunit/price` | public | none | — | 4 | — | `RealUnitController.getRealUnitPrice` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | `/realunit/price/history` | public | eager | 40 | 4 | 10× | `RealUnitController.getHistoricalPrice` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | `/realunit/quote/buyPrice` | public | none | — | 5 | — | `RealUnitController.getQuoteBuyPrice` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | `/realunit/quote/buyShares` | public | none | — | 5 | — | `RealUnitController.getQuoteBuyShares` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | `/realunit/quote/info` | public | none | — | 8 | — | `RealUnitController.getQuoteInfo` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | `/realunit/quote/price` | public | none | — | 3 | — | `RealUnitController.getQuotePrice` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | `/realunit/quote/sellPrice` | public | eager | 78 | 4 | 20× | `RealUnitController.getQuoteSellPrice` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | `/realunit/quote/sellShares` | public | eager | 78 | 4 | 20× | `RealUnitController.getQuoteSellShares` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| POST | `/realunit/register/complete` | public | eager | 23 | n/a | n/a | `RealUnitController.completeRegistration` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | `/realunit/register/date` | public | none | — | 1 | — | `RealUnitController.getRegistrationDate` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| POST | `/realunit/register/email` | public | projected | — | 1 | — | `RealUnitController.registerEmail` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | `/realunit/register/status` | public | eager | 78 | n/a | n/a | `RealUnitController.isRegistered` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| POST | `/realunit/register/wallet` | public | none | — | n/a | n/a | `RealUnitController.completeRegistrationForWalletAddress` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | `/realunit/registration` | public | eager | 78 | 20 | 4× | `RealUnitController.getRegistrationInfo` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| PUT | `/realunit/sell` | public | eager | 253 | 46 | 6× | `RealUnitController.getSellPaymentInfo` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| PUT | `/realunit/sell/:id/broadcast` | public | none | — | — | — | `RealUnitController.broadcastSellTransaction` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| PUT | `/realunit/sell/:id/confirm` | public | none | — | — | — | `RealUnitController.confirmSell` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| PUT | `/realunit/sell/:id/unsigned-transactions` | public | none | — | — | — | `RealUnitController.getSellUnsignedTransactions` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| PUT | `/realunit/support/:id` | hidden | eager | 421 | n/a | n/a | `RealUnitSupportController.updateSupportIssue` | `subdomains/supporting/realunit/controllers/realunit-support.controller.ts` |
| GET | `/realunit/support/:id/data` | hidden | eager | 951 | 67 | 14× | `RealUnitSupportController.getIssueData` | `subdomains/supporting/realunit/controllers/realunit-support.controller.ts` |
| POST | `/realunit/support/:id/message` | hidden | eager | 441 | 5 | 88× | `RealUnitSupportController.createSupportMessage` | `subdomains/supporting/realunit/controllers/realunit-support.controller.ts` |
| GET | `/realunit/support/:id/message/:messageId/file` | hidden | eager | 428 | n/a | n/a | `RealUnitSupportController.getFile` | `subdomains/supporting/realunit/controllers/realunit-support.controller.ts` |
| GET | `/realunit/support/:id/messages` | hidden | eager | 421 | 5 | 84× | `RealUnitSupportController.getIssueMessages` | `subdomains/supporting/realunit/controllers/realunit-support.controller.ts` |
| GET | `/realunit/support/activity` | hidden | none | — | n/a | n/a | `RealUnitSupportController.getSupportIssueActivity` | `subdomains/supporting/realunit/controllers/realunit-support.controller.ts` |
| GET | `/realunit/support/clerks` | hidden | none | — | n/a | n/a | `RealUnitSupportController.getRealUnitSupportClerks` | `subdomains/supporting/realunit/controllers/realunit-support.controller.ts` |
| GET | `/realunit/support/counts` | hidden | projected | — | 13 | — | `RealUnitSupportController.getSupportIssueCounts` | `subdomains/supporting/realunit/controllers/realunit-support.controller.ts` |
| GET | `/realunit/support/list` | public | none | — | — | — | `RealUnitSupportController.getSupportIssueList` | `subdomains/supporting/realunit/controllers/realunit-support.controller.ts` |
| GET | `/realunit/support/statistics` | hidden | projected | — | 13 | — | `RealUnitSupportController.getSupportIssueStatistics` | `subdomains/supporting/realunit/controllers/realunit-support.controller.ts` |
| PUT | `/realunit/swap` | public | eager | 78 | 27 | 3× | `RealUnitController.getSwapPaymentInfo` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| PUT | `/realunit/swap/:id/broadcast` | public | none | — | — | — | `RealUnitController.broadcastSwapTransaction` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| PUT | `/realunit/swap/:id/unsigned-transaction` | public | none | — | 1 | — | `RealUnitController.getSwapUnsignedTransaction` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | `/realunit/tokenInfo` | public | none | — | 7 | — | `RealUnitController.getTokenInfo` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| POST | `/realunit/transactions/receipt/multi` | public | eager | 78 | 1 | 78× | `RealUnitController.generateHistoryMultiReceipt` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| POST | `/realunit/transactions/receipt/single` | public | eager | 78 | 1 | 78× | `RealUnitController.generateHistoryReceipt` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| PUT | `/realunit/transfer` | public | eager | 78 | 19 | 4× | `RealUnitController.prepareTransfer` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| PUT | `/realunit/transfer/:id/confirm` | public | none | — | — | — | `RealUnitController.confirmTransfer` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | `/realunit/wallet/status` | public | eager | 78 | 20 | 4× | `RealUnitController.getWalletStatus` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | `/recall` | hidden | eager | 174 | n/a | n/a | `RecallController.getAll` | `subdomains/supporting/recall/recall.controller.ts` |
| POST | `/recall` | public | eager | 78 | n/a | n/a | `RecallController.createRecall` | `subdomains/supporting/recall/recall.controller.ts` |
| GET | `/recall/:id` | hidden | eager | 174 | n/a | n/a | `RecallController.getById` | `subdomains/supporting/recall/recall.controller.ts` |
| PUT | `/recall/:id` | hidden | eager | 78 | n/a | n/a | `RecallController.updateRecall` | `subdomains/supporting/recall/recall.controller.ts` |
| GET | `/recommendation` | public | none | — | 9 | — | `RecommendationController.getAllRecommendation` | `subdomains/generic/user/models/recommendation/recommendation.controller.ts` |
| POST | `/recommendation` | hidden | none | — | 9 | — | `RecommendationController.createRecommendation` | `subdomains/generic/user/models/recommendation/recommendation.controller.ts` |
| PUT | `/recommendation/:id/confirm` | hidden | eager | 643 | n/a | n/a | `RecommendationController.confirmRecommendation` | `subdomains/generic/user/models/recommendation/recommendation.controller.ts` |
| PUT | `/recommendation/:id/reject` | hidden | eager | 643 | n/a | n/a | `RecommendationController.rejectRecommendation` | `subdomains/generic/user/models/recommendation/recommendation.controller.ts` |
| GET | `/ref` | public | none | — | n/a | n/a | `RefController.createRef` | `subdomains/core/referral/process/ref.controller.ts` |
| POST | `/reward/ref` | hidden | eager | 156 | n/a | n/a | `RefRewardController.createPendingRefRewards` | `subdomains/core/referral/reward/ref-reward.controller.ts` |
| PUT | `/reward/ref/:id` | hidden | eager | 156 | n/a | n/a | `RefRewardController.updateRefReward` | `subdomains/core/referral/reward/ref-reward.controller.ts` |
| POST | `/reward/ref/manual` | hidden | eager | 98 | n/a | n/a | `RefRewardController.createManualRefReward` | `subdomains/core/referral/reward/ref-reward.controller.ts` |
| PUT | `/reward/ref/volumes` | public | eager | 78 | n/a | n/a | `RefRewardController.updateVolumes` | `subdomains/core/referral/reward/ref-reward.controller.ts` |
| GET | `/route` | public | eager | 124 | 68 | 2× | `RouteController.getAllRoutes` | `subdomains/core/route/route.controller.ts` |
| PUT | `/route/:id` | hidden | eager | 174 | n/a | n/a | `RouteController.updateRoute` | `subdomains/core/route/route.controller.ts` |
| POST | `/scorechain/screening` | public | none | — | n/a | n/a | `ScorechainController.screen` | `integration/scorechain/controllers/scorechain.controller.ts` |
| GET | `/sell` | public | eager | 124 | 24 | 5× | `SellController.getAllSell` | `subdomains/core/sell-crypto/route/sell.controller.ts` |
| POST | `/sell` | hidden | eager | 253 | 24 | 11× | `SellController.createSell` | `subdomains/core/sell-crypto/route/sell.controller.ts` |
| GET | `/sell/:id` | hidden | eager | 377 | 24 | 16× | `SellController.getSell` | `subdomains/core/sell-crypto/route/sell.controller.ts` |
| PUT | `/sell/:id` | public | eager | 124 | 24 | 5× | `SellController.updateSell` | `subdomains/core/sell-crypto/route/sell.controller.ts` |
| GET | `/sell/:id/history` | hidden | eager | 470 | — | — | `SellController.getSellRouteHistory` | `subdomains/core/sell-crypto/route/sell.controller.ts` |
| PUT | `/sell/paymentInfos` | public | none | — | 93 | — | `SellController.createSellWithPaymentInfo` | `subdomains/core/sell-crypto/route/sell.controller.ts` |
| PUT | `/sell/paymentInfos/:id/confirm` | public | eager | 504 | 35 | 14× | `SellController.confirmSell` | `subdomains/core/sell-crypto/route/sell.controller.ts` |
| GET | `/sell/paymentInfos/:id/tx` | public | eager | 504 | 15 | 34× | `SellController.depositTx` | `subdomains/core/sell-crypto/route/sell.controller.ts` |
| PUT | `/sell/quote` | hidden | eager | 23 | 29 | 1× | `SellController.getSellQuote` | `subdomains/core/sell-crypto/route/sell.controller.ts` |
| GET | `/setting` | public | eager | 5 | n/a | n/a | `SettingController.getSettings` | `shared/models/setting/setting.controller.ts` |
| PUT | `/setting/:key` | hidden | eager | 5 | n/a | n/a | `SettingController.updateSetting` | `shared/models/setting/setting.controller.ts` |
| PUT | `/setting/customSignUpFees` | hidden | projected | — | n/a | n/a | `SettingController.updateCustomSignUpFees` | `shared/models/setting/setting.controller.ts` |
| PUT | `/setting/disabledProcesses` | hidden | none | — | n/a | n/a | `SettingController.updateProcess` | `shared/models/setting/setting.controller.ts` |
| GET | `/setting/infoBanner` | public | none | — | 5 | — | `SettingController.getInfoBanner` | `shared/models/setting/setting.controller.ts` |
| POST | `/specialExternalAccount` | public | eager | 7 | n/a | n/a | `SpecialExternalAccountController.createSpecialExternalAccount` | `subdomains/supporting/payment/controllers/special-external-account.controller.ts` |
| GET | `/statistic` | public | none | — | 3 | — | `StatisticController.getAll` | `subdomains/core/statistic/statistic.controller.ts` |
| GET | `/statistic/status` | public | projected | — | n/a | n/a | `StatisticController.getStatus` | `subdomains/core/statistic/statistic.controller.ts` |
| GET | `/statistic/transactions` | public | eager | 419 | 8 | 52× | `StatisticController.getTransactions` | `subdomains/core/statistic/statistic.controller.ts` |
| GET | `/support` | public | eager | 61 | n/a | n/a | `SupportController.searchUserByKey` | `subdomains/generic/support/support.controller.ts` |
| GET | `/support/:id` | hidden | eager | 826 | n/a | n/a | `SupportController.getUserData` | `subdomains/generic/support/support.controller.ts` |
| GET | `/support/:id/ip-log-pdf` | hidden | none | — | 16 | — | `SupportController.getIpLogPdf` | `subdomains/generic/support/support.controller.ts` |
| POST | `/support/:id/onboarding-pdf` | hidden | none | — | 11 | — | `SupportController.generateOnboardingPdf` | `subdomains/generic/support/support.controller.ts` |
| GET | `/support/:id/scorechain` | hidden | projected | — | 16 | — | `SupportController.getScorechainScreenings` | `subdomains/generic/support/support.controller.ts` |
| GET | `/support/:id/transaction-pdf` | hidden | none | — | 16 | — | `SupportController.getTransactionPdf` | `subdomains/generic/support/support.controller.ts` |
| GET | `/support/call-queues` | hidden | none | — | n/a | n/a | `SupportController.getCallQueues` | `subdomains/generic/support/support.controller.ts` |
| GET | `/support/call-queues/:queue/items` | hidden | eager | 253 | n/a | n/a | `SupportController.getCallQueueItems` | `subdomains/generic/support/support.controller.ts` |
| GET | `/support/call-queues/clerks` | hidden | none | — | n/a | n/a | `SupportController.getCallQueueClerks` | `subdomains/generic/support/support.controller.ts` |
| GET | `/support/issue` | public | eager | 450 | 18 | 25× | `SupportIssueController.getIssues` | `subdomains/supporting/support-issue/support-issue.controller.ts` |
| POST | `/support/issue` | public | eager | 34 | 18 | 2× | `SupportIssueController.createIssue` | `subdomains/supporting/support-issue/support-issue.controller.ts` |
| GET | `/support/issue/:id` | hidden | eager | 450 | 18 | 25× | `SupportIssueController.getIssue` | `subdomains/supporting/support-issue/support-issue.controller.ts` |
| PUT | `/support/issue/:id` | public | eager | 421 | n/a | n/a | `SupportIssueController.updateSupportIssue` | `subdomains/supporting/support-issue/support-issue.controller.ts` |
| PUT | `/support/issue/:id/close` | public | eager | 450 | 18 | 25× | `SupportIssueController.closeIssue` | `subdomains/supporting/support-issue/support-issue.controller.ts` |
| GET | `/support/issue/:id/data` | hidden | eager | 951 | 67 | 14× | `SupportIssueController.getIssueData` | `subdomains/supporting/support-issue/support-issue.controller.ts` |
| POST | `/support/issue/:id/message` | hidden | eager | 441 | 5 | 88× | `SupportIssueController.createSupportMessage` | `subdomains/supporting/support-issue/support-issue.controller.ts` |
| GET | `/support/issue/:id/message/:messageId/file` | public | eager | 428 | n/a | n/a | `SupportIssueController.getFile` | `subdomains/supporting/support-issue/support-issue.controller.ts` |
| GET | `/support/issue/activity` | hidden | none | — | n/a | n/a | `SupportIssueController.getSupportIssueActivity` | `subdomains/supporting/support-issue/support-issue.controller.ts` |
| GET | `/support/issue/clerk` | hidden | none | — | 18 | — | `SupportIssueController.getSupportIssueClerk` | `subdomains/supporting/support-issue/support-issue.controller.ts` |
| GET | `/support/issue/clerks` | hidden | none | — | n/a | n/a | `SupportIssueController.getSupportIssueClerks` | `subdomains/supporting/support-issue/support-issue.controller.ts` |
| GET | `/support/issue/counts` | hidden | projected | — | 13 | — | `SupportIssueController.getSupportIssueCounts` | `subdomains/supporting/support-issue/support-issue.controller.ts` |
| POST | `/support/issue/escalation/telegram-bind` | hidden | none | — | — | — | `SupportIssueController.bindEscalationChat` | `subdomains/supporting/support-issue/support-issue.controller.ts` |
| GET | `/support/issue/escalation/telegram-chats` | hidden | none | — | n/a | n/a | `SupportIssueController.getEscalationChats` | `subdomains/supporting/support-issue/support-issue.controller.ts` |
| POST | `/support/issue/escalation/telegram-test` | hidden | none | — | n/a | n/a | `SupportIssueController.testEscalationChat` | `subdomains/supporting/support-issue/support-issue.controller.ts` |
| GET | `/support/issue/list` | public | none | — | 13 | — | `SupportIssueController.getSupportIssueList` | `subdomains/supporting/support-issue/support-issue.controller.ts` |
| GET | `/support/issue/statistics` | hidden | projected | — | 13 | — | `SupportIssueController.getSupportIssueStatistics` | `subdomains/supporting/support-issue/support-issue.controller.ts` |
| POST | `/support/issue/support` | public | eager | 20 | 18 | 1× | `SupportIssueController.createIssueBySupport` | `subdomains/supporting/support-issue/support-issue.controller.ts` |
| GET | `/support/kycFileList` | hidden | eager | 253 | n/a | n/a | `SupportController.getKycFileList` | `subdomains/generic/support/support.controller.ts` |
| GET | `/support/kycFileStats` | hidden | none | — | n/a | n/a | `SupportController.getKycFileStats` | `subdomains/generic/support/support.controller.ts` |
| GET | `/support/note` | hidden | eager | 9 | 11 | 1× | `SupportController.getNotes` | `subdomains/generic/support/support.controller.ts` |
| POST | `/support/note` | hidden | eager | 253 | 11 | 23× | `SupportController.createNote` | `subdomains/generic/support/support.controller.ts` |
| PUT | `/support/note/:id` | hidden | eager | 239 | 11 | 22× | `SupportController.updateNote` | `subdomains/generic/support/support.controller.ts` |
| DELETE | `/support/note/:id` | hidden | eager | 9 | n/a | n/a | `SupportController.deleteNote` | `subdomains/generic/support/support.controller.ts` |
| GET | `/support/note/users` | hidden | projected | — | 3 | — | `SupportController.listNoteUsers` | `subdomains/generic/support/support.controller.ts` |
| GET | `/support/pending-reviews` | hidden | none | — | n/a | n/a | `SupportController.getPendingReviews` | `subdomains/generic/support/support.controller.ts` |
| GET | `/support/pending-reviews/items` | hidden | eager | 261 | n/a | n/a | `SupportController.getPendingReviewItems` | `subdomains/generic/support/support.controller.ts` |
| GET | `/support/pending-transactions` | hidden | eager | 672 | n/a | n/a | `SupportController.getPendingTransactions` | `subdomains/generic/support/support.controller.ts` |
| GET | `/support/recommendation-graph/:id/neighbors` | hidden | none | — | n/a | n/a | `SupportController.getRecommendationGraphNeighbors` | `subdomains/generic/support/support.controller.ts` |
| GET | `/support/template` | hidden | eager | 8 | 8 | 1× | `SupportController.getTemplates` | `subdomains/generic/support/support.controller.ts` |
| POST | `/support/template` | hidden | eager | 253 | 8 | 32× | `SupportController.createTemplate` | `subdomains/generic/support/support.controller.ts` |
| PUT | `/support/template/:id` | hidden | eager | 8 | 8 | 1× | `SupportController.updateTemplate` | `subdomains/generic/support/support.controller.ts` |
| DELETE | `/support/template/:id` | hidden | eager | 8 | n/a | n/a | `SupportController.deleteTemplate` | `subdomains/generic/support/support.controller.ts` |
| GET | `/support/transaction/:id/refund` | hidden | eager | 98 | 20 | 5× | `SupportController.getTransactionRefund` | `subdomains/generic/support/support.controller.ts` |
| PUT | `/support/transaction/:id/refund` | hidden | eager | 253 | n/a | n/a | `SupportController.setTransactionRefund` | `subdomains/generic/support/support.controller.ts` |
| GET | `/support/transactionList` | hidden | projected | — | n/a | n/a | `SupportController.getTransactionList` | `subdomains/generic/support/support.controller.ts` |
| GET | `/swap` | public | eager | 68 | 34 | 2× | `SwapController.getAllSwap` | `subdomains/core/buy-crypto/routes/swap/swap.controller.ts` |
| POST | `/swap` | hidden | eager | 78 | 34 | 2× | `SwapController.createSwap` | `subdomains/core/buy-crypto/routes/swap/swap.controller.ts` |
| GET | `/swap/:id` | hidden | eager | 146 | 34 | 4× | `SwapController.getSwap` | `subdomains/core/buy-crypto/routes/swap/swap.controller.ts` |
| PUT | `/swap/:id` | public | eager | 68 | 34 | 2× | `SwapController.updateSwapRoute` | `subdomains/core/buy-crypto/routes/swap/swap.controller.ts` |
| GET | `/swap/:id/history` | hidden | eager | 509 | — | — | `SwapController.getSwapRouteHistory` | `subdomains/core/buy-crypto/routes/swap/swap.controller.ts` |
| PUT | `/swap/paymentInfos` | public | none | — | 82 | — | `SwapController.createSwapWithPaymentInfo` | `subdomains/core/buy-crypto/routes/swap/swap.controller.ts` |
| PUT | `/swap/paymentInfos/:id/confirm` | public | eager | 504 | 35 | 14× | `SwapController.confirmSwap` | `subdomains/core/buy-crypto/routes/swap/swap.controller.ts` |
| GET | `/swap/paymentInfos/:id/tx` | public | eager | 504 | 15 | 34× | `SwapController.depositTx` | `subdomains/core/buy-crypto/routes/swap/swap.controller.ts` |
| PUT | `/swap/quote` | hidden | eager | 23 | 28 | 1× | `SwapController.getSwapQuote` | `subdomains/core/buy-crypto/routes/swap/swap.controller.ts` |
| POST | `/tatum/addressWebhook` | public | none | — | n/a | n/a | `TatumController.addressWebhook` | `integration/tatum/controllers/tatum.controller.ts` |
| PUT | `/trading/rule/:id` | public | eager | 87 | n/a | n/a | `TradingRuleController.update` | `subdomains/core/trading/controllers/trading-rule.controller.ts` |
| GET | `/transaction` | public | none | — | 35 | — | `TransactionController.getTransactions` | `subdomains/core/history/controllers/transaction.controller.ts` |
| PUT | `/transaction/:id/invoice` | public | eager | 1220 | 1 | 1220× | `TransactionController.generateInvoiceFromTransaction` | `subdomains/core/history/controllers/transaction.controller.ts` |
| PUT | `/transaction/:id/receipt` | public | eager | 1220 | 1 | 1220× | `TransactionController.generateReceiptFromTransaction` | `subdomains/core/history/controllers/transaction.controller.ts` |
| GET | `/transaction/:id/refund` | public | none | — | 20 | — | `TransactionController.AuthGuard` | `subdomains/core/history/controllers/transaction.controller.ts` |
| PUT | `/transaction/:id/refund` | public | none | — | n/a | n/a | `TransactionController.AuthGuard` | `subdomains/core/history/controllers/transaction.controller.ts` |
| PUT | `/transaction/:id/target` | hidden | eager | 1051 | n/a | n/a | `TransactionController.setTransactionTarget` | `subdomains/core/history/controllers/transaction.controller.ts` |
| GET | `/transaction/ChainReport` | hidden | none | — | 12 | — | `TransactionController.getCsvChainReport` | `subdomains/core/history/controllers/transaction.controller.ts` |
| GET | `/transaction/CoinTracking` | public | none | — | 1 | — | `TransactionController.getCsvCT` | `subdomains/core/history/controllers/transaction.controller.ts` |
| PUT | `/transaction/admin/:id` | public | eager | 253 | n/a | n/a | `TransactionAdminController.updateTransaction` | `subdomains/supporting/payment/controllers/transaction-admin.controller.ts` |
| POST | `/transaction/admin/:id/stop` | hidden | none | — | n/a | n/a | `TransactionAdminController.stopTransaction` | `subdomains/supporting/payment/controllers/transaction-admin.controller.ts` |
| POST | `/transaction/admin/:txId/riskAssessment` | hidden | none | — | n/a | n/a | `TransactionAdminController.createRiskAssessment` | `subdomains/supporting/payment/controllers/transaction-admin.controller.ts` |
| PUT | `/transaction/admin/:txId/riskAssessment/:id` | hidden | eager | 13 | n/a | n/a | `TransactionAdminController.updateRiskAssessment` | `subdomains/supporting/payment/controllers/transaction-admin.controller.ts` |
| GET | `/transaction/csv` | public | none | — | n/a | n/a | `TransactionController.getCsv` | `subdomains/core/history/controllers/transaction.controller.ts` |
| PUT | `/transaction/csv` | public | none | — | n/a | n/a | `TransactionController.createCsv` | `subdomains/core/history/controllers/transaction.controller.ts` |
| GET | `/transaction/detail` | hidden | none | — | 2 | — | `TransactionController.getTransactionDetails` | `subdomains/core/history/controllers/transaction.controller.ts` |
| PUT | `/transaction/detail/csv` | public | none | — | n/a | n/a | `TransactionController.createDetailCsv` | `subdomains/core/history/controllers/transaction.controller.ts` |
| GET | `/transaction/detail/single` | public | none | — | 35 | — | `TransactionController.getSingleTransactionDetails` | `subdomains/core/history/controllers/transaction.controller.ts` |
| GET | `/transaction/single` | public | none | — | 35 | — | `TransactionController.getSingleTransaction` | `subdomains/core/history/controllers/transaction.controller.ts` |
| GET | `/transaction/target` | hidden | eager | 134 | n/a | n/a | `TransactionController.getTransactionTargets` | `subdomains/core/history/controllers/transaction.controller.ts` |
| GET | `/transaction/unassigned` | public | eager | 261 | 23 | 11× | `TransactionController.getUnassignedTransactions` | `subdomains/core/history/controllers/transaction.controller.ts` |
| GET | `/user` | public | eager | 328 | 21 | 16× | `UserController.getUserV1` | `subdomains/generic/user/models/user/user.controller.ts` |
| GET | `/user` | public | none | — | 56 | — | `UserV2Controller.AuthGuard` | `subdomains/generic/user/models/user/user.controller.ts` |
| PUT | `/user` | public | eager | 406 | 14 | 29× | `UserController.updateUserV1` | `subdomains/generic/user/models/user/user.controller.ts` |
| PUT | `/user` | public | eager | 253 | 56 | 5× | `UserV2Controller.updateUser` | `subdomains/generic/user/models/user/user.controller.ts` |
| DELETE | `/user` | public | none | — | n/a | n/a | `UserController.AuthGuard` | `subdomains/generic/user/models/user/user.controller.ts` |
| DELETE | `/user` | public | eager | 344 | n/a | n/a | `UserV2Controller.deleteAccount` | `subdomains/generic/user/models/user/user.controller.ts` |
| PUT | `/user/:id` | hidden | eager | 308 | n/a | n/a | `UserController.updateUserAdmin` | `subdomains/generic/user/models/user/user.controller.ts` |
| DELETE | `/user/account` | public | eager | 344 | n/a | n/a | `UserController.deleteUserAccount` | `subdomains/generic/user/models/user/user.controller.ts` |
| PUT | `/user/addresses/:address` | public | eager | 351 | 56 | 6× | `UserV2Controller.updateAddress` | `subdomains/generic/user/models/user/user.controller.ts` |
| DELETE | `/user/addresses/:address` | public | none | — | n/a | n/a | `UserV2Controller.AuthGuard` | `subdomains/generic/user/models/user/user.controller.ts` |
| PUT | `/user/apiFilter/CT` | public | eager | 308 | n/a | n/a | `UserController.updateApiFilter` | `subdomains/generic/user/models/user/user.controller.ts` |
| POST | `/user/apiKey/CT` | public | eager | 253 | 2 | 126× | `UserController.createApiKey` | `subdomains/generic/user/models/user/user.controller.ts` |
| DELETE | `/user/apiKey/CT` | public | none | — | n/a | n/a | `UserController.deleteApiKey` | `subdomains/generic/user/models/user/user.controller.ts` |
| POST | `/user/change` | public | none | — | 1 | — | `UserController.changeUser` | `subdomains/generic/user/models/user/user.controller.ts` |
| POST | `/user/data` | hidden | eager | 406 | 14 | 29× | `UserController.updateKycData` | `subdomains/generic/user/models/user/user.controller.ts` |
| GET | `/user/detail` | public | eager | 328 | 14 | 23× | `UserController.getUserDetailV1` | `subdomains/generic/user/models/user/user.controller.ts` |
| PUT | `/user/discountCodes` | public | eager | 78 | n/a | n/a | `UserController.addDiscountCode` | `subdomains/generic/user/models/user/user.controller.ts` |
| PUT | `/user/mail` | public | eager | 351 | n/a | n/a | `UserV2Controller.updateUserMail` | `subdomains/generic/user/models/user/user.controller.ts` |
| POST | `/user/mail/verify` | public | eager | 351 | 56 | 6× | `UserV2Controller.verifyMail` | `subdomains/generic/user/models/user/user.controller.ts` |
| PUT | `/user/name` | public | eager | 78 | n/a | n/a | `UserController.updateUserName` | `subdomains/generic/user/models/user/user.controller.ts` |
| GET | `/user/profile` | public | eager | 253 | 24 | 11× | `UserV2Controller.getProfile` | `subdomains/generic/user/models/user/user.controller.ts` |
| GET | `/user/ref` | public | none | — | n/a | n/a | `UserController.getRefInfo` | `subdomains/generic/user/models/user/user.controller.ts` |
| GET | `/user/ref` | public | eager | 78 | 28 | 3× | `UserV2Controller.getRef` | `subdomains/generic/user/models/user/user.controller.ts` |
| PUT | `/user/ref` | public | eager | 273 | 28 | 10× | `UserV2Controller.updateRefAsset` | `subdomains/generic/user/models/user/user.controller.ts` |
| PUT | `/user/specialCodes` | public | eager | 78 | n/a | n/a | `UserController.addSpecialCode` | `subdomains/generic/user/models/user/user.controller.ts` |
| GET | `/user/volumes` | hidden | none | — | n/a | n/a | `UserController.getVolumes` | `subdomains/generic/user/models/user/user.controller.ts` |
| GET | `/userData` | public | eager | 253 | n/a | n/a | `UserDataController.getAllUserData` | `subdomains/generic/user/models/user-data/user-data.controller.ts` |
| POST | `/userData` | hidden | eager | 16 | n/a | n/a | `UserDataController.createEmptyUserData` | `subdomains/generic/user/models/user-data/user-data.controller.ts` |
| GET | `/userData/:id` | public | eager | 253 | n/a | n/a | `UserDataController.getUserData` | `subdomains/generic/user/models/user-data/user-data.controller.ts` |
| PUT | `/userData/:id` | hidden | eager | 384 | n/a | n/a | `UserDataController.updateUserData` | `subdomains/generic/user/models/user-data/user-data.controller.ts` |
| PUT | `/userData/:id/bankDatas` | hidden | eager | 284 | n/a | n/a | `UserDataController.addBankData` | `subdomains/generic/user/models/user-data/user-data.controller.ts` |
| PUT | `/userData/:id/fee` | hidden | eager | 253 | n/a | n/a | `UserDataController.addFee` | `subdomains/generic/user/models/user-data/user-data.controller.ts` |
| DELETE | `/userData/:id/fee` | hidden | eager | 253 | n/a | n/a | `UserDataController.removeFee` | `subdomains/generic/user/models/user-data/user-data.controller.ts` |
| POST | `/userData/:id/kycFile` | hidden | eager | 253 | n/a | n/a | `UserDataController.uploadKycFile` | `subdomains/generic/user/models/user-data/user-data.controller.ts` |
| PUT | `/userData/:id/merge` | hidden | eager | 331 | n/a | n/a | `UserDataController.mergeUserData` | `subdomains/generic/user/models/user-data/user-data.controller.ts` |
| PUT | `/userData/:id/volumes` | hidden | projected | — | n/a | n/a | `UserDataController.updateVolumes` | `subdomains/generic/user/models/user-data/user-data.controller.ts` |
| PUT | `/userData/auditPeriodNumbers` | hidden | none | — | n/a | n/a | `UserDataController.calculateAuditPeriodNumbers` | `subdomains/generic/user/models/user-data/user-data.controller.ts` |
| POST | `/userData/download` | public | none | — | n/a | n/a | `UserDataController.downloadUserData` | `subdomains/generic/user/models/user-data/user-data.controller.ts` |
| POST | `/userDataRelation` | public | eager | 253 | n/a | n/a | `UserDataRelationController.create` | `subdomains/generic/user/models/user-data-relation/user-data-relation.controller.ts` |
| PUT | `/userDataRelation/:id` | public | eager | 7 | n/a | n/a | `UserDataRelationController.update` | `subdomains/generic/user/models/user-data-relation/user-data-relation.controller.ts` |
| DELETE | `/userDataRelation/:id` | public | none | — | n/a | n/a | `UserDataRelationController.delete` | `subdomains/generic/user/models/user-data-relation/user-data-relation.controller.ts` |
| GET | `/version` | hidden | none | — | — | — | `AppController.getVersion` | `app.controller.ts` |
| POST | `/wallet` | public | none | — | n/a | n/a | `WalletController.createWallet` | `subdomains/generic/user/models/wallet/wallet.controller.ts` |
| PUT | `/wallet/:id` | hidden | eager | 20 | n/a | n/a | `WalletController.updateWallet` | `subdomains/generic/user/models/wallet/wallet.controller.ts` |

⚠️ = not registered at runtime, see *Known discrepancy* above.
