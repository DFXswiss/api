# HTTP endpoints

Complete inventory of every HTTP endpoint this service exposes: **533 handlers** across 93 controller files. 223 of them are marked `@ApiExcludeEndpoint` and therefore do not appear in the public Swagger schema.

This file is an inventory, not a usage guide. For request and response shapes use the Swagger schema; for payment links see [payment-links.md](payment-links.md).

## Why this list exists

It is the base for per-endpoint analysis. The intended next step is an additional column marking whether an endpoint is a **read path** — one that only reads data and renders it (invoices, receipts, history, exports) — or a write path that has to load complete entities in order to persist them. That distinction decides where a query may safely select individual fields instead of loading whole object graphs, and it cannot be derived from the HTTP verb: `PUT /transaction/:id/invoice` writes nothing, it renders a PDF.

## How this list is produced

Derived from the `@Get` / `@Post` / `@Put` / `@Patch` / `@Delete` decorators in `src/**/*.controller.ts`, with each endpoint attributed to the `@Controller` scope that precedes it — four files declare two controller classes with different base paths, and one declares `@Controller()` without an argument, placing its routes at the root.

The result was cross-checked against the route list the framework registers at startup: all 526 distinct method/path pairs match, in both directions.

## Known discrepancy

`POST /paymentLink/integrations/kucoin/webhook/cancel` appears in the source but is **not registered at runtime**. Its handler in `src/subdomains/core/payment-link/controllers/c2b-payment-link.controller.ts` carries two `@Post` decorators, and the framework stores a single path per handler, so only `.../webhook/success` takes effect. The endpoint is listed below for completeness and marked accordingly; it is a defect to be fixed separately, not a documentation gap.

## Endpoints

### AppController

`src/app.controller.ts` — 7 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| GET | `/` | `home` | public |
| GET | `/app` | `createRefNew` | public |
| GET | `/app/:app` | `redirectToStore` | hidden |
| GET | `/app/advertisements` | `getAds` | hidden |
| GET | `/app/announcements` | `getAnnouncements` | public |
| GET | `/app/settings/flags` | `getFlags` | hidden |
| GET | `/version` | `getVersion` | hidden |

### AlchemyController

`src/integration/alchemy/controllers/alchemy.controller.ts` — 2 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| POST | `/alchemy/addressWebhook` | `addressWebhook` | public |
| GET | `/alchemy/addresses/:webhookId` | `addresses` | public |

### YapealWebhookController

`src/integration/bank/controllers/yapeal-webhook.controller.ts` — 1 endpoint

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| POST | `/bank/yapeal/webhook` | `handleYapealWebhook` | public |

### BlockchainApiController

`src/integration/blockchain/api/controllers/blockchain-api.controller.ts` — 3 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| POST | `/blockchain/balances` | `getBalances` | public |
| POST | `/blockchain/broadcast` | `broadcastTransaction` | public |
| POST | `/blockchain/transaction` | `createTransaction` | public |

### NodeController

`src/integration/blockchain/bitcoin/node/node.controller.ts` — 6 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| POST | `/node/:node/:mode/cmd` | `cmdForMode` | hidden |
| POST | `/node/:node/:mode/rpc` | `rpcForMode` | hidden |
| GET | `/node/:node/:mode/tx/:txId` | `waitForTxForMode` | hidden |
| POST | `/node/:node/cmd` | `cmd` | hidden |
| POST | `/node/:node/rpc` | `rpc` | public |
| GET | `/node/:node/tx/:txId` | `waitForTx` | hidden |

### DEuroController

`src/integration/blockchain/deuro/controllers/deuro.controller.ts` — 1 endpoint

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| GET | `/deuro/info` | `getInfo` | public |

### FrankencoinController

`src/integration/blockchain/frankencoin/controllers/frankencoin.controller.ts` — 1 endpoint

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| GET | `/frankencoin/info` | `getInfo` | public |

### JuiceController

`src/integration/blockchain/juice/controllers/juice.controller.ts` — 1 endpoint

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| GET | `/juice/info` | `getInfo` | public |

### ExchangeController

`src/integration/exchange/controllers/exchange.controller.ts` — 9 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| GET | `/exchange/:exchange/balances` | `getBalance` | public |
| GET | `/exchange/:exchange/price` | `getPrice` | hidden |
| PUT | `/exchange/:exchange/sync` | `syncExchange` | hidden |
| GET | `/exchange/:exchange/trade` | `getTrades` | hidden |
| POST | `/exchange/:exchange/trade` | `trade` | hidden |
| GET | `/exchange/:exchange/trade/history` | `getTradeHistory` | hidden |
| POST | `/exchange/:exchange/withdraw` | `withdrawFunds` | hidden |
| GET | `/exchange/:exchange/withdraw/:id` | `getWithdraw` | public |
| GET | `/exchange/trade/:id` | `getTrade` | hidden |

### IknaController

`src/integration/ikna/controllers/ikna.controller.ts` — 3 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| GET | `/ikna/bfs/:id` | `getBfsResult` | hidden |
| POST | `/ikna/bfs/address` | `createBfsAddressRequest` | public |
| GET | `/ikna/tag` | `getIknaAddressTag` | hidden |

### ScorechainController

`src/integration/scorechain/controllers/scorechain.controller.ts` — 1 endpoint

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| POST | `/scorechain/screening` | `screen` | public |

### TatumController

`src/integration/tatum/controllers/tatum.controller.ts` — 1 endpoint

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| POST | `/tatum/addressWebhook` | `addressWebhook` | public |

### AssetController

`src/shared/models/asset/asset.controller.ts` — 2 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| GET | `/asset` | `getAllAsset` | public |
| PUT | `/asset/:id` | `updateAsset` | public |

### CountryController

`src/shared/models/country/country.controller.ts` — 1 endpoint

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| GET | `/country` | `getAllCountry` | public |

### FiatController

`src/shared/models/fiat/fiat.controller.ts` — 1 endpoint

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| GET | `/fiat` | `getAllFiat` | public |

### LanguageController

`src/shared/models/language/language.controller.ts` — 1 endpoint

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| GET | `/language` | `getAllLanguage` | public |

### SettingController

`src/shared/models/setting/setting.controller.ts` — 5 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| GET | `/setting` | `getSettings` | public |
| PUT | `/setting/:key` | `updateSetting` | hidden |
| PUT | `/setting/customSignUpFees` | `updateCustomSignUpFees` | hidden |
| PUT | `/setting/disabledProcesses` | `updateProcess` | hidden |
| GET | `/setting/infoBanner` | `getInfoBanner` | public |

### LedgerController

`src/subdomains/core/accounting/controllers/ledger.controller.ts` — 6 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| GET | `/dashboard/accounting/ledger/accounts` | `getAccounts` | public |
| GET | `/dashboard/accounting/ledger/accounts/:accountId/legs` | `getAccountDetail` | hidden |
| GET | `/dashboard/accounting/ledger/equity-comparison` | `getEquityComparison` | hidden |
| GET | `/dashboard/accounting/ledger/margin` | `getMargin` | hidden |
| GET | `/dashboard/accounting/ledger/reconciliation` | `getReconStatus` | hidden |
| GET | `/dashboard/accounting/ledger/suspense` | `getSuspense` | hidden |

### BuyCryptoController

`src/subdomains/core/buy-crypto/process/buy-crypto.controller.ts` — 8 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| PUT | `/buyCrypto/:id` | `update` | hidden |
| PUT | `/buyCrypto/:id/amlCheck` | `manualPassAmlCheck` | hidden |
| DELETE | `/buyCrypto/:id/amlCheck` | `resetAmlCheck` | hidden |
| POST | `/buyCrypto/:id/refund` | `refundBuyCrypto` | hidden |
| POST | `/buyCrypto/:id/scorechain` | `retriggerScorechain` | hidden |
| POST | `/buyCrypto/:id/webhook` | `triggerWebhook` | public |
| PUT | `/buyCrypto/refVolumes` | `updateRefVolumes` | hidden |
| PUT | `/buyCrypto/volumes` | `updateBuyVolumes` | hidden |

### BuyController

`src/subdomains/core/buy-crypto/routes/buy/buy.controller.ts` — 11 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| GET | `/buy` | `getAllBuy` | public |
| POST | `/buy` | `createBuy` | hidden |
| GET | `/buy/:id` | `getBuy` | hidden |
| PUT | `/buy/:id` | `updateBuyRoute` | public |
| GET | `/buy/:id/history` | `getBuyRouteHistory` | hidden |
| PUT | `/buy/paymentInfos` | `createBuyWithPaymentInfo` | public |
| PUT | `/buy/paymentInfos/:id/confirm` | `confirmBuy` | public |
| PUT | `/buy/paymentInfos/:id/invoice` | `generateInvoicePDF` | public |
| GET | `/buy/personalIban` | `getAllPersonalIbans` | public |
| POST | `/buy/personalIban` | `AuthGuard` | public |
| PUT | `/buy/quote` | `getBuyQuote` | hidden |

### CryptoRouteController

`src/subdomains/core/buy-crypto/routes/swap/crypto-route.controller.ts` — 5 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| GET | `/cryptoRoute` | `getAllCrypto` | public |
| POST | `/cryptoRoute` | `createCrypto` | hidden |
| GET | `/cryptoRoute/:id` | `getCrypto` | hidden |
| PUT | `/cryptoRoute/:id` | `updateCryptoRoute` | hidden |
| GET | `/cryptoRoute/:id/history` | `getCryptoRouteHistory` | hidden |

### SwapController

`src/subdomains/core/buy-crypto/routes/swap/swap.controller.ts` — 9 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| GET | `/swap` | `getAllSwap` | public |
| POST | `/swap` | `createSwap` | hidden |
| GET | `/swap/:id` | `getSwap` | hidden |
| PUT | `/swap/:id` | `updateSwapRoute` | public |
| GET | `/swap/:id/history` | `getSwapRouteHistory` | hidden |
| PUT | `/swap/paymentInfos` | `createSwapWithPaymentInfo` | public |
| PUT | `/swap/paymentInfos/:id/confirm` | `confirmSwap` | public |
| GET | `/swap/paymentInfos/:id/tx` | `depositTx` | public |
| PUT | `/swap/quote` | `getSwapQuote` | hidden |

### CustodyAccountController

`src/subdomains/core/custody/controllers/custody-account.controller.ts` — 12 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| GET | `/custody/account` | `getCustodyAccounts` | public |
| POST | `/custody/account` | `createCustodyAccount` | public |
| GET | `/custody/account/:id` | `getCustodyAccount` | public |
| PUT | `/custody/account/:id` | `updateCustodyAccount` | public |
| GET | `/custody/account/:id/access` | `getAccessList` | public |
| POST | `/custody/account/:id/access` | `grantAccess` | public |
| PUT | `/custody/account/:id/access/:accessId` | `updateAccess` | public |
| DELETE | `/custody/account/:id/access/:accessId` | `revokeAccess` | public |
| GET | `/custody/account/:id/balance` | `getAccountBalance` | public |
| GET | `/custody/account/:id/history` | `getAccountHistory` | public |
| GET | `/custody/account/:id/order` | `getAccountOrders` | public |
| GET | `/custody/account/:id/pdf` | `getAccountPdf` | public |

### CustodyAdminController, CustodyController

`src/subdomains/core/custody/controllers/custody.controller.ts` — 10 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| GET | `/custody` | `getUserCustodyBalance` | public |
| POST | `/custody` | `createCustodyAccount` | public |
| POST | `/custody/admin/order/:id/approve` | `approveOrder` | public |
| GET | `/custody/admin/orders` | `getOrders` | public |
| PUT | `/custody/admin/user/:id/balance` | `updateUserBalance` | public |
| GET | `/custody/history` | `getUserCustodyHistory` | public |
| GET | `/custody/order` | `getOrders` | public |
| POST | `/custody/order` | `createOrder` | public |
| POST | `/custody/order/:id/confirm` | `confirmOrder` | public |
| GET | `/custody/pdf` | `getCustodyPdf` | public |

### FaucetRequestController

`src/subdomains/core/faucet-request/controller/faucet-request.controller.ts` — 1 endpoint

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| POST | `/faucet` | `faucetRequest` | public |

### HistoryController

`src/subdomains/core/history/controllers/history.controller.ts` — 4 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| GET | `/history` | `getHistory` | public |
| GET | `/history/:exportType` | `getApiHistory` | hidden |
| GET | `/history/csv` | `getCsv` | hidden |
| POST | `/history/csv` | `createCsv` | public |

### TransactionController

`src/subdomains/core/history/controllers/transaction.controller.ts` — 16 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| GET | `/transaction` | `getTransactions` | public |
| PUT | `/transaction/:id/invoice` | `generateInvoiceFromTransaction` | public |
| PUT | `/transaction/:id/receipt` | `generateReceiptFromTransaction` | public |
| GET | `/transaction/:id/refund` | `AuthGuard` | public |
| PUT | `/transaction/:id/refund` | `AuthGuard` | public |
| PUT | `/transaction/:id/target` | `setTransactionTarget` | hidden |
| GET | `/transaction/ChainReport` | `getCsvChainReport` | hidden |
| GET | `/transaction/CoinTracking` | `getCsvCT` | public |
| GET | `/transaction/csv` | `getCsv` | public |
| PUT | `/transaction/csv` | `createCsv` | public |
| GET | `/transaction/detail` | `getTransactionDetails` | hidden |
| PUT | `/transaction/detail/csv` | `createDetailCsv` | public |
| GET | `/transaction/detail/single` | `getSingleTransactionDetails` | public |
| GET | `/transaction/single` | `getSingleTransaction` | public |
| GET | `/transaction/target` | `getTransactionTargets` | hidden |
| GET | `/transaction/unassigned` | `getUnassignedTransactions` | public |

### LiquidityBalanceController

`src/subdomains/core/liquidity-management/controllers/balance.controller.ts` — 1 endpoint

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| GET | `/liquidityManagement/balance` | `getBalances` | public |

### LiquidityManagementOrderController

`src/subdomains/core/liquidity-management/controllers/order.controller.ts` — 2 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| PUT | `/liquidityManagement/order/:id/resolveUncertain` | `resolveUncertainOrder` | hidden |
| GET | `/liquidityManagement/order/in-progress` | `getProcessingOrders` | public |

### LiquidityManagementPipelineController

`src/subdomains/core/liquidity-management/controllers/pipeline.controller.ts` — 5 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| GET | `/liquidityManagement/pipeline/:id/status` | `getPipelineStatus` | hidden |
| POST | `/liquidityManagement/pipeline/buy` | `buyLiquidity` | public |
| GET | `/liquidityManagement/pipeline/in-progress` | `getProcessingPipelines` | hidden |
| POST | `/liquidityManagement/pipeline/sell` | `sellLiquidity` | hidden |
| GET | `/liquidityManagement/pipeline/stopped` | `getStoppedPipelines` | hidden |

### LiquidityManagementRuleController

`src/subdomains/core/liquidity-management/controllers/rule.controller.ts` — 6 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| POST | `/liquidityManagement/rule` | `createRule` | public |
| GET | `/liquidityManagement/rule/:id` | `getRule` | hidden |
| PUT | `/liquidityManagement/rule/:id` | `updateRule` | hidden |
| PATCH | `/liquidityManagement/rule/:id/deactivate` | `deactivateRule` | hidden |
| PATCH | `/liquidityManagement/rule/:id/reactivate` | `reactivateRule` | hidden |
| PATCH | `/liquidityManagement/rule/:id/settings` | `setReactivationTime` | hidden |

### HealthController

`src/subdomains/core/monitoring/health.controller.ts` — 6 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| GET | `/health` | `getHealth` | public |
| GET | `/health/banking` | `getBankingHealth` | public |
| GET | `/health/external` | `getExternalHealth` | public |
| GET | `/health/liquidity` | `getLiquidityHealth` | public |
| GET | `/health/nodes` | `getNodeHealth` | public |
| GET | `/health/payment` | `getPaymentHealth` | public |

### MonitoringController

`src/subdomains/core/monitoring/monitoring.controller.ts` — 2 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| GET | `/monitoring/data` | `getSystemState` | public |
| POST | `/monitoring/data` | `onWebhook` | hidden |

### C2BPaymentLinkController

`src/subdomains/core/payment-link/controllers/c2b-payment-link.controller.ts` — 5 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| POST | `/paymentLink/integration/binance/activate/:id` | `activateBinancePay` | public |
| POST | `/paymentLink/integration/binance/webhook` | `binancePayWebhook` | hidden |
| POST | `/paymentLink/integration/kucoin/activate/:id` | `activateKucoinPay` | public |
| POST | `/paymentLink/integrations/kucoin/webhook/cancel` | `kucoinPayWebhook` | hidden — not registered, see above |
| POST | `/paymentLink/integrations/kucoin/webhook/success` | `kucoinPayWebhook` | hidden |

### PaymentLinkController, PaymentLinkShortController

`src/subdomains/core/payment-link/controllers/payment-link.controller.ts` — 22 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| GET | `/paymentLink` | `getAllPaymentLinks` | public |
| POST | `/paymentLink` | `createPaymentLink` | public |
| PUT | `/paymentLink` | `updatePaymentLink` | public |
| PUT | `/paymentLink/:id` | `updatePaymentLinkAdmin` | hidden |
| DELETE | `/paymentLink/:id` | `deletePaymentLink` | hidden |
| PUT | `/paymentLink/:id/pos` | `createPosLinkAdmin` | hidden |
| PUT | `/paymentLink/assign` | `assignPaymentLink` | public |
| GET | `/paymentLink/config` | `getUserPaymentLinksConfig` | public |
| PUT | `/paymentLink/config` | `updateUserPaymentLinksConfig` | public |
| GET | `/paymentLink/history` | `getPaymentHistory` | public |
| GET | `/paymentLink/locations` | `getLocations` | public |
| POST | `/paymentLink/merchant` | `createMerchant` | public |
| GET | `/paymentLink/payment` | `createInvoicePayment` | hidden |
| POST | `/paymentLink/payment` | `createPayment` | public |
| DELETE | `/paymentLink/payment` | `cancelPayment` | public |
| PUT | `/paymentLink/payment/:id` | `updatePaymentLinkPayment` | public |
| PUT | `/paymentLink/payment/confirm` | `confirmPayment` | public |
| GET | `/paymentLink/payment/wait` | `waitForPayment` | public |
| PUT | `/paymentLink/pos` | `createPosLink` | public |
| GET | `/paymentLink/recipient` | `getPaymentRecipient` | public |
| GET | `/paymentLink/stickers` | `generateOcpStickers` | hidden |
| GET | `/plp` | `createInvoicePayment` | public |

### PaymentStandardController

`src/subdomains/core/payment-link/controllers/payment-standard.controller.ts` — 2 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| GET | `/paymentLink/standard` | `getAll` | public |
| GET | `/paymentLink/standard/:id` | `getById` | public |

### WalletAppController

`src/subdomains/core/payment-link/controllers/wallet-app.controller.ts` — 3 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| GET | `/paymentLink/walletApp` | `getAll` | public |
| GET | `/paymentLink/walletApp/:id` | `getById` | public |
| GET | `/paymentLink/walletApp/recommended` | `getRecommended` | public |

### RefController

`src/subdomains/core/referral/process/ref.controller.ts` — 1 endpoint

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| GET | `/ref` | `createRef` | public |

### RefRewardController

`src/subdomains/core/referral/reward/ref-reward.controller.ts` — 4 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| POST | `/reward/ref` | `createPendingRefRewards` | hidden |
| PUT | `/reward/ref/:id` | `updateRefReward` | hidden |
| POST | `/reward/ref/manual` | `createManualRefReward` | hidden |
| PUT | `/reward/ref/volumes` | `updateVolumes` | public |

### RouteController

`src/subdomains/core/route/route.controller.ts` — 2 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| GET | `/route` | `getAllRoutes` | public |
| PUT | `/route/:id` | `updateRoute` | hidden |

### BuyFiatController

`src/subdomains/core/sell-crypto/process/buy-fiat.controller.ts` — 8 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| PUT | `/buyFiat/:id` | `update` | hidden |
| PUT | `/buyFiat/:id/amlCheck` | `manualPassAmlCheck` | hidden |
| DELETE | `/buyFiat/:id/amlCheck` | `resetAmlCheck` | hidden |
| POST | `/buyFiat/:id/refund` | `refundBuyFiat` | hidden |
| POST | `/buyFiat/:id/scorechain` | `retriggerScorechain` | hidden |
| POST | `/buyFiat/:id/webhook` | `triggerWebhook` | public |
| PUT | `/buyFiat/refVolumes` | `updateRefVolumes` | hidden |
| PUT | `/buyFiat/volumes` | `updateVolumes` | hidden |

### SellController

`src/subdomains/core/sell-crypto/route/sell.controller.ts` — 9 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| GET | `/sell` | `getAllSell` | public |
| POST | `/sell` | `createSell` | hidden |
| GET | `/sell/:id` | `getSell` | hidden |
| PUT | `/sell/:id` | `updateSell` | public |
| GET | `/sell/:id/history` | `getSellRouteHistory` | hidden |
| PUT | `/sell/paymentInfos` | `createSellWithPaymentInfo` | public |
| PUT | `/sell/paymentInfos/:id/confirm` | `confirmSell` | public |
| GET | `/sell/paymentInfos/:id/tx` | `depositTx` | public |
| PUT | `/sell/quote` | `getSellQuote` | hidden |

### StatisticController

`src/subdomains/core/statistic/statistic.controller.ts` — 3 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| GET | `/statistic` | `getAll` | public |
| GET | `/statistic/status` | `getStatus` | public |
| GET | `/statistic/transactions` | `getTransactions` | public |

### TradingRuleController

`src/subdomains/core/trading/controllers/trading-rule.controller.ts` — 1 endpoint

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| PUT | `/trading/rule/:id` | `update` | public |

### AdminController

`src/subdomains/generic/admin/admin.controller.ts` — 4 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| POST | `/admin/lightning/rotate-webhook-secrets` | `rotateLightningWebhookSecrets` | hidden |
| POST | `/admin/mail` | `sendMail` | public |
| POST | `/admin/payout` | `payout` | hidden |
| POST | `/admin/sendLetter` | `sendLetter` | hidden |

### LnurldForwardController

`src/subdomains/generic/forwarding/controllers/lnurld-forward.controller.ts` — 2 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| GET | `/lnurld/:id` | `lnurldForward` | public |
| GET | `/lnurld/cb/:id/:var` | `lnurldCallbackForward` | public |

### LnUrlPForwardController

`src/subdomains/generic/forwarding/controllers/lnurlp-forward.controller.ts` — 6 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| GET | `/lnurlp/:id` | `lnUrlPForward` | public |
| POST | `/lnurlp/:id` | `activatePublicPayment` | public |
| DELETE | `/lnurlp/cancel/:id` | `cancelPayment` | public |
| GET | `/lnurlp/cb/:id` | `lnUrlPCallbackForward` | public |
| GET | `/lnurlp/tx/:id` | `txHexForward` | public |
| GET | `/lnurlp/wait/:id` | `waitForPayment` | public |

### LnUrlWForwardController

`src/subdomains/generic/forwarding/controllers/lnurlw-forward.controller.ts` — 2 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| GET | `/lnurlw/:id` | `lnUrlWForward` | public |
| GET | `/lnurlw/cb/:id` | `lnUrlWCallbackForward` | public |

### PaymentForwardController

`src/subdomains/generic/forwarding/controllers/payment-forward.controller.ts` — 1 endpoint

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| GET | `/pl` | `lnUrlPForward` | public |

### GsEvmController

`src/subdomains/generic/gs/gs-evm.controller.ts` — 6 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| POST | `/gs/evm/bridgeApproval` | `approveBridge` | hidden |
| POST | `/gs/evm/coinTransaction` | `sendCoinTransaction` | hidden |
| POST | `/gs/evm/contractApproval` | `approveContract` | hidden |
| POST | `/gs/evm/contractTransaction` | `sendContractTransaction` | hidden |
| POST | `/gs/evm/rawTransaction` | `sendRawTransaction` | public |
| POST | `/gs/evm/tokenTransaction` | `sendTokenTransaction` | hidden |

### GsController

`src/subdomains/generic/gs/gs.controller.ts` — 4 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| POST | `/gs/db` | `getDbData` | public |
| POST | `/gs/db/custom` | `getExtendedData` | hidden |
| POST | `/gs/debug` | `executeDebugQuery` | hidden |
| GET | `/gs/support` | `getSupportData` | hidden |

### KycAdminController

`src/subdomains/generic/kyc/controllers/kyc-admin.controller.ts` — 8 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| PUT | `/kyc/admin/blacklist/ip` | `addIpToBlacklist` | hidden |
| DELETE | `/kyc/admin/blacklist/ip` | `deleteIpToBlacklist` | hidden |
| POST | `/kyc/admin/ident/file/sync` | `syncIdentFiles` | hidden |
| POST | `/kyc/admin/log` | `createLog` | hidden |
| PUT | `/kyc/admin/log/:id` | `updateLog` | hidden |
| PUT | `/kyc/admin/nameCheck/:id` | `updateNameCheckLog` | public |
| PUT | `/kyc/admin/step/:id` | `updateKycStep` | hidden |
| POST | `/kyc/admin/webhook` | `triggerWebhook` | hidden |

### KycClientController

`src/subdomains/generic/kyc/controllers/kyc-client.controller.ts` — 5 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| GET | `/kyc/client/payments` | `getAllPayments` | public |
| GET | `/kyc/client/users` | `getAllKycData` | public |
| GET | `/kyc/client/users/:id/documents` | `getKycFiles` | public |
| GET | `/kyc/client/users/:id/documents/:type` | `getKycFile` | public |
| GET | `/kyc/client/users/:id/payments` | `getUserPayments` | public |

### KycController

`src/subdomains/generic/kyc/controllers/kyc.controller.ts` — 34 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| GET | `/kyc` | `getKycLevel` | public |
| PUT | `/kyc` | `continueKyc` | public |
| GET | `/kyc/2fa` | `check2fa` | public |
| POST | `/kyc/2fa` | `start2fa` | public |
| POST | `/kyc/2fa/verify` | `verify2fa` | public |
| GET | `/kyc/:step` | `initiateStep` | public |
| GET | `/kyc/countries` | `getKycCountries` | public |
| DELETE | `/kyc/data/:type/:id` | `cancelStep` | hidden |
| PUT | `/kyc/data/additional/:id` | `updateAdditionalDocumentsData` | public |
| PUT | `/kyc/data/address/:id` | `updateAddressChangeData` | public |
| PUT | `/kyc/data/authority/:id` | `updateAuthorityData` | public |
| PUT | `/kyc/data/beneficial/:id` | `updateBeneficialData` | public |
| PUT | `/kyc/data/confirmation/:id` | `updateSoleProprietorshipConfirmationData` | public |
| PUT | `/kyc/data/contact/:id` | `updateContactData` | hidden |
| GET | `/kyc/data/financial/:id` | `getFinancialData` | public |
| PUT | `/kyc/data/financial/:id` | `updateFinancialData` | public |
| PUT | `/kyc/data/legal/:id` | `updateCommercialRegisterData` | public |
| PUT | `/kyc/data/name/:id` | `updateNameChangeData` | public |
| PUT | `/kyc/data/nationality/:id` | `updateNationalityData` | public |
| PUT | `/kyc/data/operational/:id` | `updateOperationalData` | public |
| PUT | `/kyc/data/owner/:id` | `updateOwnerDirectoryData` | public |
| PUT | `/kyc/data/payment/:id` | `updatePaymentsData` | public |
| PUT | `/kyc/data/personal/:id` | `updatePersonalData` | public |
| PUT | `/kyc/data/phone/:id` | `updatePhoneChangeData` | public |
| PUT | `/kyc/data/recall/:id` | `updateRecallAgreement` | public |
| PUT | `/kyc/data/recommendation/:id` | `updateRecommendationData` | public |
| PUT | `/kyc/data/residence/:id` | `updateResidencePermitData` | public |
| PUT | `/kyc/data/signatory/:id` | `updateSignatoryPowerData` | public |
| PUT | `/kyc/data/statutes/:id` | `updateStatutesData` | public |
| GET | `/kyc/file/:id` | `getFile` | hidden |
| PUT | `/kyc/ident/manual/:id` | `updateIdentData` | hidden |
| POST | `/kyc/ident/sumsub` | `sumsubWebhook` | public |
| POST | `/kyc/transfer` | `addKycClient` | hidden |
| DELETE | `/kyc/transfer` | `removeKycClient` | hidden |

### SupportController

`src/subdomains/generic/support/support.controller.ts` — 27 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| GET | `/support` | `searchUserByKey` | public |
| GET | `/support/:id` | `getUserData` | hidden |
| GET | `/support/:id/ip-log-pdf` | `getIpLogPdf` | hidden |
| POST | `/support/:id/onboarding-pdf` | `generateOnboardingPdf` | hidden |
| GET | `/support/:id/scorechain` | `getScorechainScreenings` | hidden |
| GET | `/support/:id/transaction-pdf` | `getTransactionPdf` | hidden |
| GET | `/support/call-queues` | `getCallQueues` | hidden |
| GET | `/support/call-queues/:queue/items` | `getCallQueueItems` | hidden |
| GET | `/support/call-queues/clerks` | `getCallQueueClerks` | hidden |
| GET | `/support/kycFileList` | `getKycFileList` | hidden |
| GET | `/support/kycFileStats` | `getKycFileStats` | hidden |
| GET | `/support/note` | `getNotes` | hidden |
| POST | `/support/note` | `createNote` | hidden |
| PUT | `/support/note/:id` | `updateNote` | hidden |
| DELETE | `/support/note/:id` | `deleteNote` | hidden |
| GET | `/support/note/users` | `listNoteUsers` | hidden |
| GET | `/support/pending-reviews` | `getPendingReviews` | hidden |
| GET | `/support/pending-reviews/items` | `getPendingReviewItems` | hidden |
| GET | `/support/pending-transactions` | `getPendingTransactions` | hidden |
| GET | `/support/recommendation-graph/:id/neighbors` | `getRecommendationGraphNeighbors` | hidden |
| GET | `/support/template` | `getTemplates` | hidden |
| POST | `/support/template` | `createTemplate` | hidden |
| PUT | `/support/template/:id` | `updateTemplate` | hidden |
| DELETE | `/support/template/:id` | `deleteTemplate` | hidden |
| GET | `/support/transaction/:id/refund` | `getTransactionRefund` | hidden |
| PUT | `/support/transaction/:id/refund` | `setTransactionRefund` | hidden |
| GET | `/support/transactionList` | `getTransactionList` | hidden |

### AuthLnurlController

`src/subdomains/generic/user/models/auth/auth-lnurl.controller.ts` — 3 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| GET | `/lnurla` | `signInWithLnurlAuth` | public |
| POST | `/lnurla` | `getLnurlAuth` | public |
| GET | `/lnurla/status` | `lnurlAuthStatus` | public |

### AuthController

`src/subdomains/generic/user/models/auth/auth.controller.ts` — 14 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| POST | `/auth` | `authenticate` | public |
| GET | `/auth/2fa` | `check2fa` | hidden |
| POST | `/auth/2fa` | `setup2fa` | public |
| POST | `/auth/2fa/verify` | `verify2fa` | public |
| GET | `/auth/alby` | `signInWithAlby` | hidden |
| GET | `/auth/alby/redirect/:id` | `redirectAlby` | hidden |
| GET | `/auth/challenge` | `companyChallenge` | hidden |
| POST | `/auth/mail` | `signInByMail` | hidden |
| GET | `/auth/mail/confirm` | `executeMerge` | public |
| GET | `/auth/mail/redirect` | `redirectMail` | hidden |
| POST | `/auth/signIn` | `signIn` | hidden |
| GET | `/auth/signMessage` | `getSignMessage` | public |
| POST | `/auth/signUp` | `signUp` | public |
| GET | `/auth/verifySignature` | `verifySignMessage` | public |

### BankDataController

`src/subdomains/generic/user/models/bank-data/bank-data.controller.ts` — 2 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| PUT | `/bankData/:id` | `updateBankData` | public |
| PUT | `/bankData/:id/nameCheck` | `doNameCheck` | hidden |

### CustodyProviderController

`src/subdomains/generic/user/models/custody-provider/custody-provider.controller.ts` — 2 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| POST | `/CustodyProvider` | `createCustodyProvider` | public |
| PUT | `/CustodyProvider/:id` | `updateCustodyProvider` | hidden |

### KycClientController, KycController

`src/subdomains/generic/user/models/kyc/kyc.controller.ts` — 10 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| GET | `/kyc` | `getKycProgressV1` | public |
| POST | `/kyc` | `requestKycV1` | public |
| GET | `/kyc/:code` | `getKycProgressByCodeV1` | public |
| POST | `/kyc/:code` | `requestKycByCodeV1` | public |
| GET | `/kyc/:code/countries` | `getKycCountriesByCodeV1` | public |
| GET | `/kyc/:id/documents` | `getKycFilesV1` | public |
| GET | `/kyc/:id/documents/:type` | `getKycFileV1` | public |
| GET | `/kyc/countries` | `getKycCountriesV1` | public |
| PUT | `/kyc/transfer` | `transferKycDataV1` | public |
| GET | `/kyc/users` | `getAllKycDataV1` | public |

### RecommendationController

`src/subdomains/generic/user/models/recommendation/recommendation.controller.ts` — 4 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| GET | `/recommendation` | `getAllRecommendation` | public |
| POST | `/recommendation` | `createRecommendation` | hidden |
| PUT | `/recommendation/:id/confirm` | `confirmRecommendation` | hidden |
| PUT | `/recommendation/:id/reject` | `rejectRecommendation` | hidden |

### UserDataRelationController

`src/subdomains/generic/user/models/user-data-relation/user-data-relation.controller.ts` — 3 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| POST | `/userDataRelation` | `create` | public |
| PUT | `/userDataRelation/:id` | `update` | public |
| DELETE | `/userDataRelation/:id` | `delete` | public |

### UserDataController

`src/subdomains/generic/user/models/user-data/user-data.controller.ts` — 12 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| GET | `/userData` | `getAllUserData` | public |
| POST | `/userData` | `createEmptyUserData` | hidden |
| GET | `/userData/:id` | `getUserData` | public |
| PUT | `/userData/:id` | `updateUserData` | hidden |
| PUT | `/userData/:id/bankDatas` | `addBankData` | hidden |
| PUT | `/userData/:id/fee` | `addFee` | hidden |
| DELETE | `/userData/:id/fee` | `removeFee` | hidden |
| POST | `/userData/:id/kycFile` | `uploadKycFile` | hidden |
| PUT | `/userData/:id/merge` | `mergeUserData` | hidden |
| PUT | `/userData/:id/volumes` | `updateVolumes` | hidden |
| PUT | `/userData/auditPeriodNumbers` | `calculateAuditPeriodNumbers` | hidden |
| POST | `/userData/download` | `downloadUserData` | public |

### UserController, UserV2Controller

`src/subdomains/generic/user/models/user/user.controller.ts` — 26 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| GET | `/user` | `getUserV1` | public |
| GET | `/user` | `AuthGuard` | public |
| PUT | `/user` | `updateUserV1` | public |
| PUT | `/user` | `updateUser` | public |
| DELETE | `/user` | `AuthGuard` | public |
| DELETE | `/user` | `deleteAccount` | public |
| PUT | `/user/:id` | `updateUserAdmin` | hidden |
| DELETE | `/user/account` | `deleteUserAccount` | public |
| PUT | `/user/addresses/:address` | `updateAddress` | public |
| DELETE | `/user/addresses/:address` | `AuthGuard` | public |
| PUT | `/user/apiFilter/CT` | `updateApiFilter` | public |
| POST | `/user/apiKey/CT` | `createApiKey` | public |
| DELETE | `/user/apiKey/CT` | `deleteApiKey` | public |
| POST | `/user/change` | `changeUser` | public |
| POST | `/user/data` | `updateKycData` | hidden |
| GET | `/user/detail` | `getUserDetailV1` | public |
| PUT | `/user/discountCodes` | `addDiscountCode` | public |
| PUT | `/user/mail` | `updateUserMail` | public |
| POST | `/user/mail/verify` | `verifyMail` | public |
| PUT | `/user/name` | `updateUserName` | public |
| GET | `/user/profile` | `getProfile` | public |
| GET | `/user/ref` | `getRefInfo` | public |
| GET | `/user/ref` | `getRef` | public |
| PUT | `/user/ref` | `updateRefAsset` | public |
| PUT | `/user/specialCodes` | `addSpecialCode` | public |
| GET | `/user/volumes` | `getVolumes` | hidden |

### WalletController

`src/subdomains/generic/user/models/wallet/wallet.controller.ts` — 2 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| POST | `/wallet` | `createWallet` | public |
| PUT | `/wallet/:id` | `updateWallet` | hidden |

### DepositController

`src/subdomains/supporting/address-pool/deposit/deposit.controller.ts` — 2 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| POST | `/deposit` | `createDeposits` | public |
| PUT | `/deposit/lightningWebhook` | `updateLightningDepositWebhook` | hidden |

### BalanceController

`src/subdomains/supporting/balance/controllers/balance.controller.ts` — 2 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| GET | `/balance/pdf` | `getBalancePdf` | public |
| GET | `/balance/pdf/blockchains` | `getSupportedBlockchains` | public |

### BankTxRepeatController

`src/subdomains/supporting/bank-tx/bank-tx-repeat/bank-tx-repeat.controller.ts` — 1 endpoint

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| PUT | `/bankTxRepeat/:id` | `update` | public |

### BankTxReturnController

`src/subdomains/supporting/bank-tx/bank-tx-return/bank-tx-return.controller.ts` — 2 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| PUT | `/bankTxReturn/:id` | `update` | public |
| POST | `/bankTxReturn/:id/refund` | `refundBuyCrypto` | hidden |

### BankTxController

`src/subdomains/supporting/bank-tx/bank-tx/bank-tx.controller.ts` — 3 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| POST | `/bankTx` | `uploadSepaFiles` | public |
| PUT | `/bankTx/:id` | `update` | hidden |
| DELETE | `/bankTx/:id/buyCrypto` | `reset` | hidden |

### BankAccountController

`src/subdomains/supporting/bank/bank-account/bank-account.controller.ts` — 5 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| GET | `/bankAccount` | `AuthGuard` | public |
| POST | `/bankAccount` | `createBankAccount` | public |
| PUT | `/bankAccount/:id` | `updateBankAccount` | public |
| POST | `/bankAccount/bic` | `addBankAccountBic` | hidden |
| POST | `/bankAccount/iban` | `addBankAccountIban` | public |

### BankController

`src/subdomains/supporting/bank/bank/bank.controller.ts` — 2 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| GET | `/bank` | `getAllBanks` | public |
| PUT | `/bank/receiveIban` | `checkReceiveIban` | public |

### DashboardFinancialController

`src/subdomains/supporting/dashboard/dashboard-financial.controller.ts` — 5 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| GET | `/dashboard/financial/changes` | `getFinancialChanges` | hidden |
| GET | `/dashboard/financial/changes/latest` | `getLatestChanges` | hidden |
| GET | `/dashboard/financial/latest` | `getLatestBalance` | hidden |
| GET | `/dashboard/financial/log` | `getFinancialLog` | public |
| GET | `/dashboard/financial/ref-recipients` | `getRefRewardRecipients` | hidden |

### DashboardReconciliationController

`src/subdomains/supporting/dashboard/dashboard-reconciliation.controller.ts` — 2 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| GET | `/dashboard/financial/reconciliation` | `getReconciliation` | public |
| GET | `/dashboard/financial/reconciliation/overview` | `getOverview` | hidden |

### DexController

`src/subdomains/supporting/dex/dex.controller.ts` — 7 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| GET | `/dex/check-liquidity` | `checkLiquidity` | public |
| PUT | `/dex/complete-orders` | `completeOrders` | hidden |
| GET | `/dex/liquidity-after-purchase` | `fetchTargetLiquidityAfterPurchase` | hidden |
| POST | `/dex/purchase-liquidity` | `purchaseLiquidity` | hidden |
| POST | `/dex/reserve-liquidity` | `reserveLiquidity` | hidden |
| GET | `/dex/transfer-completion` | `checkTransferCompletion` | hidden |
| POST | `/dex/transfer-liquidity` | `transferLiquidity` | hidden |

### FiatOutputController

`src/subdomains/supporting/fiat-output/fiat-output.controller.ts` — 2 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| POST | `/fiatOutput` | `create` | public |
| PUT | `/fiatOutput/:id` | `update` | hidden |

### LogController

`src/subdomains/supporting/log/log.controller.ts` — 3 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| POST | `/log` | `create` | public |
| PUT | `/log/:id` | `update` | hidden |
| PUT | `/log/financial/validity` | `setFinancialLogValidity` | hidden |

### MrosController

`src/subdomains/supporting/mros/mros.controller.ts` — 4 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| GET | `/mros` | `getAll` | hidden |
| POST | `/mros` | `createMros` | public |
| GET | `/mros/:id` | `getById` | hidden |
| PUT | `/mros/:id` | `updateMros` | hidden |

### NotificationController

`src/subdomains/supporting/notification/notification.controller.ts` — 1 endpoint

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| POST | `/notification/send-mail` | `sendMail` | public |

### PayInWebhookController

`src/subdomains/supporting/payin/controllers/payin-webhook.controller.ts` — 2 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| POST | `/payIn/lnurlpDeposit/:uniqueId` | `deposit` | public |
| POST | `/payIn/lnurlpPayment/:uniqueId` | `payment` | hidden |

### PayInController

`src/subdomains/supporting/payin/controllers/payin.controller.ts` — 3 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| POST | `/payIn` | `createPayIn` | public |
| POST | `/payIn/poll` | `pollAddress` | hidden |
| POST | `/payIn/retry` | `retryUncertainSend` | hidden |

### FeeController

`src/subdomains/supporting/payment/controllers/fee.controller.ts` — 1 endpoint

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| POST | `/fee` | `createFee` | public |

### SpecialExternalAccountController

`src/subdomains/supporting/payment/controllers/special-external-account.controller.ts` — 1 endpoint

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| POST | `/specialExternalAccount` | `createSpecialExternalAccount` | public |

### TransactionAdminController

`src/subdomains/supporting/payment/controllers/transaction-admin.controller.ts` — 4 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| PUT | `/transaction/admin/:id` | `updateTransaction` | public |
| POST | `/transaction/admin/:id/stop` | `stopTransaction` | hidden |
| POST | `/transaction/admin/:txId/riskAssessment` | `createRiskAssessment` | hidden |
| PUT | `/transaction/admin/:txId/riskAssessment/:id` | `updateRiskAssessment` | hidden |

### PayoutController

`src/subdomains/supporting/payout/payout.controller.ts` — 4 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| POST | `/payout` | `doPayout` | public |
| GET | `/payout/completion` | `checkOrderCompletion` | hidden |
| POST | `/payout/retry` | `retryUncertainPayout` | hidden |
| POST | `/payout/speedup` | `speedupTransaction` | hidden |

### PricingController

`src/subdomains/supporting/pricing/pricing.controller.ts` — 3 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| GET | `/pricing` | `getRawPrice` | hidden |
| PUT | `/pricing` | `updatePrices` | hidden |
| GET | `/pricing/price` | `getPrice` | public |

### RealUnitComplianceController

`src/subdomains/supporting/realunit/controllers/realunit-compliance.controller.ts` — 5 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| GET | `/realunit/compliance/customers` | `searchCustomers` | public |
| GET | `/realunit/compliance/customers/:id` | `getCustomer` | hidden |
| GET | `/realunit/compliance/customers/:id/dossier` | `downloadCustomerDossier` | hidden |
| GET | `/realunit/compliance/customers/:id/files` | `getCustomerFiles` | hidden |
| GET | `/realunit/compliance/customers/:id/files/:uid` | `downloadCustomerFile` | hidden |

### RealUnitLegalController

`src/subdomains/supporting/realunit/controllers/realunit-legal.controller.ts` — 2 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| GET | `/realunit/legal` | `getLegal` | public |
| PUT | `/realunit/legal` | `acceptLegal` | public |

### RealUnitSupportController

`src/subdomains/supporting/realunit/controllers/realunit-support.controller.ts` — 10 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| PUT | `/realunit/support/:id` | `updateSupportIssue` | hidden |
| GET | `/realunit/support/:id/data` | `getIssueData` | hidden |
| POST | `/realunit/support/:id/message` | `createSupportMessage` | hidden |
| GET | `/realunit/support/:id/message/:messageId/file` | `getFile` | hidden |
| GET | `/realunit/support/:id/messages` | `getIssueMessages` | hidden |
| GET | `/realunit/support/activity` | `getSupportIssueActivity` | hidden |
| GET | `/realunit/support/clerks` | `getRealUnitSupportClerks` | hidden |
| GET | `/realunit/support/counts` | `getSupportIssueCounts` | hidden |
| GET | `/realunit/support/list` | `getSupportIssueList` | public |
| GET | `/realunit/support/statistics` | `getSupportIssueStatistics` | hidden |

### RealUnitController

`src/subdomains/supporting/realunit/controllers/realunit.controller.ts` — 47 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| GET | `/realunit/account/:address` | `getAccountSummary` | public |
| GET | `/realunit/account/:address/history` | `getAccountHistory` | public |
| GET | `/realunit/admin/quotes` | `getAdminQuotes` | public |
| PUT | `/realunit/admin/quotes/:id/confirm-payment` | `confirmPaymentReceived` | hidden |
| PUT | `/realunit/admin/registration/:id/forward` | `forwardRegistration` | hidden |
| GET | `/realunit/admin/transactions` | `getAdminTransactions` | hidden |
| POST | `/realunit/balance/pdf` | `getBalancePdf` | public |
| GET | `/realunit/brokerbot/buyPrice` | `getBrokerbotBuyPrice` | public |
| GET | `/realunit/brokerbot/buyShares` | `getBrokerbotBuyShares` | public |
| GET | `/realunit/brokerbot/info` | `getBrokerbotInfo` | public |
| GET | `/realunit/brokerbot/price` | `getBrokerbotPrice` | public |
| GET | `/realunit/brokerbot/sellPrice` | `getBrokerbotSellPrice` | public |
| GET | `/realunit/brokerbot/sellShares` | `getBrokerbotSellShares` | public |
| PUT | `/realunit/buy` | `getPaymentInfo` | public |
| PUT | `/realunit/buy/:id/confirm` | `confirmBuy` | public |
| GET | `/realunit/confirm-aktionariat` | `confirmAktionariat` | public |
| GET | `/realunit/holders` | `getHolders` | public |
| GET | `/realunit/pay/:id/status` | `getOcpPayStatus` | public |
| PUT | `/realunit/pay/submit` | `submitOcpPay` | public |
| PUT | `/realunit/pay/unsigned-transaction` | `getOcpPayUnsignedTransaction` | public |
| GET | `/realunit/price` | `getRealUnitPrice` | public |
| GET | `/realunit/price/history` | `getHistoricalPrice` | public |
| GET | `/realunit/quote/buyPrice` | `getQuoteBuyPrice` | public |
| GET | `/realunit/quote/buyShares` | `getQuoteBuyShares` | public |
| GET | `/realunit/quote/info` | `getQuoteInfo` | public |
| GET | `/realunit/quote/price` | `getQuotePrice` | public |
| GET | `/realunit/quote/sellPrice` | `getQuoteSellPrice` | public |
| GET | `/realunit/quote/sellShares` | `getQuoteSellShares` | public |
| POST | `/realunit/register/complete` | `completeRegistration` | public |
| GET | `/realunit/register/date` | `getRegistrationDate` | public |
| POST | `/realunit/register/email` | `registerEmail` | public |
| GET | `/realunit/register/status` | `isRegistered` | public |
| POST | `/realunit/register/wallet` | `completeRegistrationForWalletAddress` | public |
| GET | `/realunit/registration` | `getRegistrationInfo` | public |
| PUT | `/realunit/sell` | `getSellPaymentInfo` | public |
| PUT | `/realunit/sell/:id/broadcast` | `broadcastSellTransaction` | public |
| PUT | `/realunit/sell/:id/confirm` | `confirmSell` | public |
| PUT | `/realunit/sell/:id/unsigned-transactions` | `getSellUnsignedTransactions` | public |
| PUT | `/realunit/swap` | `getSwapPaymentInfo` | public |
| PUT | `/realunit/swap/:id/broadcast` | `broadcastSwapTransaction` | public |
| PUT | `/realunit/swap/:id/unsigned-transaction` | `getSwapUnsignedTransaction` | public |
| GET | `/realunit/tokenInfo` | `getTokenInfo` | public |
| POST | `/realunit/transactions/receipt/multi` | `generateHistoryMultiReceipt` | public |
| POST | `/realunit/transactions/receipt/single` | `generateHistoryReceipt` | public |
| PUT | `/realunit/transfer` | `prepareTransfer` | public |
| PUT | `/realunit/transfer/:id/confirm` | `confirmTransfer` | public |
| GET | `/realunit/wallet/status` | `getWalletStatus` | public |

### RecallController

`src/subdomains/supporting/recall/recall.controller.ts` — 4 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| GET | `/recall` | `getAll` | hidden |
| POST | `/recall` | `createRecall` | public |
| GET | `/recall/:id` | `getById` | hidden |
| PUT | `/recall/:id` | `updateRecall` | hidden |

### LimitRequestController

`src/subdomains/supporting/support-issue/limit-request.controller.ts` — 1 endpoint

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| PUT | `/limitRequest/:id` | `updateUserData` | public |

### SupportIssueController

`src/subdomains/supporting/support-issue/support-issue.controller.ts` — 18 endpoints

| Method | Path | Handler | Swagger |
| ------ | ---- | ------- | ------- |
| GET | `/support/issue` | `getIssues` | public |
| POST | `/support/issue` | `createIssue` | public |
| GET | `/support/issue/:id` | `getIssue` | hidden |
| PUT | `/support/issue/:id` | `updateSupportIssue` | public |
| PUT | `/support/issue/:id/close` | `closeIssue` | public |
| GET | `/support/issue/:id/data` | `getIssueData` | hidden |
| POST | `/support/issue/:id/message` | `createSupportMessage` | hidden |
| GET | `/support/issue/:id/message/:messageId/file` | `getFile` | public |
| GET | `/support/issue/activity` | `getSupportIssueActivity` | hidden |
| GET | `/support/issue/clerk` | `getSupportIssueClerk` | hidden |
| GET | `/support/issue/clerks` | `getSupportIssueClerks` | hidden |
| GET | `/support/issue/counts` | `getSupportIssueCounts` | hidden |
| POST | `/support/issue/escalation/telegram-bind` | `bindEscalationChat` | hidden |
| GET | `/support/issue/escalation/telegram-chats` | `getEscalationChats` | hidden |
| POST | `/support/issue/escalation/telegram-test` | `testEscalationChat` | hidden |
| GET | `/support/issue/list` | `getSupportIssueList` | public |
| GET | `/support/issue/statistics` | `getSupportIssueStatistics` | hidden |
| POST | `/support/issue/support` | `createIssueBySupport` | public |

