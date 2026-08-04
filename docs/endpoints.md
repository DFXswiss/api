# HTTP endpoints

Every HTTP endpoint this service exposes: **537 decorated route entries** across 94 controller files, of which **536 are registered at runtime** — one handler carries two `@Post` decorators and only one of them takes effect, see *Known discrepancy*. 299 are marked `@ApiExcludeEndpoint` and do not appear in the public Swagger schema.

## Columns

| Column | Meaning |
| ------ | ------- |
| **Ver** | API version in the URL. `1` is the default and needs no decorator; `2` comes from `@Controller({ version: [...] })`; `neutral` marks `@Version(VERSION_NEUTRAL)`, which is served without a version prefix. Six method/path pairs exist under more than one version, so the version is what makes a row unique. Deprecation is recorded separately and does not follow the version: `GET /user/ref` is marked on neither, `GET /kyc/countries` on both. |
| **Dep** | `yes` when the handler carries `@ApiOperation({ deprecated: true })` |
| **Swagger** | `public` — in the Swagger schema; `hidden` — carries `@ApiExcludeEndpoint` |
| **Data access** | What the endpoint reads, taken over **all** load sites it can reach — a permission check, a lookup and the actual query all count. `whole rows` — at least one of them fetches every column of an entity; `projected` — every read names the fields it needs; `caller-defined` — the field list comes from the request, and without one every column is loaded; `none` — no read at all (external services, in-memory caches, files, pure write paths). |
| **Max cols** | Widest single query the endpoint can trigger, measured against the real entity metadata; a lower bound where the call graph did not fully resolve. `—` means no measurable site, not zero. |
| **Tests** | State against the four levels in [read-path-projections.md](read-path-projections.md#test-definition). `n/a` — the definition does not apply (the endpoint reads nothing, or its field list comes from the caller); `not yet` — the endpoint has not been converted, so nothing can be missing from it yet; `0/4` to `4/4` — levels satisfied. An endpoint reaches more than one load site, so it earns a level only when **every** projected load site it reaches satisfies that level; the weakest site decides the row. **A converted endpoint counts as done only at `4/4`.** |
| **Spec** | `yes` when some spec file names this controller and calls this handler. A weak signal and a lower bound — it says a test touches the endpoint, not that it covers it, and it misses specs that drive a route over HTTP without naming the handler. |

## The target state

Every read path in this service is to select the fields it needs, and nothing more — "needs" including the fields a guard, a branch or a column-scoped write reads without returning them. This document is the work list for getting there and the record of where we stand.

Two rules follow from that, and both are binding:

1. **An endpoint counts as converted only when its tests reach `4/4`** against the four levels in [read-path-projections.md](read-path-projections.md#test-definition). A projection without them is worse than no projection: a forgotten field does not crash, it returns a wrong value with a 200, and in a service moving money that can run for weeks unnoticed. Anything short of `4/4` is unfinished work, not a partial success.
2. **The state of every endpoint is recorded here**, in the `Tests` column, and kept in sync with the code in the same pull request that changes it. An undocumented conversion is indistinguishable from one that was never tested.

Today 36 endpoints read only what they need and 410 do not, so the column reads `not yet` almost everywhere. That is the point of recording it: the number is the distance to the target.

## What the numbers say

| Data access | Endpoints | Share |
| ----------- | --------: | ----: |
| `whole rows` | 410 | 76 % |
| `none` | 89 | 17 % |
| `projected` | 36 | 7 % |
| `caller-defined` | 2 | 0 % |

Of the 36 that read only what they need, 17 were converted deliberately and carry tests on all four levels: `GET /user/profile` (253 columns to 41), `GET /buy/:id/history` (497 columns to 12), `GET /swap/:id/history` (509 columns to 12), `GET /sell/:id/history` (470 columns to 14), `GET /support/issue/:id/data` (951 columns to 81), `GET /support/issue` (450 columns to 11), `GET /support/issue/:id` (450 columns to 11), `GET /kyc/users` (328 columns to 7), `GET /kyc/:id/documents` (328 columns to 2), `GET /custody/order` (19 columns to 14), `GET /support/issue/list` (16 columns to 10), `GET /realunit/support/list` (16 columns to 10), `GET /dashboard/accounting/ledger/suspense` (11 columns to 10), `GET /liquidityManagement/pipeline/:id/status` (112 columns to 2), `PUT /paymentLink/:id/pos` (513 columns to 7), `POST /user/apiKey/CT` (253 columns to 3), `GET /user` (351 columns to 66). The other 19 were already projecting — mostly counts, maxima and id lookups written with a query builder, which name their columns one at a time rather than as a list. They are not covered by the tests below, which is why 18 of them read `0/4` rather than `n/a`: a projection without those tests is exactly the state this document warns about, whether it was written today or three years ago. The nineteenth is `POST /gs/debug`, which stays `n/a` because its field list comes from the request and there is no fixed projection to test. `POST /gs/db` and `POST /gs/db/custom` project only when the caller sends a field list — `request.select(query.select)` — and load the full table otherwise.

Among the 410 that fetch whole rows, the widest query they can trigger is **308 columns** at the median of the recorded maxima; at least 306 exceed 100, 73 exceed 500 and 21 exceed 1000. Postgres refuses a statement with more than 1664 columns, so a query near that number is one added column away from failing outright.

### How to read this column, and how not to

`Data access` is a statement about the **union** of everything an endpoint touches, not about one designated data path. An endpoint marked `whole rows` may well answer from raw SQL and still be marked, because a permission check on the way loads a full `UserData` row. That is deliberate: the question the column answers is *does this endpoint load more than it needs*, and for that any one offending site is enough. It does **not** say where the bulk of the work happens — [load-sites.md](load-sites.md) does, per site and with measured column counts.

### Deprecation

24 handlers carry `@ApiOperation({ deprecated: true })`: 19 of them fetch whole rows, 2 project, 3 read nothing. Deprecation does not follow the version, and the duplicated paths are not simply an old handler beside its replacement: `GET /kyc/countries` is marked on **both** its v1 and its v2 handler, and `GET /user/ref` on neither.

### Limits of this classification

Stated exactly, so the numbers can be checked rather than believed:

- **448 of the 537 route entries rest on a call graph that is not fully resolved** — a target chosen at runtime, a method reached through inheritance, an entity manager handed into a transaction callback. This does not weaken the `whole rows` group: an unresolved edge can only add load sites, never remove one, so 410 is a lower bound in that direction. In the other direction 407 of them are backed by at least one measured query; the remaining three are the entries discussed below.
- All 89 endpoints marked `none` are the opposite case: their graph resolved completely, or the remaining target was read in the source (27 of them, listed below). None of them rests on an unresolved edge.
- The 36 `projected` and 2 `caller-defined` endpoints do each carry an unresolved edge — a call through the entity manager inside a transaction callback. Their reads were read in the source, but the classification is not proven exhaustive the way the `none` group is.
- 3 endpoints in the `whole rows` group have no measured column count and show `—`: `POST /payIn/retry`, `GET /support/issue/:id/message/:messageId/file` and `PUT /buyCrypto/:id/amlCheck/reviewReset`. They are also the ones most exposed to the upper bound described in [load-sites.md](load-sites.md#measurements): with no measured query behind them, nothing here shows that they reach a whole-row read at all.

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

- **Endpoints** — from the routing decorators in `src/**/*.controller.ts`, each attributed to the `@Controller` scope preceding it. Decorators between the route and the method are skipped by counting parentheses, so a multi-line `@UseGuards(` cannot be mistaken for the handler. Cross-checked in both directions against the routes the framework registers at startup: all 530 distinct method/path pairs match, with no entry left over on either side. The 536 registered rows exceed that by the six pairs served under two versions.
- **Ver** — from `@Version` on the handler, otherwise from the `@Controller` scope, otherwise the configured default. Note that the version follows the class, not the folder: the controllers under `generic/kyc/` are not uniformly v2 — `KycAdminController` carries no version decorator and is therefore served under the default.
- **Data access** — the union over the call graph, following injected fields, locally constructed repositories and multi-line call chains. `find*` pulls in eager relations, `createQueryBuilder` does not, a bare identifier passed to `.select(...)` is the root alias and loads every column, while anything else — an array, a qualified column such as `.select('userData.id', 'id')`, or an expression such as `COUNT(*)` — narrows it, and `.update()/.delete()/.insert()` are writes that load nothing.
- **Max cols** — the query is built from the real entity metadata and its SELECT list counted, so the number is measured rather than estimated. It is still a lower bound wherever the load site takes its `relations` tree as a parameter, or the call graph did not resolve: both can only add sites and widen queries, never the reverse.

## Known discrepancy

`POST /paymentLink/integrations/kucoin/webhook/cancel` appears in the source but is **not registered at runtime**: its handler in `c2b-payment-link.controller.ts` carries two `@Post` decorators, and the framework stores a single path per handler, so only `.../webhook/success` takes effect. Listed below for completeness and marked accordingly.

## Endpoints

| Method | Ver | Dep | Path | Swagger | Data access | Max cols | Tests | Spec | Handler | File |
| ------ | --- | --- | ---- | ------- | ----------- | -------: | ----- | ---- | ------- | ---- |
| GET | neutral |  | `/` | hidden | none | — | n/a |  | `AppController.home` | `app.controller.ts` |
| POST | 1 |  | `/CustodyProvider` | hidden | none | — | n/a |  | `CustodyProviderController.createCustodyProvider` | `subdomains/generic/user/models/custody-provider/custody-provider.controller.ts` |
| PUT | 1 |  | `/CustodyProvider/:id` | hidden | whole rows | 6 | not yet |  | `CustodyProviderController.updateCustodyProvider` | `subdomains/generic/user/models/custody-provider/custody-provider.controller.ts` |
| POST | 1 |  | `/admin/lightning/rotate-webhook-secrets` | hidden | none | — | n/a |  | `AdminController.rotateLightningWebhookSecrets` | `subdomains/generic/admin/admin.controller.ts` |
| POST | 1 |  | `/admin/mail` | hidden | whole rows | 13 | not yet |  | `AdminController.sendMail` | `subdomains/generic/admin/admin.controller.ts` |
| POST | 1 |  | `/admin/payout` | hidden | whole rows | 156 | not yet |  | `AdminController.payout` | `subdomains/generic/admin/admin.controller.ts` |
| POST | 1 |  | `/admin/sendLetter` | hidden | none | — | n/a |  | `AdminController.sendLetter` | `subdomains/generic/admin/admin.controller.ts` |
| POST | 1 |  | `/alchemy/addressWebhook` | hidden | none | — | n/a |  | `AlchemyController.addressWebhook` | `integration/alchemy/controllers/alchemy.controller.ts` |
| GET | 1 |  | `/alchemy/addresses/:webhookId` | hidden | none | — | n/a |  | `AlchemyController.addresses` | `integration/alchemy/controllers/alchemy.controller.ts` |
| GET | 1 |  | `/app` | hidden | whole rows | 6 | not yet |  | `AppController.createRefNew` | `app.controller.ts` |
| GET | 1 |  | `/app/:app` | hidden | whole rows | 6 | not yet |  | `AppController.redirectToStore` | `app.controller.ts` |
| GET | 1 |  | `/app/advertisements` | hidden | none | — | n/a |  | `AppController.getAds` | `app.controller.ts` |
| GET | 1 |  | `/app/announcements` | hidden | none | — | n/a |  | `AppController.getAnnouncements` | `app.controller.ts` |
| GET | 1 |  | `/app/settings/flags` | hidden | none | — | n/a |  | `AppController.getFlags` | `app.controller.ts` |
| GET | 1 |  | `/asset` | public | whole rows | 33 | not yet |  | `AssetController.getAllAsset` | `shared/models/asset/asset.controller.ts` |
| PUT | 1 |  | `/asset/:id` | hidden | whole rows | 33 | not yet |  | `AssetController.updateAsset` | `shared/models/asset/asset.controller.ts` |
| POST | 1 |  | `/auth` | public | whole rows | 643 | not yet |  | `AuthController.authenticate` | `subdomains/generic/user/models/auth/auth.controller.ts` |
| GET | 1 |  | `/auth/2fa` | public | whole rows | 253 | not yet |  | `AuthController.check2fa` | `subdomains/generic/user/models/auth/auth.controller.ts` |
| POST | 1 |  | `/auth/2fa` | public | whole rows | 253 | not yet |  | `AuthController.setup2fa` | `subdomains/generic/user/models/auth/auth.controller.ts` |
| POST | 1 |  | `/auth/2fa/verify` | public | whole rows | 253 | not yet |  | `AuthController.verify2fa` | `subdomains/generic/user/models/auth/auth.controller.ts` |
| GET | 1 |  | `/auth/alby` | hidden | none | — | n/a |  | `AuthController.signInWithAlby` | `subdomains/generic/user/models/auth/auth.controller.ts` |
| GET | 1 |  | `/auth/alby/redirect/:id` | hidden | whole rows | 643 | not yet |  | `AuthController.redirectAlby` | `subdomains/generic/user/models/auth/auth.controller.ts` |
| GET | 1 |  | `/auth/challenge` | public | whole rows | 20 | not yet |  | `AuthController.companyChallenge` | `subdomains/generic/user/models/auth/auth.controller.ts` |
| POST | 1 |  | `/auth/mail` | public | whole rows | 643 | not yet |  | `AuthController.signInByMail` | `subdomains/generic/user/models/auth/auth.controller.ts` |
| GET | 1 |  | `/auth/mail/confirm` | hidden | whole rows | 470 | not yet |  | `AuthController.executeMerge` | `subdomains/generic/user/models/auth/auth.controller.ts` |
| GET | 1 |  | `/auth/mail/redirect` | hidden | whole rows | 643 | not yet |  | `AuthController.redirectMail` | `subdomains/generic/user/models/auth/auth.controller.ts` |
| POST | 1 |  | `/auth/signIn` | hidden | whole rows | 643 | not yet |  | `AuthController.signIn` | `subdomains/generic/user/models/auth/auth.controller.ts` |
| GET | 1 |  | `/auth/signMessage` | public | none | — | n/a |  | `AuthController.getSignMessage` | `subdomains/generic/user/models/auth/auth.controller.ts` |
| POST | 1 |  | `/auth/signUp` | hidden | whole rows | 643 | not yet |  | `AuthController.signUp` | `subdomains/generic/user/models/auth/auth.controller.ts` |
| GET | 1 |  | `/auth/verifySignature` | hidden | whole rows | 6 | not yet |  | `AuthController.verifySignMessage` | `subdomains/generic/user/models/auth/auth.controller.ts` |
| GET | 1 |  | `/balance/pdf` | public | whole rows | 40 | not yet |  | `BalanceController.getBalancePdf` | `subdomains/supporting/balance/controllers/balance.controller.ts` |
| GET | 1 |  | `/balance/pdf/blockchains` | public | none | — | n/a |  | `BalanceController.getSupportedBlockchains` | `subdomains/supporting/balance/controllers/balance.controller.ts` |
| GET | 1 |  | `/bank` | public | whole rows | 46 | not yet |  | `BankController.getAllBanks` | `subdomains/supporting/bank/bank/bank.controller.ts` |
| PUT | 1 |  | `/bank/receiveIban` | public | whole rows | 97 | not yet | yes | `BankController.checkReceiveIban` | `subdomains/supporting/bank/bank/bank.controller.ts` |
| POST | 1 |  | `/bank/yapeal/webhook` | hidden | none | — | n/a |  | `YapealWebhookController.handleYapealWebhook` | `integration/bank/controllers/yapeal-webhook.controller.ts` |
| GET | 1 |  | `/bankAccount` | public | whole rows | 261 | not yet |  | `BankAccountController.getAllUserBankAccount` | `subdomains/supporting/bank/bank-account/bank-account.controller.ts` |
| POST | 1 |  | `/bankAccount` | public | whole rows | 261 | not yet |  | `BankAccountController.createBankAccount` | `subdomains/supporting/bank/bank-account/bank-account.controller.ts` |
| PUT | 1 |  | `/bankAccount/:id` | public | whole rows | 261 | not yet |  | `BankAccountController.updateBankAccount` | `subdomains/supporting/bank/bank-account/bank-account.controller.ts` |
| POST | 1 |  | `/bankAccount/bic` | hidden | whole rows | 26 | not yet |  | `BankAccountController.addBankAccountBic` | `subdomains/supporting/bank/bank-account/bank-account.controller.ts` |
| POST | 1 |  | `/bankAccount/iban` | hidden | whole rows | 26 | not yet |  | `BankAccountController.addBankAccountIban` | `subdomains/supporting/bank/bank-account/bank-account.controller.ts` |
| PUT | 1 |  | `/bankData/:id` | hidden | whole rows | 31 | not yet |  | `BankDataController.updateBankData` | `subdomains/generic/user/models/bank-data/bank-data.controller.ts` |
| PUT | 1 |  | `/bankData/:id/nameCheck` | hidden | whole rows | 276 | not yet |  | `BankDataController.doNameCheck` | `subdomains/generic/user/models/bank-data/bank-data.controller.ts` |
| POST | 1 |  | `/bankTx` | hidden | whole rows | 62 | not yet |  | `BankTxController.uploadSepaFiles` | `subdomains/supporting/bank-tx/bank-tx/bank-tx.controller.ts` |
| PUT | 1 |  | `/bankTx/:id` | hidden | whole rows | 1053 | not yet |  | `BankTxController.update` | `subdomains/supporting/bank-tx/bank-tx/bank-tx.controller.ts` |
| DELETE | 1 |  | `/bankTx/:id/buyCrypto` | hidden | whole rows | 249 | not yet |  | `BankTxController.reset` | `subdomains/supporting/bank-tx/bank-tx/bank-tx.controller.ts` |
| PUT | 1 |  | `/bankTxRepeat/:id` | hidden | whole rows | 308 | not yet |  | `BankTxRepeatController.update` | `subdomains/supporting/bank-tx/bank-tx-repeat/bank-tx-repeat.controller.ts` |
| PUT | 1 |  | `/bankTxReturn/:id` | hidden | whole rows | 439 | not yet |  | `BankTxReturnController.update` | `subdomains/supporting/bank-tx/bank-tx-return/bank-tx-return.controller.ts` |
| POST | 1 |  | `/bankTxReturn/:id/refund` | hidden | whole rows | 728 | not yet |  | `BankTxReturnController.refundBuyCrypto` | `subdomains/supporting/bank-tx/bank-tx-return/bank-tx-return.controller.ts` |
| POST | 1 |  | `/blockchain/balances` | public | whole rows | 33 | not yet |  | `BlockchainApiController.getBalances` | `integration/blockchain/api/controllers/blockchain-api.controller.ts` |
| POST | 1 |  | `/blockchain/broadcast` | public | none | — | n/a |  | `BlockchainApiController.broadcastTransaction` | `integration/blockchain/api/controllers/blockchain-api.controller.ts` |
| POST | 1 |  | `/blockchain/transaction` | public | whole rows | 33 | not yet |  | `BlockchainApiController.createTransaction` | `integration/blockchain/api/controllers/blockchain-api.controller.ts` |
| GET | 1 |  | `/buy` | hidden | whole rows | 308 | not yet |  | `BuyController.getAllBuy` | `subdomains/core/buy-crypto/routes/buy/buy.controller.ts` |
| POST | 1 |  | `/buy` | hidden | whole rows | 360 | not yet |  | `BuyController.createBuy` | `subdomains/core/buy-crypto/routes/buy/buy.controller.ts` |
| GET | 1 |  | `/buy/:id` | public | whole rows | 308 | not yet |  | `BuyController.getBuy` | `subdomains/core/buy-crypto/routes/buy/buy.controller.ts` |
| PUT | 1 |  | `/buy/:id` | hidden | whole rows | 308 | not yet |  | `BuyController.updateBuyRoute` | `subdomains/core/buy-crypto/routes/buy/buy.controller.ts` |
| GET | 1 |  | `/buy/:id/history` | hidden | projected | 12 | 4/4 |  | `BuyController.getBuyRouteHistory` | `subdomains/core/buy-crypto/routes/buy/buy.controller.ts` |
| PUT | 1 |  | `/buy/paymentInfos` | public | whole rows | 360 | not yet |  | `BuyController.createBuyWithPaymentInfo` | `subdomains/core/buy-crypto/routes/buy/buy.controller.ts` |
| PUT | 1 |  | `/buy/paymentInfos/:id/confirm` | public | whole rows | 484 | not yet |  | `BuyController.confirmBuy` | `subdomains/core/buy-crypto/routes/buy/buy.controller.ts` |
| PUT | 1 |  | `/buy/paymentInfos/:id/invoice` | public | whole rows | 484 | not yet | yes | `BuyController.generateInvoicePDF` | `subdomains/core/buy-crypto/routes/buy/buy.controller.ts` |
| GET | 1 |  | `/buy/personalIban` | public | whole rows | 327 | not yet |  | `BuyController.getAllPersonalIbans` | `subdomains/core/buy-crypto/routes/buy/buy.controller.ts` |
| POST | 1 |  | `/buy/personalIban` | public | whole rows | 253 | not yet |  | `BuyController.createPersonalIban` | `subdomains/core/buy-crypto/routes/buy/buy.controller.ts` |
| PUT | 1 |  | `/buy/quote` | public | whole rows | 143 | not yet |  | `BuyController.getBuyQuote` | `subdomains/core/buy-crypto/routes/buy/buy.controller.ts` |
| PUT | 1 |  | `/buyCrypto/:id` | hidden | whole rows | 1088 | not yet |  | `BuyCryptoController.update` | `subdomains/core/buy-crypto/process/buy-crypto.controller.ts` |
| PUT | 1 |  | `/buyCrypto/:id/amlCheck` | hidden | whole rows | 1088 | not yet |  | `BuyCryptoController.manualPassAmlCheck` | `subdomains/core/buy-crypto/process/buy-crypto.controller.ts` |
| PUT | 1 |  | `/buyCrypto/:id/amlCheck/reviewReset` | hidden | whole rows | — | not yet |  | `BuyCryptoController.resetAmlCheckForReview` | `subdomains/core/buy-crypto/process/buy-crypto.controller.ts` |
| POST | 1 |  | `/buyCrypto/:id/refund` | hidden | whole rows | 1053 | not yet |  | `BuyCryptoController.refundBuyCrypto` | `subdomains/core/buy-crypto/process/buy-crypto.controller.ts` |
| POST | 1 |  | `/buyCrypto/:id/scorechain` | hidden | whole rows | 714 | not yet |  | `BuyCryptoController.retriggerScorechain` | `subdomains/core/buy-crypto/process/buy-crypto.controller.ts` |
| POST | 1 |  | `/buyCrypto/:id/webhook` | hidden | whole rows | 846 | not yet |  | `BuyCryptoController.triggerWebhook` | `subdomains/core/buy-crypto/process/buy-crypto.controller.ts` |
| PUT | 1 |  | `/buyCrypto/refVolumes` | hidden | projected | 2 | 0/4 |  | `BuyCryptoController.updateRefVolumes` | `subdomains/core/buy-crypto/process/buy-crypto.controller.ts` |
| PUT | 1 |  | `/buyCrypto/volumes` | hidden | whole rows | 484 | not yet |  | `BuyCryptoController.updateBuyVolumes` | `subdomains/core/buy-crypto/process/buy-crypto.controller.ts` |
| PUT | 1 |  | `/buyFiat/:id` | hidden | whole rows | 1034 | not yet |  | `BuyFiatController.update` | `subdomains/core/sell-crypto/process/buy-fiat.controller.ts` |
| DELETE | 1 |  | `/buyFiat/:id/amlCheck` | hidden | whole rows | 490 | not yet |  | `BuyFiatController.resetAmlCheck` | `subdomains/core/sell-crypto/process/buy-fiat.controller.ts` |
| PUT | 1 |  | `/buyFiat/:id/amlCheck` | hidden | whole rows | 1034 | not yet |  | `BuyFiatController.manualPassAmlCheck` | `subdomains/core/sell-crypto/process/buy-fiat.controller.ts` |
| POST | 1 |  | `/buyFiat/:id/refund` | hidden | whole rows | 803 | not yet |  | `BuyFiatController.refundBuyFiat` | `subdomains/core/sell-crypto/process/buy-fiat.controller.ts` |
| POST | 1 |  | `/buyFiat/:id/scorechain` | hidden | whole rows | 517 | not yet |  | `BuyFiatController.retriggerScorechain` | `subdomains/core/sell-crypto/process/buy-fiat.controller.ts` |
| POST | 1 |  | `/buyFiat/:id/webhook` | hidden | whole rows | 645 | not yet |  | `BuyFiatController.triggerWebhook` | `subdomains/core/sell-crypto/process/buy-fiat.controller.ts` |
| PUT | 1 |  | `/buyFiat/refVolumes` | hidden | projected | 2 | 0/4 |  | `BuyFiatController.updateRefVolumes` | `subdomains/core/sell-crypto/process/buy-fiat.controller.ts` |
| PUT | 1 |  | `/buyFiat/volumes` | hidden | whole rows | 308 | not yet |  | `BuyFiatController.updateVolumes` | `subdomains/core/sell-crypto/process/buy-fiat.controller.ts` |
| GET | 1 |  | `/country` | public | whole rows | 23 | not yet |  | `CountryController.getAllCountry` | `shared/models/country/country.controller.ts` |
| GET | 1 |  | `/cryptoRoute` | hidden | none | — | n/a |  | `CryptoRouteController.getAllCrypto` | `subdomains/core/buy-crypto/routes/swap/crypto-route.controller.ts` |
| POST | 1 |  | `/cryptoRoute` | hidden | none | — | n/a |  | `CryptoRouteController.createCrypto` | `subdomains/core/buy-crypto/routes/swap/crypto-route.controller.ts` |
| GET | 1 |  | `/cryptoRoute/:id` | hidden | none | — | n/a |  | `CryptoRouteController.getCrypto` | `subdomains/core/buy-crypto/routes/swap/crypto-route.controller.ts` |
| PUT | 1 |  | `/cryptoRoute/:id` | hidden | none | — | n/a |  | `CryptoRouteController.updateCryptoRoute` | `subdomains/core/buy-crypto/routes/swap/crypto-route.controller.ts` |
| GET | 1 |  | `/cryptoRoute/:id/history` | hidden | none | — | n/a |  | `CryptoRouteController.getCryptoRouteHistory` | `subdomains/core/buy-crypto/routes/swap/crypto-route.controller.ts` |
| GET | 1 |  | `/custody` | public | whole rows | 253 | not yet |  | `CustodyController.getUserCustodyBalance` | `subdomains/core/custody/controllers/custody.controller.ts` |
| POST | 1 |  | `/custody` | public | whole rows | 364 | not yet |  | `CustodyController.createCustodyAccount` | `subdomains/core/custody/controllers/custody.controller.ts` |
| GET | 1 |  | `/custody/account` | public | whole rows | 253 | not yet |  | `CustodyAccountController.getCustodyAccounts` | `subdomains/core/custody/controllers/custody-account.controller.ts` |
| POST | 1 |  | `/custody/account` | public | whole rows | 253 | not yet |  | `CustodyAccountController.createCustodyAccount` | `subdomains/core/custody/controllers/custody-account.controller.ts` |
| GET | 1 |  | `/custody/account/:id` | public | whole rows | 253 | not yet |  | `CustodyAccountController.getCustodyAccount` | `subdomains/core/custody/controllers/custody-account.controller.ts` |
| PUT | 1 |  | `/custody/account/:id` | public | whole rows | 253 | not yet |  | `CustodyAccountController.updateCustodyAccount` | `subdomains/core/custody/controllers/custody-account.controller.ts` |
| GET | 1 |  | `/custody/account/:id/access` | public | whole rows | 238 | not yet |  | `CustodyAccountController.getAccessList` | `subdomains/core/custody/controllers/custody-account.controller.ts` |
| POST | 1 |  | `/custody/account/:id/access` | public | whole rows | 253 | not yet |  | `CustodyAccountController.grantAccess` | `subdomains/core/custody/controllers/custody-account.controller.ts` |
| DELETE | 1 |  | `/custody/account/:id/access/:accessId` | public | whole rows | 238 | not yet |  | `CustodyAccountController.revokeAccess` | `subdomains/core/custody/controllers/custody-account.controller.ts` |
| PUT | 1 |  | `/custody/account/:id/access/:accessId` | public | whole rows | 238 | not yet |  | `CustodyAccountController.updateAccess` | `subdomains/core/custody/controllers/custody-account.controller.ts` |
| GET | 1 |  | `/custody/account/:id/balance` | public | whole rows | 253 | not yet |  | `CustodyAccountController.getAccountBalance` | `subdomains/core/custody/controllers/custody-account.controller.ts` |
| GET | 1 |  | `/custody/account/:id/history` | public | whole rows | 253 | not yet |  | `CustodyAccountController.getAccountHistory` | `subdomains/core/custody/controllers/custody-account.controller.ts` |
| GET | 1 |  | `/custody/account/:id/order` | public | whole rows | 253 | not yet |  | `CustodyAccountController.getAccountOrders` | `subdomains/core/custody/controllers/custody-account.controller.ts` |
| GET | 1 |  | `/custody/account/:id/pdf` | public | whole rows | 253 | not yet |  | `CustodyAccountController.getAccountPdf` | `subdomains/core/custody/controllers/custody-account.controller.ts` |
| POST | 1 |  | `/custody/admin/order/:id/approve` | public | whole rows | 119 | not yet |  | `CustodyAdminController.approveOrder` | `subdomains/core/custody/controllers/custody.controller.ts` |
| GET | 1 |  | `/custody/admin/orders` | public | whole rows | 427 | not yet |  | `CustodyAdminController.getOrders` | `subdomains/core/custody/controllers/custody.controller.ts` |
| PUT | 1 |  | `/custody/admin/user/:id/balance` | public | whole rows | 308 | not yet |  | `CustodyAdminController.updateUserBalance` | `subdomains/core/custody/controllers/custody.controller.ts` |
| GET | 1 |  | `/custody/history` | public | whole rows | 253 | not yet |  | `CustodyController.getUserCustodyHistory` | `subdomains/core/custody/controllers/custody.controller.ts` |
| GET | 1 |  | `/custody/order` | public | projected | 14 | 4/4 |  | `CustodyController.getOrders` | `subdomains/core/custody/controllers/custody.controller.ts` |
| POST | 1 |  | `/custody/order` | public | whole rows | 360 | not yet |  | `CustodyController.createOrder` | `subdomains/core/custody/controllers/custody.controller.ts` |
| POST | 1 |  | `/custody/order/:id/confirm` | public | whole rows | 427 | not yet |  | `CustodyController.confirmOrder` | `subdomains/core/custody/controllers/custody.controller.ts` |
| GET | 1 |  | `/custody/pdf` | public | whole rows | 253 | not yet |  | `CustodyController.getCustodyPdf` | `subdomains/core/custody/controllers/custody.controller.ts` |
| GET | 1 |  | `/dashboard/accounting/ledger/accounts` | hidden | whole rows | 54 | not yet | yes | `LedgerController.getAccounts` | `subdomains/core/accounting/controllers/ledger.controller.ts` |
| GET | 1 |  | `/dashboard/accounting/ledger/accounts/:accountId/legs` | hidden | whole rows | 30 | not yet | yes | `LedgerController.getAccountDetail` | `subdomains/core/accounting/controllers/ledger.controller.ts` |
| GET | 1 |  | `/dashboard/accounting/ledger/equity-comparison` | hidden | whole rows | 54 | not yet | yes | `LedgerController.getEquityComparison` | `subdomains/core/accounting/controllers/ledger.controller.ts` |
| GET | 1 |  | `/dashboard/accounting/ledger/margin` | hidden | projected | 4 | 0/4 | yes | `LedgerController.getMargin` | `subdomains/core/accounting/controllers/ledger.controller.ts` |
| GET | 1 |  | `/dashboard/accounting/ledger/reconciliation` | hidden | whole rows | 54 | not yet | yes | `LedgerController.getReconStatus` | `subdomains/core/accounting/controllers/ledger.controller.ts` |
| GET | 1 |  | `/dashboard/accounting/ledger/suspense` | hidden | projected | 10 | 4/4 | yes | `LedgerController.getSuspense` | `subdomains/core/accounting/controllers/ledger.controller.ts` |
| GET | 1 |  | `/dashboard/financial/changes` | hidden | whole rows | 11 | not yet |  | `DashboardFinancialController.getFinancialChanges` | `subdomains/supporting/dashboard/dashboard-financial.controller.ts` |
| GET | 1 |  | `/dashboard/financial/changes/latest` | hidden | whole rows | 11 | not yet |  | `DashboardFinancialController.getLatestChanges` | `subdomains/supporting/dashboard/dashboard-financial.controller.ts` |
| GET | 1 |  | `/dashboard/financial/latest` | hidden | whole rows | 33 | n/a |  | `DashboardFinancialController.getLatestBalance` | `subdomains/supporting/dashboard/dashboard-financial.controller.ts` |
| GET | 1 |  | `/dashboard/financial/log` | hidden | whole rows | 33 | not yet | yes | `DashboardFinancialController.getFinancialLog` | `subdomains/supporting/dashboard/dashboard-financial.controller.ts` |
| GET | 1 |  | `/dashboard/financial/reconciliation` | hidden | whole rows | 229 | not yet |  | `DashboardReconciliationController.getReconciliation` | `subdomains/supporting/dashboard/dashboard-reconciliation.controller.ts` |
| GET | 1 |  | `/dashboard/financial/reconciliation/overview` | hidden | whole rows | 229 | not yet |  | `DashboardReconciliationController.getOverview` | `subdomains/supporting/dashboard/dashboard-reconciliation.controller.ts` |
| GET | 1 |  | `/dashboard/financial/ref-recipients` | hidden | projected | 2 | 0/4 |  | `DashboardFinancialController.getRefRewardRecipients` | `subdomains/supporting/dashboard/dashboard-financial.controller.ts` |
| POST | 1 |  | `/deposit` | hidden | whole rows | 6 | not yet |  | `DepositController.createDeposits` | `subdomains/supporting/address-pool/deposit/deposit.controller.ts` |
| PUT | 1 |  | `/deposit/lightningWebhook` | hidden | none | — | n/a |  | `DepositController.updateLightningDepositWebhook` | `subdomains/supporting/address-pool/deposit/deposit.controller.ts` |
| GET | 1 |  | `/deuro/info` | public | whole rows | 11 | not yet |  | `DEuroController.getInfo` | `integration/blockchain/deuro/controllers/deuro.controller.ts` |
| GET | 1 |  | `/dex/check-liquidity` | hidden | none | — | n/a |  | `DexController.checkLiquidity` | `subdomains/supporting/dex/dex.controller.ts` |
| PUT | 1 |  | `/dex/complete-orders` | hidden | whole rows | 156 | not yet |  | `DexController.completeOrders` | `subdomains/supporting/dex/dex.controller.ts` |
| GET | 1 |  | `/dex/liquidity-after-purchase` | hidden | whole rows | 156 | not yet |  | `DexController.fetchTargetLiquidityAfterPurchase` | `subdomains/supporting/dex/dex.controller.ts` |
| POST | 1 |  | `/dex/purchase-liquidity` | hidden | none | — | n/a |  | `DexController.purchaseLiquidity` | `subdomains/supporting/dex/dex.controller.ts` |
| POST | 1 |  | `/dex/reserve-liquidity` | hidden | none | — | n/a |  | `DexController.reserveLiquidity` | `subdomains/supporting/dex/dex.controller.ts` |
| GET | 1 |  | `/dex/transfer-completion` | hidden | none | — | n/a |  | `DexController.checkTransferCompletion` | `subdomains/supporting/dex/dex.controller.ts` |
| POST | 1 |  | `/dex/transfer-liquidity` | hidden | none | — | n/a |  | `DexController.transferLiquidity` | `subdomains/supporting/dex/dex.controller.ts` |
| GET | 1 |  | `/exchange/:exchange/balances` | hidden | none | — | n/a |  | `ExchangeController.getBalance` | `integration/exchange/controllers/exchange.controller.ts` |
| GET | 1 |  | `/exchange/:exchange/price` | hidden | none | — | n/a |  | `ExchangeController.getPrice` | `integration/exchange/controllers/exchange.controller.ts` |
| PUT | 1 |  | `/exchange/:exchange/sync` | hidden | whole rows | 40 | not yet |  | `ExchangeController.syncExchange` | `integration/exchange/controllers/exchange.controller.ts` |
| GET | 1 |  | `/exchange/:exchange/trade` | hidden | none | — | n/a |  | `ExchangeController.getTrades` | `integration/exchange/controllers/exchange.controller.ts` |
| POST | 1 |  | `/exchange/:exchange/trade` | hidden | none | — | n/a |  | `ExchangeController.trade` | `integration/exchange/controllers/exchange.controller.ts` |
| GET | 1 |  | `/exchange/:exchange/trade/history` | hidden | none | — | n/a |  | `ExchangeController.getTradeHistory` | `integration/exchange/controllers/exchange.controller.ts` |
| POST | 1 |  | `/exchange/:exchange/withdraw` | hidden | none | — | n/a |  | `ExchangeController.withdrawFunds` | `integration/exchange/controllers/exchange.controller.ts` |
| GET | 1 |  | `/exchange/:exchange/withdraw/:id` | hidden | none | — | n/a |  | `ExchangeController.getWithdraw` | `integration/exchange/controllers/exchange.controller.ts` |
| GET | 1 |  | `/exchange/trade/:id` | hidden | none | — | n/a |  | `ExchangeController.getTrade` | `integration/exchange/controllers/exchange.controller.ts` |
| POST | 1 |  | `/faucet` | hidden | whole rows | 308 | not yet |  | `FaucetRequestController.faucetRequest` | `subdomains/core/faucet-request/controller/faucet-request.controller.ts` |
| POST | 1 |  | `/fee` | hidden | whole rows | 65 | not yet |  | `FeeController.createFee` | `subdomains/supporting/payment/controllers/fee.controller.ts` |
| GET | 1 |  | `/fiat` | public | whole rows | 23 | not yet | yes | `FiatController.getAllFiat` | `shared/models/fiat/fiat.controller.ts` |
| POST | 1 |  | `/fiatOutput` | hidden | whole rows | 377 | not yet |  | `FiatOutputController.create` | `subdomains/supporting/fiat-output/fiat-output.controller.ts` |
| PUT | 1 |  | `/fiatOutput/:id` | hidden | whole rows | 59 | not yet |  | `FiatOutputController.update` | `subdomains/supporting/fiat-output/fiat-output.controller.ts` |
| GET | 1 |  | `/frankencoin/info` | public | whole rows | 11 | not yet |  | `FrankencoinController.getInfo` | `integration/blockchain/frankencoin/controllers/frankencoin.controller.ts` |
| POST | 1 |  | `/gs/db` | hidden | caller-defined | 13 | n/a | yes | `GsController.getDbData` | `subdomains/generic/gs/gs.controller.ts` |
| POST | 1 |  | `/gs/db/custom` | hidden | caller-defined | 2 | n/a | yes | `GsController.getExtendedData` | `subdomains/generic/gs/gs.controller.ts` |
| POST | 1 |  | `/gs/debug` | hidden | projected | — | n/a | yes | `GsController.executeDebugQuery` | `subdomains/generic/gs/gs.controller.ts` |
| POST | 1 |  | `/gs/evm/bridgeApproval` | hidden | whole rows | 33 | not yet |  | `GsEvmController.approveBridge` | `subdomains/generic/gs/gs-evm.controller.ts` |
| POST | 1 |  | `/gs/evm/coinTransaction` | hidden | whole rows | 6 | not yet |  | `GsEvmController.sendCoinTransaction` | `subdomains/generic/gs/gs-evm.controller.ts` |
| POST | 1 |  | `/gs/evm/contractApproval` | hidden | whole rows | 33 | not yet |  | `GsEvmController.approveContract` | `subdomains/generic/gs/gs-evm.controller.ts` |
| POST | 1 |  | `/gs/evm/contractTransaction` | hidden | none | — | n/a |  | `GsEvmController.sendContractTransaction` | `subdomains/generic/gs/gs-evm.controller.ts` |
| POST | 1 |  | `/gs/evm/rawTransaction` | hidden | whole rows | 6 | not yet |  | `GsEvmController.sendRawTransaction` | `subdomains/generic/gs/gs-evm.controller.ts` |
| POST | 1 |  | `/gs/evm/tokenTransaction` | hidden | whole rows | 33 | not yet |  | `GsEvmController.sendTokenTransaction` | `subdomains/generic/gs/gs-evm.controller.ts` |
| GET | 1 |  | `/gs/support` | hidden | whole rows | 906 | not yet | yes | `GsController.getSupportData` | `subdomains/generic/gs/gs.controller.ts` |
| GET | neutral |  | `/health` | public | whole rows | 4 | n/a |  | `HealthController.getHealth` | `subdomains/core/monitoring/health.controller.ts` |
| GET | neutral |  | `/health/banking` | public | whole rows | 4 | n/a |  | `HealthController.getBankingHealth` | `subdomains/core/monitoring/health.controller.ts` |
| GET | neutral |  | `/health/external` | public | whole rows | 4 | n/a |  | `HealthController.getExternalHealth` | `subdomains/core/monitoring/health.controller.ts` |
| GET | neutral |  | `/health/liquidity` | public | whole rows | 4 | n/a |  | `HealthController.getLiquidityHealth` | `subdomains/core/monitoring/health.controller.ts` |
| GET | neutral |  | `/health/nodes` | public | whole rows | 4 | n/a |  | `HealthController.getNodeHealth` | `subdomains/core/monitoring/health.controller.ts` |
| GET | neutral |  | `/health/payment` | public | whole rows | 4 | n/a |  | `HealthController.getPaymentHealth` | `subdomains/core/monitoring/health.controller.ts` |
| GET | 1 |  | `/history` | hidden | whole rows | 1363 | not yet |  | `HistoryController.getHistory` | `subdomains/core/history/controllers/history.controller.ts` |
| GET | 1 |  | `/history/:exportType` | hidden | whole rows | 1363 | not yet |  | `HistoryController.getApiHistory` | `subdomains/core/history/controllers/history.controller.ts` |
| GET | 1 |  | `/history/csv` | hidden | none | — | n/a |  | `HistoryController.getCsv` | `subdomains/core/history/controllers/history.controller.ts` |
| POST | 1 |  | `/history/csv` | hidden | whole rows | 1363 | not yet |  | `HistoryController.createCsv` | `subdomains/core/history/controllers/history.controller.ts` |
| GET | 1 |  | `/ikna/bfs/:id` | hidden | none | — | n/a |  | `IknaController.getBfsResult` | `integration/ikna/controllers/ikna.controller.ts` |
| POST | 1 |  | `/ikna/bfs/address` | hidden | none | — | n/a |  | `IknaController.createBfsAddressRequest` | `integration/ikna/controllers/ikna.controller.ts` |
| GET | 1 |  | `/ikna/tag` | hidden | none | — | n/a |  | `IknaController.getIknaAddressTag` | `integration/ikna/controllers/ikna.controller.ts` |
| GET | 1 |  | `/juice/info` | public | whole rows | 11 | not yet |  | `JuiceController.getInfo` | `integration/blockchain/juice/controllers/juice.controller.ts` |
| GET | 1 | yes | `/kyc` | public | whole rows | 351 | not yet |  | `KycController.getKycProgressV1` | `subdomains/generic/user/models/kyc/kyc.controller.ts` |
| GET | 2 |  | `/kyc` | public | whole rows | 351 | not yet |  | `KycController.getKycLevel` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| POST | 1 | yes | `/kyc` | public | whole rows | 351 | not yet |  | `KycController.requestKycV1` | `subdomains/generic/user/models/kyc/kyc.controller.ts` |
| PUT | 2 |  | `/kyc` | public | whole rows | 364 | not yet |  | `KycController.continueKyc` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| GET | 2 |  | `/kyc/2fa` | public | whole rows | 253 | not yet |  | `KycController.check2fa` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| POST | 2 |  | `/kyc/2fa` | public | whole rows | 253 | not yet |  | `KycController.start2fa` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| POST | 2 |  | `/kyc/2fa/verify` | public | whole rows | 253 | not yet |  | `KycController.verify2fa` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| GET | 1 | yes | `/kyc/:code` | public | whole rows | 351 | not yet |  | `KycController.getKycProgressByCodeV1` | `subdomains/generic/user/models/kyc/kyc.controller.ts` |
| POST | 1 | yes | `/kyc/:code` | public | whole rows | 351 | not yet |  | `KycController.requestKycByCodeV1` | `subdomains/generic/user/models/kyc/kyc.controller.ts` |
| GET | 1 | yes | `/kyc/:code/countries` | public | whole rows | 351 | not yet |  | `KycController.getKycCountriesByCodeV1` | `subdomains/generic/user/models/kyc/kyc.controller.ts` |
| GET | 1 | yes | `/kyc/:id/documents` | public | projected | 2 | 4/4 |  | `KycClientController.getKycFilesV1` | `subdomains/generic/user/models/kyc/kyc.controller.ts` |
| GET | 1 | yes | `/kyc/:id/documents/:type` | public | whole rows | 328 | not yet |  | `KycClientController.getKycFileV1` | `subdomains/generic/user/models/kyc/kyc.controller.ts` |
| GET | 2 |  | `/kyc/:step` | hidden | whole rows | 364 | not yet |  | `KycController.initiateStep` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| DELETE | 1 |  | `/kyc/admin/blacklist/ip` | hidden | none | — | n/a |  | `KycAdminController.deleteIpToBlacklist` | `subdomains/generic/kyc/controllers/kyc-admin.controller.ts` |
| PUT | 1 |  | `/kyc/admin/blacklist/ip` | hidden | projected | 1 | 0/4 |  | `KycAdminController.addIpToBlacklist` | `subdomains/generic/kyc/controllers/kyc-admin.controller.ts` |
| POST | 1 |  | `/kyc/admin/ident/file/sync` | hidden | whole rows | 243 | not yet |  | `KycAdminController.syncIdentFiles` | `subdomains/generic/kyc/controllers/kyc-admin.controller.ts` |
| POST | 1 |  | `/kyc/admin/log` | hidden | whole rows | 253 | not yet |  | `KycAdminController.createLog` | `subdomains/generic/kyc/controllers/kyc-admin.controller.ts` |
| PUT | 1 |  | `/kyc/admin/log/:id` | hidden | whole rows | 17 | not yet |  | `KycAdminController.updateLog` | `subdomains/generic/kyc/controllers/kyc-admin.controller.ts` |
| PUT | 1 |  | `/kyc/admin/nameCheck/:id` | hidden | whole rows | 245 | not yet |  | `KycAdminController.updateNameCheckLog` | `subdomains/generic/kyc/controllers/kyc-admin.controller.ts` |
| PUT | 1 |  | `/kyc/admin/step/:id` | hidden | whole rows | 385 | not yet |  | `KycAdminController.updateKycStep` | `subdomains/generic/kyc/controllers/kyc-admin.controller.ts` |
| POST | 1 |  | `/kyc/admin/webhook` | hidden | whole rows | 364 | not yet |  | `KycAdminController.triggerWebhook` | `subdomains/generic/kyc/controllers/kyc-admin.controller.ts` |
| GET | 2 |  | `/kyc/client/payments` | public | whole rows | 1091 | not yet |  | `KycClientController.getAllPayments` | `subdomains/generic/kyc/controllers/kyc-client.controller.ts` |
| GET | 2 |  | `/kyc/client/users` | public | whole rows | 20 | not yet |  | `KycClientController.getAllKycData` | `subdomains/generic/kyc/controllers/kyc-client.controller.ts` |
| GET | 2 |  | `/kyc/client/users/:id/documents` | public | whole rows | 78 | not yet |  | `KycClientController.getKycFiles` | `subdomains/generic/kyc/controllers/kyc-client.controller.ts` |
| GET | 2 |  | `/kyc/client/users/:id/documents/:type` | public | whole rows | 78 | not yet |  | `KycClientController.getKycFile` | `subdomains/generic/kyc/controllers/kyc-client.controller.ts` |
| GET | 2 |  | `/kyc/client/users/:id/payments` | public | whole rows | 1091 | not yet |  | `KycClientController.getUserPayments` | `subdomains/generic/kyc/controllers/kyc-client.controller.ts` |
| GET | 1 | yes | `/kyc/countries` | public | whole rows | 351 | not yet |  | `KycController.getKycCountriesV1` | `subdomains/generic/user/models/kyc/kyc.controller.ts` |
| GET | 2 | yes | `/kyc/countries` | public | whole rows | 351 | not yet |  | `KycController.getKycCountries` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| DELETE | 2 |  | `/kyc/data/:type/:id` | public | whole rows | 351 | not yet |  | `KycController.cancelStep` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | 2 |  | `/kyc/data/additional/:id` | public | whole rows | 364 | not yet |  | `KycController.updateAdditionalDocumentsData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | 2 |  | `/kyc/data/address/:id` | public | whole rows | 364 | not yet |  | `KycController.updateAddressChangeData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | 2 |  | `/kyc/data/authority/:id` | public | whole rows | 364 | not yet |  | `KycController.updateAuthorityData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | 2 |  | `/kyc/data/beneficial/:id` | public | whole rows | 364 | not yet |  | `KycController.updateBeneficialData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | 2 |  | `/kyc/data/confirmation/:id` | public | whole rows | 364 | not yet |  | `KycController.updateSoleProprietorshipConfirmationData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | 2 |  | `/kyc/data/contact/:id` | public | whole rows | 364 | not yet |  | `KycController.updateContactData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| GET | 2 |  | `/kyc/data/financial/:id` | public | whole rows | 351 | not yet |  | `KycController.getFinancialData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | 2 |  | `/kyc/data/financial/:id` | public | whole rows | 364 | not yet |  | `KycController.updateFinancialData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | 2 |  | `/kyc/data/legal/:id` | public | whole rows | 364 | not yet |  | `KycController.updateCommercialRegisterData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | 2 |  | `/kyc/data/name/:id` | public | whole rows | 364 | not yet |  | `KycController.updateNameChangeData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | 2 |  | `/kyc/data/nationality/:id` | public | whole rows | 364 | not yet |  | `KycController.updateNationalityData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | 2 |  | `/kyc/data/operational/:id` | public | whole rows | 364 | not yet |  | `KycController.updateOperationalData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | 2 |  | `/kyc/data/owner/:id` | public | whole rows | 364 | not yet |  | `KycController.updateOwnerDirectoryData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | 2 |  | `/kyc/data/payment/:id` | public | whole rows | 364 | not yet |  | `KycController.updatePaymentsData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | 2 |  | `/kyc/data/personal/:id` | public | whole rows | 364 | not yet |  | `KycController.updatePersonalData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | 2 |  | `/kyc/data/phone/:id` | public | whole rows | 364 | not yet |  | `KycController.updatePhoneChangeData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | 2 |  | `/kyc/data/recall/:id` | public | whole rows | 364 | not yet |  | `KycController.updateRecallAgreement` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | 2 |  | `/kyc/data/recommendation/:id` | public | whole rows | 643 | not yet |  | `KycController.updateRecommendationData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | 2 |  | `/kyc/data/residence/:id` | public | whole rows | 364 | not yet |  | `KycController.updateResidencePermitData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | 2 |  | `/kyc/data/signatory/:id` | public | whole rows | 364 | not yet |  | `KycController.updateSignatoryPowerData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | 2 |  | `/kyc/data/statutes/:id` | public | whole rows | 364 | not yet |  | `KycController.updateStatutesData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| GET | 2 |  | `/kyc/file/:id` | public | whole rows | 264 | not yet |  | `KycController.getFile` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | 2 |  | `/kyc/ident/manual/:id` | public | whole rows | 364 | not yet |  | `KycController.updateIdentData` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| POST | 2 |  | `/kyc/ident/sumsub` | hidden | whole rows | 364 | not yet |  | `KycController.sumsubWebhook` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| DELETE | 2 |  | `/kyc/transfer` | hidden | whole rows | 351 | not yet |  | `KycController.removeKycClient` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| POST | 2 |  | `/kyc/transfer` | hidden | whole rows | 364 | not yet |  | `KycController.addKycClient` | `subdomains/generic/kyc/controllers/kyc.controller.ts` |
| PUT | 1 | yes | `/kyc/transfer` | public | whole rows | 364 | not yet |  | `KycController.transferKycDataV1` | `subdomains/generic/user/models/kyc/kyc.controller.ts` |
| GET | 1 | yes | `/kyc/users` | public | projected | 7 | 4/4 |  | `KycClientController.getAllKycDataV1` | `subdomains/generic/user/models/kyc/kyc.controller.ts` |
| GET | 1 |  | `/language` | public | whole rows | 7 | not yet |  | `LanguageController.getAllLanguage` | `shared/models/language/language.controller.ts` |
| PUT | 1 |  | `/limitRequest/:id` | hidden | whole rows | 364 | not yet |  | `LimitRequestController.updateUserData` | `subdomains/supporting/support-issue/limit-request.controller.ts` |
| GET | 1 |  | `/liquidityManagement/balance` | hidden | whole rows | 40 | not yet |  | `LiquidityBalanceController.getBalances` | `subdomains/core/liquidity-management/controllers/balance.controller.ts` |
| PUT | 1 |  | `/liquidityManagement/order/:id/resolveUncertain` | hidden | whole rows | 139 | not yet |  | `LiquidityManagementOrderController.resolveUncertainOrder` | `subdomains/core/liquidity-management/controllers/order.controller.ts` |
| GET | 1 |  | `/liquidityManagement/order/in-progress` | hidden | whole rows | 139 | not yet |  | `LiquidityManagementOrderController.getProcessingOrders` | `subdomains/core/liquidity-management/controllers/order.controller.ts` |
| GET | 1 |  | `/liquidityManagement/pipeline/:id/status` | hidden | projected | 2 | 4/4 |  | `LiquidityManagementPipelineController.getPipelineStatus` | `subdomains/core/liquidity-management/controllers/pipeline.controller.ts` |
| POST | 1 |  | `/liquidityManagement/pipeline/buy` | hidden | whole rows | 112 | not yet |  | `LiquidityManagementPipelineController.buyLiquidity` | `subdomains/core/liquidity-management/controllers/pipeline.controller.ts` |
| GET | 1 |  | `/liquidityManagement/pipeline/in-progress` | hidden | whole rows | 112 | not yet |  | `LiquidityManagementPipelineController.getProcessingPipelines` | `subdomains/core/liquidity-management/controllers/pipeline.controller.ts` |
| POST | 1 |  | `/liquidityManagement/pipeline/sell` | hidden | whole rows | 112 | not yet |  | `LiquidityManagementPipelineController.sellLiquidity` | `subdomains/core/liquidity-management/controllers/pipeline.controller.ts` |
| GET | 1 |  | `/liquidityManagement/pipeline/stopped` | hidden | whole rows | 112 | not yet |  | `LiquidityManagementPipelineController.getStoppedPipelines` | `subdomains/core/liquidity-management/controllers/pipeline.controller.ts` |
| POST | 1 |  | `/liquidityManagement/rule` | hidden | whole rows | 83 | not yet |  | `LiquidityManagementRuleController.createRule` | `subdomains/core/liquidity-management/controllers/rule.controller.ts` |
| GET | 1 |  | `/liquidityManagement/rule/:id` | hidden | whole rows | 83 | not yet |  | `LiquidityManagementRuleController.getRule` | `subdomains/core/liquidity-management/controllers/rule.controller.ts` |
| PUT | 1 |  | `/liquidityManagement/rule/:id` | hidden | whole rows | 83 | not yet |  | `LiquidityManagementRuleController.updateRule` | `subdomains/core/liquidity-management/controllers/rule.controller.ts` |
| PATCH | 1 |  | `/liquidityManagement/rule/:id/deactivate` | hidden | whole rows | 83 | not yet |  | `LiquidityManagementRuleController.deactivateRule` | `subdomains/core/liquidity-management/controllers/rule.controller.ts` |
| PATCH | 1 |  | `/liquidityManagement/rule/:id/reactivate` | hidden | whole rows | 83 | not yet |  | `LiquidityManagementRuleController.reactivateRule` | `subdomains/core/liquidity-management/controllers/rule.controller.ts` |
| PATCH | 1 |  | `/liquidityManagement/rule/:id/settings` | hidden | whole rows | 83 | not yet |  | `LiquidityManagementRuleController.setReactivationTime` | `subdomains/core/liquidity-management/controllers/rule.controller.ts` |
| GET | 1 |  | `/lnurla` | public | whole rows | 643 | not yet |  | `AuthLnurlController.signInWithLnurlAuth` | `subdomains/generic/user/models/auth/auth-lnurl.controller.ts` |
| POST | 1 |  | `/lnurla` | public | none | — | n/a |  | `AuthLnurlController.getLnurlAuth` | `subdomains/generic/user/models/auth/auth-lnurl.controller.ts` |
| GET | 1 |  | `/lnurla/status` | public | none | — | n/a |  | `AuthLnurlController.lnurlAuthStatus` | `subdomains/generic/user/models/auth/auth-lnurl.controller.ts` |
| GET | 1 |  | `/lnurld/:id` | public | none | — | n/a | yes | `LnurldForwardController.lnurldForward` | `subdomains/generic/forwarding/controllers/lnurld-forward.controller.ts` |
| GET | 1 |  | `/lnurld/cb/:id/:var` | public | none | — | n/a | yes | `LnurldForwardController.lnurldCallbackForward` | `subdomains/generic/forwarding/controllers/lnurld-forward.controller.ts` |
| GET | 1 |  | `/lnurlp/:id` | public | whole rows | 545 | not yet | yes | `LnUrlPForwardController.lnUrlPForward` | `subdomains/generic/forwarding/controllers/lnurlp-forward.controller.ts` |
| POST | 1 |  | `/lnurlp/:id` | public | whole rows | 545 | not yet |  | `LnUrlPForwardController.activatePublicPayment` | `subdomains/generic/forwarding/controllers/lnurlp-forward.controller.ts` |
| DELETE | 1 |  | `/lnurlp/cancel/:id` | public | whole rows | 545 | not yet |  | `LnUrlPForwardController.cancelPayment` | `subdomains/generic/forwarding/controllers/lnurlp-forward.controller.ts` |
| GET | 1 |  | `/lnurlp/cb/:id` | public | whole rows | 545 | not yet | yes | `LnUrlPForwardController.lnUrlPCallbackForward` | `subdomains/generic/forwarding/controllers/lnurlp-forward.controller.ts` |
| GET | 1 |  | `/lnurlp/tx/:id` | public | whole rows | 558 | not yet |  | `LnUrlPForwardController.txHexForward` | `subdomains/generic/forwarding/controllers/lnurlp-forward.controller.ts` |
| GET | 1 |  | `/lnurlp/wait/:id` | public | whole rows | 545 | not yet |  | `LnUrlPForwardController.waitForPayment` | `subdomains/generic/forwarding/controllers/lnurlp-forward.controller.ts` |
| GET | 1 |  | `/lnurlw/:id` | public | none | — | n/a | yes | `LnUrlWForwardController.lnUrlWForward` | `subdomains/generic/forwarding/controllers/lnurlw-forward.controller.ts` |
| GET | 1 |  | `/lnurlw/cb/:id` | public | none | — | n/a | yes | `LnUrlWForwardController.lnUrlWCallbackForward` | `subdomains/generic/forwarding/controllers/lnurlw-forward.controller.ts` |
| POST | 1 |  | `/log` | hidden | whole rows | 11 | not yet |  | `LogController.create` | `subdomains/supporting/log/log.controller.ts` |
| PUT | 1 |  | `/log/:id` | hidden | whole rows | 11 | not yet |  | `LogController.update` | `subdomains/supporting/log/log.controller.ts` |
| POST | 1 |  | `/log/clientError` | public | none | — | n/a | yes | `ClientErrorController.logError` | `subdomains/supporting/log/client-error.controller.ts` |
| PUT | 1 |  | `/log/financial/validity` | hidden | projected | 2 | 0/4 |  | `LogController.setFinancialLogValidity` | `subdomains/supporting/log/log.controller.ts` |
| GET | 1 |  | `/monitoring/data` | hidden | whole rows | 4 | n/a |  | `MonitoringController.getSystemState` | `subdomains/core/monitoring/monitoring.controller.ts` |
| POST | 1 |  | `/monitoring/data` | hidden | none | — | n/a |  | `MonitoringController.onWebhook` | `subdomains/core/monitoring/monitoring.controller.ts` |
| GET | 1 |  | `/mros` | hidden | whole rows | 243 | not yet |  | `MrosController.getAll` | `subdomains/supporting/mros/mros.controller.ts` |
| POST | 1 |  | `/mros` | hidden | whole rows | 253 | not yet |  | `MrosController.createMros` | `subdomains/supporting/mros/mros.controller.ts` |
| GET | 1 |  | `/mros/:id` | hidden | whole rows | 243 | not yet |  | `MrosController.getById` | `subdomains/supporting/mros/mros.controller.ts` |
| PUT | 1 |  | `/mros/:id` | hidden | whole rows | 98 | not yet |  | `MrosController.updateMros` | `subdomains/supporting/mros/mros.controller.ts` |
| POST | 1 |  | `/node/:node/:mode/cmd` | hidden | none | — | n/a |  | `NodeController.cmdForMode` | `integration/blockchain/bitcoin/node/node.controller.ts` |
| POST | 1 |  | `/node/:node/:mode/rpc` | hidden | none | — | n/a |  | `NodeController.rpcForMode` | `integration/blockchain/bitcoin/node/node.controller.ts` |
| GET | 1 |  | `/node/:node/:mode/tx/:txId` | hidden | none | — | n/a |  | `NodeController.waitForTxForMode` | `integration/blockchain/bitcoin/node/node.controller.ts` |
| POST | 1 |  | `/node/:node/cmd` | hidden | none | — | n/a |  | `NodeController.cmd` | `integration/blockchain/bitcoin/node/node.controller.ts` |
| POST | 1 |  | `/node/:node/rpc` | hidden | none | — | n/a |  | `NodeController.rpc` | `integration/blockchain/bitcoin/node/node.controller.ts` |
| GET | 1 |  | `/node/:node/tx/:txId` | hidden | none | — | n/a |  | `NodeController.waitForTx` | `integration/blockchain/bitcoin/node/node.controller.ts` |
| POST | 1 |  | `/notification/send-mail` | hidden | whole rows | 13 | not yet |  | `NotificationController.sendMail` | `subdomains/supporting/notification/notification.controller.ts` |
| POST | 1 |  | `/payIn` | hidden | whole rows | 545 | not yet |  | `PayInController.createPayIn` | `subdomains/supporting/payin/controllers/payin.controller.ts` |
| POST | 1 |  | `/payIn/lnurlpDeposit/:uniqueId` | hidden | none | — | n/a |  | `PayInWebhookController.deposit` | `subdomains/supporting/payin/controllers/payin-webhook.controller.ts` |
| POST | 1 |  | `/payIn/lnurlpPayment/:uniqueId` | hidden | none | — | n/a |  | `PayInWebhookController.payment` | `subdomains/supporting/payin/controllers/payin-webhook.controller.ts` |
| POST | 1 |  | `/payIn/poll` | hidden | none | — | n/a |  | `PayInController.pollAddress` | `subdomains/supporting/payin/controllers/payin.controller.ts` |
| POST | 1 |  | `/payIn/retry` | hidden | whole rows | — | not yet |  | `PayInController.retryUncertainSend` | `subdomains/supporting/payin/controllers/payin.controller.ts` |
| GET | 1 |  | `/paymentLink` | public | whole rows | 513 | not yet | yes | `PaymentLinkController.getAllPaymentLinks` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| POST | 1 |  | `/paymentLink` | public | whole rows | 545 | not yet |  | `PaymentLinkController.createPaymentLink` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| PUT | 1 |  | `/paymentLink` | public | whole rows | 513 | not yet |  | `PaymentLinkController.updatePaymentLink` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| DELETE | 1 |  | `/paymentLink/:id` | hidden | whole rows | 195 | not yet |  | `PaymentLinkController.deletePaymentLink` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| PUT | 1 |  | `/paymentLink/:id` | hidden | whole rows | 513 | not yet |  | `PaymentLinkController.updatePaymentLinkAdmin` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| PUT | 1 |  | `/paymentLink/:id/pos` | hidden | projected | 7 | 4/4 |  | `PaymentLinkController.createPosLinkAdmin` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| PUT | 1 |  | `/paymentLink/assign` | public | whole rows | 513 | not yet | yes | `PaymentLinkController.assignPaymentLink` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| GET | 1 |  | `/paymentLink/config` | public | whole rows | 253 | not yet |  | `PaymentLinkController.getUserPaymentLinksConfig` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| PUT | 1 |  | `/paymentLink/config` | public | whole rows | 253 | not yet |  | `PaymentLinkController.updateUserPaymentLinksConfig` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| GET | 1 |  | `/paymentLink/history` | public | whole rows | 545 | not yet |  | `PaymentLinkController.getPaymentHistory` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| POST | 1 |  | `/paymentLink/integration/binance/activate/:id` | hidden | whole rows | 513 | not yet |  | `C2BPaymentLinkController.activateBinancePay` | `subdomains/core/payment-link/controllers/c2b-payment-link.controller.ts` |
| POST | 1 |  | `/paymentLink/integration/binance/webhook` | hidden | whole rows | 545 | not yet |  | `C2BPaymentLinkController.binancePayWebhook` | `subdomains/core/payment-link/controllers/c2b-payment-link.controller.ts` |
| POST | 1 |  | `/paymentLink/integration/kucoin/activate/:id` | hidden | whole rows | 513 | not yet |  | `C2BPaymentLinkController.activateKucoinPay` | `subdomains/core/payment-link/controllers/c2b-payment-link.controller.ts` |
| POST | 1 |  | `/paymentLink/integrations/kucoin/webhook/cancel` ⚠️ | hidden | none | — | n/a |  | `C2BPaymentLinkController.kucoinPayWebhook` | `subdomains/core/payment-link/controllers/c2b-payment-link.controller.ts` |
| POST | 1 |  | `/paymentLink/integrations/kucoin/webhook/success` | hidden | none | — | n/a |  | `C2BPaymentLinkController.kucoinPayWebhook` | `subdomains/core/payment-link/controllers/c2b-payment-link.controller.ts` |
| GET | 1 |  | `/paymentLink/locations` | public | whole rows | 513 | not yet |  | `PaymentLinkController.getLocations` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| POST | 1 |  | `/paymentLink/merchant` | public | whole rows | 253 | not yet |  | `PaymentLinkController.createMerchant` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| DELETE | 1 |  | `/paymentLink/payment` | public | whole rows | 545 | not yet |  | `PaymentLinkController.cancelPayment` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| GET | 1 |  | `/paymentLink/payment` | hidden | whole rows | 545 | not yet | yes | `PaymentLinkController.createInvoicePayment` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| POST | 1 |  | `/paymentLink/payment` | public | whole rows | 545 | not yet |  | `PaymentLinkController.createPayment` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| PUT | 1 |  | `/paymentLink/payment/:id` | hidden | whole rows | 545 | not yet |  | `PaymentLinkController.updatePaymentLinkPayment` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| PUT | 1 |  | `/paymentLink/payment/confirm` | public | whole rows | 513 | not yet |  | `PaymentLinkController.confirmPayment` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| GET | 1 |  | `/paymentLink/payment/wait` | public | whole rows | 513 | not yet |  | `PaymentLinkController.waitForPayment` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| PUT | 1 |  | `/paymentLink/pos` | public | whole rows | 513 | not yet |  | `PaymentLinkController.createPosLink` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| GET | 1 |  | `/paymentLink/recipient` | hidden | whole rows | 472 | not yet |  | `PaymentLinkController.getPaymentRecipient` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| GET | 1 |  | `/paymentLink/standard` | public | none | — | n/a |  | `PaymentStandardController.getAll` | `subdomains/core/payment-link/controllers/payment-standard.controller.ts` |
| GET | 1 |  | `/paymentLink/standard/:id` | public | none | — | n/a |  | `PaymentStandardController.getById` | `subdomains/core/payment-link/controllers/payment-standard.controller.ts` |
| GET | 1 |  | `/paymentLink/stickers` | hidden | whole rows | 513 | not yet | yes | `PaymentLinkController.generateOcpStickers` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| GET | 1 |  | `/paymentLink/walletApp` | public | whole rows | 33 | not yet |  | `WalletAppController.getAll` | `subdomains/core/payment-link/controllers/wallet-app.controller.ts` |
| GET | 1 |  | `/paymentLink/walletApp/:id` | public | whole rows | 33 | not yet |  | `WalletAppController.getById` | `subdomains/core/payment-link/controllers/wallet-app.controller.ts` |
| GET | 1 |  | `/paymentLink/walletApp/recommended` | public | whole rows | 33 | not yet |  | `WalletAppController.getRecommended` | `subdomains/core/payment-link/controllers/wallet-app.controller.ts` |
| POST | 1 |  | `/payout` | hidden | none | — | n/a |  | `PayoutController.doPayout` | `subdomains/supporting/payout/payout.controller.ts` |
| GET | 1 |  | `/payout/completion` | hidden | whole rows | 123 | not yet |  | `PayoutController.checkOrderCompletion` | `subdomains/supporting/payout/payout.controller.ts` |
| POST | 1 |  | `/payout/retry` | hidden | whole rows | 123 | not yet |  | `PayoutController.retryUncertainPayout` | `subdomains/supporting/payout/payout.controller.ts` |
| POST | 1 |  | `/payout/speedup` | hidden | whole rows | 123 | not yet |  | `PayoutController.speedupTransaction` | `subdomains/supporting/payout/payout.controller.ts` |
| GET | neutral |  | `/pl` | hidden | whole rows | 545 | not yet |  | `PaymentForwardController.lnUrlPForward` | `subdomains/generic/forwarding/controllers/payment-forward.controller.ts` |
| GET | 1 |  | `/plp` | hidden | whole rows | 545 | not yet |  | `PaymentLinkShortController.createInvoicePayment` | `subdomains/core/payment-link/controllers/payment-link.controller.ts` |
| GET | 1 |  | `/pricing` | hidden | none | — | n/a |  | `PricingController.getRawPrice` | `subdomains/supporting/pricing/pricing.controller.ts` |
| PUT | 1 |  | `/pricing` | hidden | whole rows | 53 | not yet |  | `PricingController.updatePrices` | `subdomains/supporting/pricing/pricing.controller.ts` |
| GET | 1 |  | `/pricing/price` | hidden | whole rows | 33 | not yet |  | `PricingController.getPrice` | `subdomains/supporting/pricing/pricing.controller.ts` |
| GET | 1 |  | `/realunit/account/:address` | public | whole rows | 40 | not yet |  | `RealUnitController.getAccountSummary` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | 1 |  | `/realunit/account/:address/history` | public | none | — | n/a |  | `RealUnitController.getAccountHistory` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | 1 |  | `/realunit/admin/quotes` | hidden | whole rows | 112 | not yet |  | `RealUnitController.getAdminQuotes` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| PUT | 1 |  | `/realunit/admin/quotes/:id/confirm-payment` | hidden | whole rows | 62 | not yet |  | `RealUnitController.confirmPaymentReceived` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| PUT | 1 |  | `/realunit/admin/registration/:id/forward` | hidden | whole rows | 493 | not yet | yes | `RealUnitController.forwardRegistration` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | 1 |  | `/realunit/admin/transactions` | hidden | whole rows | 362 | not yet |  | `RealUnitController.getAdminTransactions` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| POST | 1 |  | `/realunit/balance/pdf` | public | whole rows | 308 | not yet | yes | `RealUnitController.getBalancePdf` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | 1 | yes | `/realunit/brokerbot/buyPrice` | public | none | — | n/a |  | `RealUnitController.getBrokerbotBuyPrice` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | 1 | yes | `/realunit/brokerbot/buyShares` | public | none | — | n/a |  | `RealUnitController.getBrokerbotBuyShares` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | 1 | yes | `/realunit/brokerbot/info` | public | whole rows | 33 | not yet |  | `RealUnitController.getBrokerbotInfo` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | 1 | yes | `/realunit/brokerbot/price` | public | none | — | n/a |  | `RealUnitController.getBrokerbotPrice` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | 1 | yes | `/realunit/brokerbot/sellPrice` | public | whole rows | 308 | not yet |  | `RealUnitController.getBrokerbotSellPrice` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | 1 | yes | `/realunit/brokerbot/sellShares` | public | whole rows | 308 | not yet |  | `RealUnitController.getBrokerbotSellShares` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| PUT | 1 |  | `/realunit/buy` | public | whole rows | 360 | not yet | yes | `RealUnitController.getPaymentInfo` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| PUT | 1 |  | `/realunit/buy/:id/confirm` | public | whole rows | 484 | not yet |  | `RealUnitController.confirmBuy` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | 1 |  | `/realunit/compliance/customers` | hidden | whole rows | 308 | not yet |  | `RealUnitComplianceController.searchCustomers` | `subdomains/supporting/realunit/controllers/realunit-compliance.controller.ts` |
| GET | 1 |  | `/realunit/compliance/customers/:id` | hidden | whole rows | 1039 | not yet |  | `RealUnitComplianceController.getCustomer` | `subdomains/supporting/realunit/controllers/realunit-compliance.controller.ts` |
| GET | 1 |  | `/realunit/compliance/customers/:id/dossier` | hidden | whole rows | 264 | not yet |  | `RealUnitComplianceController.downloadCustomerDossier` | `subdomains/supporting/realunit/controllers/realunit-compliance.controller.ts` |
| GET | 1 |  | `/realunit/compliance/customers/:id/files` | hidden | whole rows | 264 | not yet |  | `RealUnitComplianceController.getCustomerFiles` | `subdomains/supporting/realunit/controllers/realunit-compliance.controller.ts` |
| GET | 1 |  | `/realunit/compliance/customers/:id/files/:uid` | hidden | whole rows | 264 | not yet |  | `RealUnitComplianceController.downloadCustomerFile` | `subdomains/supporting/realunit/controllers/realunit-compliance.controller.ts` |
| GET | 1 |  | `/realunit/confirm-aktionariat` | public | whole rows | 15 | not yet | yes | `RealUnitController.confirmAktionariat` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | 1 |  | `/realunit/holders` | public | none | — | n/a |  | `RealUnitController.getHolders` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | 1 |  | `/realunit/legal` | public | whole rows | 308 | not yet | yes | `RealUnitLegalController.getLegal` | `subdomains/supporting/realunit/controllers/realunit-legal.controller.ts` |
| PUT | 1 |  | `/realunit/legal` | public | whole rows | 308 | not yet | yes | `RealUnitLegalController.acceptLegal` | `subdomains/supporting/realunit/controllers/realunit-legal.controller.ts` |
| GET | 1 |  | `/realunit/pay/:id/status` | public | whole rows | 32 | not yet | yes | `RealUnitController.getOcpPayStatus` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| PUT | 1 |  | `/realunit/pay/submit` | public | whole rows | 558 | not yet | yes | `RealUnitController.submitOcpPay` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| PUT | 1 |  | `/realunit/pay/unsigned-transaction` | public | whole rows | 545 | not yet | yes | `RealUnitController.getOcpPayUnsignedTransaction` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | 1 |  | `/realunit/price` | public | whole rows | 33 | not yet |  | `RealUnitController.getRealUnitPrice` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | 1 |  | `/realunit/price/history` | public | whole rows | 40 | not yet |  | `RealUnitController.getHistoricalPrice` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | 1 |  | `/realunit/quote/buyPrice` | public | none | — | n/a |  | `RealUnitController.getQuoteBuyPrice` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | 1 |  | `/realunit/quote/buyShares` | public | none | — | n/a |  | `RealUnitController.getQuoteBuyShares` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | 1 |  | `/realunit/quote/info` | public | whole rows | 33 | not yet |  | `RealUnitController.getQuoteInfo` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | 1 |  | `/realunit/quote/price` | public | none | — | n/a |  | `RealUnitController.getQuotePrice` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | 1 |  | `/realunit/quote/sellPrice` | public | whole rows | 308 | not yet |  | `RealUnitController.getQuoteSellPrice` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | 1 |  | `/realunit/quote/sellShares` | public | whole rows | 308 | not yet |  | `RealUnitController.getQuoteSellShares` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| POST | 1 |  | `/realunit/register/complete` | public | whole rows | 493 | not yet | yes | `RealUnitController.completeRegistration` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | 1 |  | `/realunit/register/date` | public | none | — | n/a | yes | `RealUnitController.getRegistrationDate` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| POST | 1 |  | `/realunit/register/email` | public | whole rows | 364 | not yet | yes | `RealUnitController.registerEmail` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | 1 |  | `/realunit/register/status` | public | whole rows | 308 | not yet | yes | `RealUnitController.isRegistered` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| POST | 1 |  | `/realunit/register/wallet` | public | whole rows | 493 | not yet | yes | `RealUnitController.completeRegistrationForWalletAddress` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | 1 |  | `/realunit/registration` | public | whole rows | 308 | not yet | yes | `RealUnitController.getRegistrationInfo` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| PUT | 1 |  | `/realunit/sell` | public | whole rows | 308 | not yet | yes | `RealUnitController.getSellPaymentInfo` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| PUT | 1 |  | `/realunit/sell/:id/broadcast` | public | whole rows | 484 | not yet |  | `RealUnitController.broadcastSellTransaction` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| PUT | 1 |  | `/realunit/sell/:id/confirm` | public | whole rows | 484 | not yet |  | `RealUnitController.confirmSell` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| PUT | 1 |  | `/realunit/sell/:id/unsigned-transactions` | public | whole rows | 484 | not yet |  | `RealUnitController.getSellUnsignedTransactions` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| PUT | 1 |  | `/realunit/support/:id` | hidden | whole rows | 421 | not yet |  | `RealUnitSupportController.updateSupportIssue` | `subdomains/supporting/realunit/controllers/realunit-support.controller.ts` |
| GET | 1 |  | `/realunit/support/:id/data` | hidden | whole rows | 421 | not yet |  | `RealUnitSupportController.getIssueData` | `subdomains/supporting/realunit/controllers/realunit-support.controller.ts` |
| POST | 1 |  | `/realunit/support/:id/message` | hidden | whole rows | 441 | not yet |  | `RealUnitSupportController.createSupportMessage` | `subdomains/supporting/realunit/controllers/realunit-support.controller.ts` |
| GET | 1 |  | `/realunit/support/:id/message/:messageId/file` | hidden | whole rows | 421 | not yet |  | `RealUnitSupportController.getFile` | `subdomains/supporting/realunit/controllers/realunit-support.controller.ts` |
| GET | 1 |  | `/realunit/support/:id/messages` | hidden | whole rows | 428 | not yet |  | `RealUnitSupportController.getIssueMessages` | `subdomains/supporting/realunit/controllers/realunit-support.controller.ts` |
| GET | 1 |  | `/realunit/support/activity` | hidden | projected | 2 | 0/4 |  | `RealUnitSupportController.getSupportIssueActivity` | `subdomains/supporting/realunit/controllers/realunit-support.controller.ts` |
| GET | 1 |  | `/realunit/support/clerks` | hidden | none | — | n/a |  | `RealUnitSupportController.getRealUnitSupportClerks` | `subdomains/supporting/realunit/controllers/realunit-support.controller.ts` |
| GET | 1 |  | `/realunit/support/counts` | hidden | projected | 2 | 0/4 |  | `RealUnitSupportController.getSupportIssueCounts` | `subdomains/supporting/realunit/controllers/realunit-support.controller.ts` |
| GET | 1 |  | `/realunit/support/list` | hidden | projected | 10 | 4/4 |  | `RealUnitSupportController.getSupportIssueList` | `subdomains/supporting/realunit/controllers/realunit-support.controller.ts` |
| GET | 1 |  | `/realunit/support/statistics` | hidden | projected | 3 | 0/4 |  | `RealUnitSupportController.getSupportIssueStatistics` | `subdomains/supporting/realunit/controllers/realunit-support.controller.ts` |
| PUT | 1 |  | `/realunit/swap` | public | whole rows | 308 | not yet | yes | `RealUnitController.getSwapPaymentInfo` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| PUT | 1 |  | `/realunit/swap/:id/broadcast` | public | whole rows | 484 | not yet | yes | `RealUnitController.broadcastSwapTransaction` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| PUT | 1 |  | `/realunit/swap/:id/unsigned-transaction` | public | whole rows | 484 | not yet | yes | `RealUnitController.getSwapUnsignedTransaction` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | 1 |  | `/realunit/tokenInfo` | public | none | — | n/a |  | `RealUnitController.getTokenInfo` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| POST | 1 |  | `/realunit/transactions/receipt/multi` | public | whole rows | 308 | not yet |  | `RealUnitController.generateHistoryMultiReceipt` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| POST | 1 |  | `/realunit/transactions/receipt/single` | public | whole rows | 308 | not yet |  | `RealUnitController.generateHistoryReceipt` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| PUT | 1 |  | `/realunit/transfer` | public | whole rows | 308 | not yet | yes | `RealUnitController.prepareTransfer` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| PUT | 1 |  | `/realunit/transfer/:id/confirm` | public | whole rows | 87 | not yet | yes | `RealUnitController.confirmTransfer` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | 1 | yes | `/realunit/wallet/status` | public | whole rows | 308 | not yet | yes | `RealUnitController.getWalletStatus` | `subdomains/supporting/realunit/controllers/realunit.controller.ts` |
| GET | 1 |  | `/recall` | hidden | whole rows | 175 | not yet |  | `RecallController.getAll` | `subdomains/supporting/recall/recall.controller.ts` |
| POST | 1 |  | `/recall` | hidden | whole rows | 308 | not yet |  | `RecallController.createRecall` | `subdomains/supporting/recall/recall.controller.ts` |
| GET | 1 |  | `/recall/:id` | hidden | whole rows | 175 | not yet |  | `RecallController.getById` | `subdomains/supporting/recall/recall.controller.ts` |
| PUT | 1 |  | `/recall/:id` | hidden | whole rows | 308 | not yet |  | `RecallController.updateRecall` | `subdomains/supporting/recall/recall.controller.ts` |
| GET | 1 |  | `/recommendation` | hidden | whole rows | 474 | not yet |  | `RecommendationController.getAllRecommendation` | `subdomains/generic/user/models/recommendation/recommendation.controller.ts` |
| POST | 1 |  | `/recommendation` | hidden | whole rows | 364 | not yet |  | `RecommendationController.createRecommendation` | `subdomains/generic/user/models/recommendation/recommendation.controller.ts` |
| PUT | 1 |  | `/recommendation/:id/confirm` | hidden | whole rows | 643 | not yet |  | `RecommendationController.confirmRecommendation` | `subdomains/generic/user/models/recommendation/recommendation.controller.ts` |
| PUT | 1 |  | `/recommendation/:id/reject` | hidden | whole rows | 643 | not yet |  | `RecommendationController.rejectRecommendation` | `subdomains/generic/user/models/recommendation/recommendation.controller.ts` |
| GET | 1 |  | `/ref` | hidden | none | — | n/a |  | `RefController.createRef` | `subdomains/core/referral/process/ref.controller.ts` |
| POST | 1 |  | `/reward/ref` | hidden | whole rows | 156 | not yet |  | `RefRewardController.createPendingRefRewards` | `subdomains/core/referral/reward/ref-reward.controller.ts` |
| PUT | 1 |  | `/reward/ref/:id` | hidden | whole rows | 234 | not yet |  | `RefRewardController.updateRefReward` | `subdomains/core/referral/reward/ref-reward.controller.ts` |
| POST | 1 |  | `/reward/ref/manual` | hidden | whole rows | 308 | not yet |  | `RefRewardController.createManualRefReward` | `subdomains/core/referral/reward/ref-reward.controller.ts` |
| PUT | 1 |  | `/reward/ref/volumes` | hidden | whole rows | 308 | not yet |  | `RefRewardController.updateVolumes` | `subdomains/core/referral/reward/ref-reward.controller.ts` |
| GET | 1 |  | `/route` | hidden | whole rows | 308 | not yet |  | `RouteController.getAllRoutes` | `subdomains/core/route/route.controller.ts` |
| PUT | 1 |  | `/route/:id` | hidden | whole rows | 170 | not yet |  | `RouteController.updateRoute` | `subdomains/core/route/route.controller.ts` |
| POST | 1 |  | `/scorechain/screening` | hidden | whole rows | 14 | not yet |  | `ScorechainController.screen` | `integration/scorechain/controllers/scorechain.controller.ts` |
| GET | 1 |  | `/sell` | hidden | whole rows | 308 | not yet |  | `SellController.getAllSell` | `subdomains/core/sell-crypto/route/sell.controller.ts` |
| POST | 1 |  | `/sell` | hidden | whole rows | 308 | not yet |  | `SellController.createSell` | `subdomains/core/sell-crypto/route/sell.controller.ts` |
| GET | 1 |  | `/sell/:id` | public | whole rows | 377 | not yet |  | `SellController.getSell` | `subdomains/core/sell-crypto/route/sell.controller.ts` |
| PUT | 1 |  | `/sell/:id` | hidden | whole rows | 308 | not yet |  | `SellController.updateSell` | `subdomains/core/sell-crypto/route/sell.controller.ts` |
| GET | 1 |  | `/sell/:id/history` | hidden | projected | 14 | 4/4 |  | `SellController.getSellRouteHistory` | `subdomains/core/sell-crypto/route/sell.controller.ts` |
| PUT | 1 |  | `/sell/paymentInfos` | public | whole rows | 308 | not yet |  | `SellController.createSellWithPaymentInfo` | `subdomains/core/sell-crypto/route/sell.controller.ts` |
| PUT | 1 |  | `/sell/paymentInfos/:id/confirm` | public | whole rows | 545 | not yet |  | `SellController.confirmSell` | `subdomains/core/sell-crypto/route/sell.controller.ts` |
| GET | 1 |  | `/sell/paymentInfos/:id/tx` | public | whole rows | 484 | not yet |  | `SellController.depositTx` | `subdomains/core/sell-crypto/route/sell.controller.ts` |
| PUT | 1 |  | `/sell/quote` | public | whole rows | 143 | not yet |  | `SellController.getSellQuote` | `subdomains/core/sell-crypto/route/sell.controller.ts` |
| GET | 1 |  | `/setting` | hidden | whole rows | 5 | not yet |  | `SettingController.getSettings` | `shared/models/setting/setting.controller.ts` |
| PUT | 1 |  | `/setting/:key` | hidden | whole rows | 5 | not yet |  | `SettingController.updateSetting` | `shared/models/setting/setting.controller.ts` |
| PUT | 1 |  | `/setting/customSignUpFees` | hidden | none | — | n/a |  | `SettingController.updateCustomSignUpFees` | `shared/models/setting/setting.controller.ts` |
| PUT | 1 |  | `/setting/disabledProcesses` | hidden | none | — | n/a |  | `SettingController.updateProcess` | `shared/models/setting/setting.controller.ts` |
| GET | 1 |  | `/setting/infoBanner` | public | none | — | n/a |  | `SettingController.getInfoBanner` | `shared/models/setting/setting.controller.ts` |
| POST | 1 |  | `/specialExternalAccount` | hidden | whole rows | 7 | not yet |  | `SpecialExternalAccountController.createSpecialExternalAccount` | `subdomains/supporting/payment/controllers/special-external-account.controller.ts` |
| GET | 1 |  | `/statistic` | public | whole rows | 5 | n/a |  | `StatisticController.getAll` | `subdomains/core/statistic/statistic.controller.ts` |
| GET | 1 |  | `/statistic/status` | public | whole rows | 5 | not yet |  | `StatisticController.getStatus` | `subdomains/core/statistic/statistic.controller.ts` |
| GET | 1 |  | `/statistic/transactions` | public | whole rows | 416 | not yet |  | `StatisticController.getTransactions` | `subdomains/core/statistic/statistic.controller.ts` |
| GET | 1 |  | `/support` | hidden | whole rows | 594 | not yet |  | `SupportController.searchUserByKey` | `subdomains/generic/support/support.controller.ts` |
| GET | 1 |  | `/support/:id` | hidden | whole rows | 1039 | not yet |  | `SupportController.getUserData` | `subdomains/generic/support/support.controller.ts` |
| GET | 1 |  | `/support/:id/ip-log-pdf` | hidden | whole rows | 12 | not yet |  | `SupportController.getIpLogPdf` | `subdomains/generic/support/support.controller.ts` |
| POST | 1 |  | `/support/:id/limit-request-pdf` | hidden | whole rows | 253 | not yet |  | `SupportController.generateLimitRequestPdf` | `subdomains/generic/support/support.controller.ts` |
| POST | 1 |  | `/support/:id/onboarding-pdf` | hidden | whole rows | 264 | not yet |  | `SupportController.generateOnboardingPdf` | `subdomains/generic/support/support.controller.ts` |
| GET | 1 |  | `/support/:id/scorechain` | hidden | whole rows | 14 | not yet |  | `SupportController.getScorechainScreenings` | `subdomains/generic/support/support.controller.ts` |
| GET | 1 |  | `/support/:id/transaction-pdf` | hidden | whole rows | 1039 | not yet |  | `SupportController.getTransactionPdf` | `subdomains/generic/support/support.controller.ts` |
| GET | 1 |  | `/support/call-queues` | hidden | none | — | n/a |  | `SupportController.getCallQueues` | `subdomains/generic/support/support.controller.ts` |
| GET | 1 |  | `/support/call-queues/:queue/items` | hidden | whole rows | 669 | not yet |  | `SupportController.getCallQueueItems` | `subdomains/generic/support/support.controller.ts` |
| GET | 1 |  | `/support/call-queues/clerks` | hidden | none | — | n/a |  | `SupportController.getCallQueueClerks` | `subdomains/generic/support/support.controller.ts` |
| GET | 1 |  | `/support/issue` | public | projected | 11 | 4/4 |  | `SupportIssueController.getIssues` | `subdomains/supporting/support-issue/support-issue.controller.ts` |
| POST | 1 |  | `/support/issue` | public | whole rows | 493 | not yet |  | `SupportIssueController.createIssue` | `subdomains/supporting/support-issue/support-issue.controller.ts` |
| GET | 1 |  | `/support/issue/:id` | public | projected | 11 | 4/4 |  | `SupportIssueController.getIssue` | `subdomains/supporting/support-issue/support-issue.controller.ts` |
| PUT | 1 |  | `/support/issue/:id` | hidden | whole rows | 421 | not yet |  | `SupportIssueController.updateSupportIssue` | `subdomains/supporting/support-issue/support-issue.controller.ts` |
| PUT | 1 |  | `/support/issue/:id/close` | public | whole rows | 450 | not yet |  | `SupportIssueController.closeIssue` | `subdomains/supporting/support-issue/support-issue.controller.ts` |
| GET | 1 |  | `/support/issue/:id/data` | hidden | projected | 81 | 4/4 |  | `SupportIssueController.getIssueData` | `subdomains/supporting/support-issue/support-issue.controller.ts` |
| POST | 1 |  | `/support/issue/:id/message` | public | whole rows | 441 | not yet | yes | `SupportIssueController.createSupportMessage` | `subdomains/supporting/support-issue/support-issue.controller.ts` |
| GET | 1 |  | `/support/issue/:id/message/:messageId/file` | public | whole rows | — | not yet |  | `SupportIssueController.getFile` | `subdomains/supporting/support-issue/support-issue.controller.ts` |
| GET | 1 |  | `/support/issue/activity` | hidden | projected | 2 | 0/4 |  | `SupportIssueController.getSupportIssueActivity` | `subdomains/supporting/support-issue/support-issue.controller.ts` |
| GET | 1 |  | `/support/issue/clerk` | hidden | none | — | n/a |  | `SupportIssueController.getSupportIssueClerk` | `subdomains/supporting/support-issue/support-issue.controller.ts` |
| GET | 1 |  | `/support/issue/clerks` | hidden | none | — | n/a |  | `SupportIssueController.getSupportIssueClerks` | `subdomains/supporting/support-issue/support-issue.controller.ts` |
| GET | 1 |  | `/support/issue/counts` | hidden | projected | 2 | 0/4 |  | `SupportIssueController.getSupportIssueCounts` | `subdomains/supporting/support-issue/support-issue.controller.ts` |
| POST | 1 |  | `/support/issue/escalation/telegram-bind` | hidden | whole rows | 5 | not yet |  | `SupportIssueController.bindEscalationChat` | `subdomains/supporting/support-issue/support-issue.controller.ts` |
| GET | 1 |  | `/support/issue/escalation/telegram-chats` | hidden | none | — | n/a |  | `SupportIssueController.getEscalationChats` | `subdomains/supporting/support-issue/support-issue.controller.ts` |
| POST | 1 |  | `/support/issue/escalation/telegram-test` | hidden | whole rows | 5 | not yet |  | `SupportIssueController.testEscalationChat` | `subdomains/supporting/support-issue/support-issue.controller.ts` |
| GET | 1 |  | `/support/issue/list` | hidden | projected | 10 | 4/4 |  | `SupportIssueController.getSupportIssueList` | `subdomains/supporting/support-issue/support-issue.controller.ts` |
| GET | 1 |  | `/support/issue/statistics` | hidden | projected | 3 | 0/4 |  | `SupportIssueController.getSupportIssueStatistics` | `subdomains/supporting/support-issue/support-issue.controller.ts` |
| POST | 1 |  | `/support/issue/support` | hidden | whole rows | 493 | not yet |  | `SupportIssueController.createIssueBySupport` | `subdomains/supporting/support-issue/support-issue.controller.ts` |
| GET | 1 |  | `/support/kycFileList` | hidden | whole rows | 253 | not yet |  | `SupportController.getKycFileList` | `subdomains/generic/support/support.controller.ts` |
| GET | 1 |  | `/support/kycFileStats` | hidden | projected | 1 | 0/4 |  | `SupportController.getKycFileStats` | `subdomains/generic/support/support.controller.ts` |
| GET | 1 |  | `/support/note` | hidden | whole rows | 9 | not yet |  | `SupportController.getNotes` | `subdomains/generic/support/support.controller.ts` |
| POST | 1 |  | `/support/note` | hidden | whole rows | 253 | not yet |  | `SupportController.createNote` | `subdomains/generic/support/support.controller.ts` |
| DELETE | 1 |  | `/support/note/:id` | hidden | whole rows | 9 | not yet |  | `SupportController.deleteNote` | `subdomains/generic/support/support.controller.ts` |
| PUT | 1 |  | `/support/note/:id` | hidden | whole rows | 239 | not yet |  | `SupportController.updateNote` | `subdomains/generic/support/support.controller.ts` |
| GET | 1 |  | `/support/note/users` | hidden | projected | 5 | 0/4 |  | `SupportController.listNoteUsers` | `subdomains/generic/support/support.controller.ts` |
| GET | 1 |  | `/support/pending-reviews` | hidden | projected | 3 | 0/4 |  | `SupportController.getPendingReviews` | `subdomains/generic/support/support.controller.ts` |
| GET | 1 |  | `/support/pending-reviews/items` | hidden | whole rows | 261 | not yet |  | `SupportController.getPendingReviewItems` | `subdomains/generic/support/support.controller.ts` |
| GET | 1 |  | `/support/pending-transactions` | hidden | whole rows | 669 | not yet |  | `SupportController.getPendingTransactions` | `subdomains/generic/support/support.controller.ts` |
| GET | 1 |  | `/support/recommendation-graph/:id/neighbors` | hidden | whole rows | 474 | not yet | yes | `SupportController.getRecommendationGraphNeighbors` | `subdomains/generic/support/support.controller.ts` |
| GET | 1 |  | `/support/template` | hidden | whole rows | 8 | not yet |  | `SupportController.getTemplates` | `subdomains/generic/support/support.controller.ts` |
| POST | 1 |  | `/support/template` | hidden | whole rows | 253 | not yet |  | `SupportController.createTemplate` | `subdomains/generic/support/support.controller.ts` |
| DELETE | 1 |  | `/support/template/:id` | hidden | whole rows | 8 | not yet |  | `SupportController.deleteTemplate` | `subdomains/generic/support/support.controller.ts` |
| PUT | 1 |  | `/support/template/:id` | hidden | whole rows | 8 | not yet |  | `SupportController.updateTemplate` | `subdomains/generic/support/support.controller.ts` |
| GET | 1 |  | `/support/transaction/:id/refund` | hidden | whole rows | 143 | not yet |  | `SupportController.getTransactionRefund` | `subdomains/generic/support/support.controller.ts` |
| PUT | 1 |  | `/support/transaction/:id/refund` | hidden | whole rows | 411 | not yet |  | `SupportController.setTransactionRefund` | `subdomains/generic/support/support.controller.ts` |
| GET | 1 |  | `/support/transactionList` | hidden | whole rows | 20 | not yet |  | `SupportController.getTransactionList` | `subdomains/generic/support/support.controller.ts` |
| GET | 1 |  | `/swap` | hidden | whole rows | 308 | not yet |  | `SwapController.getAllSwap` | `subdomains/core/buy-crypto/routes/swap/swap.controller.ts` |
| POST | 1 |  | `/swap` | hidden | whole rows | 308 | not yet |  | `SwapController.createSwap` | `subdomains/core/buy-crypto/routes/swap/swap.controller.ts` |
| GET | 1 |  | `/swap/:id` | public | whole rows | 308 | not yet |  | `SwapController.getSwap` | `subdomains/core/buy-crypto/routes/swap/swap.controller.ts` |
| PUT | 1 |  | `/swap/:id` | hidden | whole rows | 396 | not yet |  | `SwapController.updateSwapRoute` | `subdomains/core/buy-crypto/routes/swap/swap.controller.ts` |
| GET | 1 |  | `/swap/:id/history` | hidden | projected | 12 | 4/4 |  | `SwapController.getSwapRouteHistory` | `subdomains/core/buy-crypto/routes/swap/swap.controller.ts` |
| PUT | 1 |  | `/swap/paymentInfos` | public | whole rows | 308 | not yet |  | `SwapController.createSwapWithPaymentInfo` | `subdomains/core/buy-crypto/routes/swap/swap.controller.ts` |
| PUT | 1 |  | `/swap/paymentInfos/:id/confirm` | public | whole rows | 545 | not yet |  | `SwapController.confirmSwap` | `subdomains/core/buy-crypto/routes/swap/swap.controller.ts` |
| GET | 1 |  | `/swap/paymentInfos/:id/tx` | public | whole rows | 484 | not yet |  | `SwapController.depositTx` | `subdomains/core/buy-crypto/routes/swap/swap.controller.ts` |
| PUT | 1 |  | `/swap/quote` | public | whole rows | 143 | not yet |  | `SwapController.getSwapQuote` | `subdomains/core/buy-crypto/routes/swap/swap.controller.ts` |
| POST | 1 |  | `/tatum/addressWebhook` | hidden | none | — | n/a |  | `TatumController.addressWebhook` | `integration/tatum/controllers/tatum.controller.ts` |
| PUT | 1 |  | `/trading/rule/:id` | hidden | whole rows | 87 | not yet |  | `TradingRuleController.update` | `subdomains/core/trading/controllers/trading-rule.controller.ts` |
| GET | 1 |  | `/transaction` | public | whole rows | 1363 | not yet | yes | `TransactionController.getTransactions` | `subdomains/core/history/controllers/transaction.controller.ts` |
| PUT | 1 |  | `/transaction/:id/invoice` | public | whole rows | 327 | not yet | yes | `TransactionController.generateInvoiceFromTransaction` | `subdomains/core/history/controllers/transaction.controller.ts` |
| PUT | 1 |  | `/transaction/:id/receipt` | public | whole rows | 327 | not yet | yes | `TransactionController.generateReceiptFromTransaction` | `subdomains/core/history/controllers/transaction.controller.ts` |
| GET | 1 |  | `/transaction/:id/refund` | public | whole rows | 327 | not yet | yes | `TransactionController.getTransactionRefund` | `subdomains/core/history/controllers/transaction.controller.ts` |
| PUT | 1 |  | `/transaction/:id/refund` | public | whole rows | 484 | not yet |  | `TransactionController.setTransactionRefundTarget` | `subdomains/core/history/controllers/transaction.controller.ts` |
| PUT | 1 |  | `/transaction/:id/target` | hidden | whole rows | 1053 | not yet |  | `TransactionController.setTransactionTarget` | `subdomains/core/history/controllers/transaction.controller.ts` |
| GET | 1 |  | `/transaction/ChainReport` | hidden | whole rows | 1363 | not yet | yes | `TransactionController.getCsvChainReport` | `subdomains/core/history/controllers/transaction.controller.ts` |
| GET | 1 |  | `/transaction/CoinTracking` | hidden | whole rows | 1363 | not yet | yes | `TransactionController.getCsvCT` | `subdomains/core/history/controllers/transaction.controller.ts` |
| PUT | 1 |  | `/transaction/admin/:id` | hidden | whole rows | 276 | not yet |  | `TransactionAdminController.updateTransaction` | `subdomains/supporting/payment/controllers/transaction-admin.controller.ts` |
| POST | 1 |  | `/transaction/admin/:id/resume` | hidden | whole rows | 98 | not yet |  | `TransactionAdminController.resumeTransaction` | `subdomains/supporting/payment/controllers/transaction-admin.controller.ts` |
| POST | 1 |  | `/transaction/admin/:id/stop` | hidden | whole rows | 98 | not yet |  | `TransactionAdminController.stopTransaction` | `subdomains/supporting/payment/controllers/transaction-admin.controller.ts` |
| POST | 1 |  | `/transaction/admin/:txId/riskAssessment` | hidden | none | — | n/a |  | `TransactionAdminController.createRiskAssessment` | `subdomains/supporting/payment/controllers/transaction-admin.controller.ts` |
| PUT | 1 |  | `/transaction/admin/:txId/riskAssessment/:id` | hidden | whole rows | 13 | not yet |  | `TransactionAdminController.updateRiskAssessment` | `subdomains/supporting/payment/controllers/transaction-admin.controller.ts` |
| GET | 1 |  | `/transaction/csv` | public | none | — | n/a |  | `TransactionController.getCsv` | `subdomains/core/history/controllers/transaction.controller.ts` |
| PUT | 1 |  | `/transaction/csv` | public | whole rows | 1363 | not yet | yes | `TransactionController.createCsv` | `subdomains/core/history/controllers/transaction.controller.ts` |
| GET | 1 |  | `/transaction/detail` | public | whole rows | 1363 | not yet |  | `TransactionController.getTransactionDetails` | `subdomains/core/history/controllers/transaction.controller.ts` |
| PUT | 1 |  | `/transaction/detail/csv` | public | whole rows | 1363 | not yet |  | `TransactionController.createDetailCsv` | `subdomains/core/history/controllers/transaction.controller.ts` |
| GET | 1 |  | `/transaction/detail/single` | public | whole rows | 484 | not yet | yes | `TransactionController.getSingleTransactionDetails` | `subdomains/core/history/controllers/transaction.controller.ts` |
| GET | 1 |  | `/transaction/single` | public | whole rows | 484 | not yet | yes | `TransactionController.getSingleTransaction` | `subdomains/core/history/controllers/transaction.controller.ts` |
| GET | 1 |  | `/transaction/target` | hidden | whole rows | 130 | not yet |  | `TransactionController.getTransactionTargets` | `subdomains/core/history/controllers/transaction.controller.ts` |
| GET | 1 |  | `/transaction/unassigned` | hidden | whole rows | 357 | not yet |  | `TransactionController.getUnassignedTransactions` | `subdomains/core/history/controllers/transaction.controller.ts` |
| DELETE | 1 | yes | `/user` | public | whole rows | 344 | not yet |  | `UserController.deleteUser` | `subdomains/generic/user/models/user/user.controller.ts` |
| DELETE | 2 |  | `/user` | public | whole rows | 344 | not yet |  | `UserV2Controller.deleteAccount` | `subdomains/generic/user/models/user/user.controller.ts` |
| GET | 1 | yes | `/user` | public | whole rows | 328 | not yet |  | `UserController.getUserV1` | `subdomains/generic/user/models/user/user.controller.ts` |
| GET | 2 |  | `/user` | public | projected | 66 | 4/4 |  | `UserV2Controller.getUser` | `subdomains/generic/user/models/user/user.controller.ts` |
| PUT | 1 | yes | `/user` | public | whole rows | 406 | not yet |  | `UserController.updateUserV1` | `subdomains/generic/user/models/user/user.controller.ts` |
| PUT | 2 |  | `/user` | public | whole rows | 351 | not yet |  | `UserV2Controller.updateUser` | `subdomains/generic/user/models/user/user.controller.ts` |
| PUT | 1 |  | `/user/:id` | hidden | whole rows | 364 | not yet |  | `UserController.updateUserAdmin` | `subdomains/generic/user/models/user/user.controller.ts` |
| DELETE | 1 | yes | `/user/account` | public | whole rows | 344 | not yet |  | `UserController.deleteUserAccount` | `subdomains/generic/user/models/user/user.controller.ts` |
| DELETE | 2 |  | `/user/addresses/:address` | public | whole rows | 344 | not yet |  | `UserV2Controller.deleteAddress` | `subdomains/generic/user/models/user/user.controller.ts` |
| PUT | 2 |  | `/user/addresses/:address` | public | whole rows | 351 | not yet |  | `UserV2Controller.updateAddress` | `subdomains/generic/user/models/user/user.controller.ts` |
| PUT | 1 |  | `/user/apiFilter/CT` | public | whole rows | 331 | not yet |  | `UserController.updateApiFilter` | `subdomains/generic/user/models/user/user.controller.ts` |
| DELETE | 1 |  | `/user/apiKey/CT` | public | none | — | n/a |  | `UserController.deleteApiKey` | `subdomains/generic/user/models/user/user.controller.ts` |
| POST | 1 |  | `/user/apiKey/CT` | public | projected | 3 | 4/4 |  | `UserController.createApiKey` | `subdomains/generic/user/models/user/user.controller.ts` |
| POST | 1 |  | `/user/change` | public | whole rows | 643 | not yet |  | `UserController.changeUser` | `subdomains/generic/user/models/user/user.controller.ts` |
| POST | 1 |  | `/user/data` | public | whole rows | 406 | not yet |  | `UserController.updateKycData` | `subdomains/generic/user/models/user/user.controller.ts` |
| GET | 1 | yes | `/user/detail` | public | whole rows | 328 | not yet |  | `UserController.getUserDetailV1` | `subdomains/generic/user/models/user/user.controller.ts` |
| PUT | 1 | yes | `/user/discountCodes` | public | whole rows | 308 | not yet |  | `UserController.addDiscountCode` | `subdomains/generic/user/models/user/user.controller.ts` |
| PUT | 2 |  | `/user/mail` | public | whole rows | 364 | not yet |  | `UserV2Controller.updateUserMail` | `subdomains/generic/user/models/user/user.controller.ts` |
| POST | 2 |  | `/user/mail/verify` | public | whole rows | 364 | not yet |  | `UserV2Controller.verifyMail` | `subdomains/generic/user/models/user/user.controller.ts` |
| PUT | 1 |  | `/user/name` | hidden | whole rows | 386 | not yet |  | `UserController.updateUserName` | `subdomains/generic/user/models/user/user.controller.ts` |
| GET | 2 |  | `/user/profile` | public | projected | 41 | 4/4 |  | `UserV2Controller.getProfile` | `subdomains/generic/user/models/user/user.controller.ts` |
| GET | 1 |  | `/user/ref` | hidden | projected | 1 | 0/4 |  | `UserController.getRefInfo` | `subdomains/generic/user/models/user/user.controller.ts` |
| GET | 2 |  | `/user/ref` | public | whole rows | 98 | not yet |  | `UserV2Controller.getRef` | `subdomains/generic/user/models/user/user.controller.ts` |
| PUT | 2 |  | `/user/ref` | public | whole rows | 98 | not yet |  | `UserV2Controller.updateRefAsset` | `subdomains/generic/user/models/user/user.controller.ts` |
| PUT | 1 |  | `/user/specialCodes` | public | whole rows | 308 | not yet |  | `UserController.addSpecialCode` | `subdomains/generic/user/models/user/user.controller.ts` |
| GET | 1 |  | `/user/volumes` | hidden | projected | 1 | 0/4 |  | `UserController.getVolumes` | `subdomains/generic/user/models/user/user.controller.ts` |
| GET | 1 |  | `/userData` | hidden | whole rows | 253 | not yet |  | `UserDataController.getAllUserData` | `subdomains/generic/user/models/user-data/user-data.controller.ts` |
| POST | 1 |  | `/userData` | hidden | whole rows | 253 | not yet |  | `UserDataController.createEmptyUserData` | `subdomains/generic/user/models/user-data/user-data.controller.ts` |
| GET | 1 |  | `/userData/:id` | hidden | whole rows | 253 | not yet |  | `UserDataController.getUserData` | `subdomains/generic/user/models/user-data/user-data.controller.ts` |
| PUT | 1 |  | `/userData/:id` | hidden | whole rows | 384 | not yet |  | `UserDataController.updateUserData` | `subdomains/generic/user/models/user-data/user-data.controller.ts` |
| PUT | 1 |  | `/userData/:id/bankDatas` | hidden | whole rows | 284 | not yet |  | `UserDataController.addBankData` | `subdomains/generic/user/models/user-data/user-data.controller.ts` |
| DELETE | 1 |  | `/userData/:id/fee` | hidden | whole rows | 253 | not yet |  | `UserDataController.removeFee` | `subdomains/generic/user/models/user-data/user-data.controller.ts` |
| PUT | 1 |  | `/userData/:id/fee` | hidden | whole rows | 253 | not yet |  | `UserDataController.addFee` | `subdomains/generic/user/models/user-data/user-data.controller.ts` |
| POST | 1 |  | `/userData/:id/kycFile` | hidden | whole rows | 253 | not yet |  | `UserDataController.uploadKycFile` | `subdomains/generic/user/models/user-data/user-data.controller.ts` |
| PUT | 1 |  | `/userData/:id/kycStatus/check` | hidden | whole rows | 364 | not yet |  | `UserDataController.setKycStatusCheck` | `subdomains/generic/user/models/user-data/user-data.controller.ts` |
| PUT | 1 |  | `/userData/:id/merge` | hidden | whole rows | 364 | not yet |  | `UserDataController.mergeUserData` | `subdomains/generic/user/models/user-data/user-data.controller.ts` |
| PUT | 1 |  | `/userData/:id/volumes` | hidden | projected | 9 | 0/4 |  | `UserDataController.updateVolumes` | `subdomains/generic/user/models/user-data/user-data.controller.ts` |
| PUT | 1 |  | `/userData/auditPeriodNumbers` | hidden | whole rows | 40 | not yet |  | `UserDataController.calculateAuditPeriodNumbers` | `subdomains/generic/user/models/user-data/user-data.controller.ts` |
| POST | 1 |  | `/userData/download` | hidden | whole rows | 253 | not yet |  | `UserDataController.downloadUserData` | `subdomains/generic/user/models/user-data/user-data.controller.ts` |
| POST | 1 |  | `/userDataRelation` | public | whole rows | 253 | not yet |  | `UserDataRelationController.create` | `subdomains/generic/user/models/user-data-relation/user-data-relation.controller.ts` |
| DELETE | 1 |  | `/userDataRelation/:id` | public | none | — | n/a |  | `UserDataRelationController.delete` | `subdomains/generic/user/models/user-data-relation/user-data-relation.controller.ts` |
| PUT | 1 |  | `/userDataRelation/:id` | public | whole rows | 7 | not yet |  | `UserDataRelationController.update` | `subdomains/generic/user/models/user-data-relation/user-data-relation.controller.ts` |
| GET | neutral |  | `/version` | hidden | none | — | n/a |  | `AppController.getVersion` | `app.controller.ts` |
| POST | 1 |  | `/wallet` | hidden | none | — | n/a |  | `WalletController.createWallet` | `subdomains/generic/user/models/wallet/wallet.controller.ts` |
| PUT | 1 |  | `/wallet/:id` | hidden | whole rows | 20 | not yet |  | `WalletController.updateWallet` | `subdomains/generic/user/models/wallet/wallet.controller.ts` |

⚠️ = not registered at runtime, see *Known discrepancy* above.
