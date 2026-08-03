# Cron jobs

Every scheduled job this service runs: **138 `@DfxCron` declarations** across 97 files and 34 areas.

## Columns

| Column | Meaning |
| ------ | ------- |
| **Interval** | The `CronExpression` / `CustomCronExpression` the job is registered with |
| **Flag** | The `process:` kill switch that disables the job at runtime. `—` means the job has none and always runs |
| **Scope** | Which process registers the job: `worker`, `api`, or `both` |
| **Job** | Class and method |
| **File** | Path below `src/` |

## Scopes

`scope` is a mandatory parameter of `@DfxCron` and says which process registers the job:
117 are `worker`, 7 are `api`, 14 are `both`. `CRON_ROLE` decides what a process is
(`worker`, `api`, or `all` for a single-process setup); a process runs its own scope plus `both`.

`worker` is the normal case — anything writing to the database or driving business forward belongs
to exactly one process. `both` is for a job maintaining process-local state that a request path
also reads, so it must run everywhere; running it twice has to be harmless by construction, which
rules out database writes, mail and paid external calls. `api` is for state read only from a
request path, or for work bound to the connections that process holds open.

Getting the scope wrong fails silently: the cache a job maintains simply stays empty in the
process that reads it. The rule that keeps that harmless is in CONTRIBUTING.md — a cache read in a
request path loads on demand, and a job may refresh it but must not be the only thing filling it.

## Flags

117 of the 138 jobs carry a `process` flag, 21 do not. A job with a flag can be switched off
without a deploy — `DfxCronService` skips it when the process appears in the disabled set, which
`ProcessService` refreshes from the `disabledProcesses` setting and the `DISABLED_PROCESSES`
environment variable every 30 seconds.

A job **without** a flag runs unconditionally. That is deliberate for five of them. The four
`ProcessService::resync*` jobs maintain the disabled set, the JWT denylists and the staff
clearance allowlist themselves, so making them switchable would let a configuration change
disable the mechanism that reads configuration changes. `DfxCronService::reportRole` is the role
heartbeat the `dfx-api-role-mismatch` alert reads: switched off, it would look exactly like a
process that stopped reporting, which is the condition the alert exists to catch. For the
remaining 16 it is simply an omission:

| Job | Interval |
| --- | --- |
| `ExchangeController::checkTrades` | 30 seconds |
| `AuthService::checkLists` | minute |
| `TransactionController::checkLists` | minute |
| `StaffKycClearanceService::syncStaffKycClearance` | minute |
| `UserDataService::processCleanupMailSecretCache` | minute |
| `TransactionHelper::updateCache` | 5 minutes |
| `BuyService` / `SellService` / `SwapService` / `UserService` / `UserDataService` `::resetMonthlyVolumes` | 1st of month |
| `BuyService` / `SellService` / `SwapService` / `UserService` / `UserDataService` `::resetAnnualVolumes` | year |

New jobs should declare a flag unless there is a reason like the one above.

## Distribution

| Interval | Jobs |
| -------- | ---: |
| second | 5 |
| 10 seconds | 3 |
| 30 seconds | 9 |
| minute | 52 |
| 5 minutes | 18 |
| 10 minutes | 16 |
| hour | 16 |
| day at 3am | 1 |
| day at 4am | 3 |
| day at 5am | 1 |
| day at 6am | 1 |
| day at 11pm | 1 |
| week | 1 |
| weekend | 1 |
| 1st day of month at midnight | 5 |
| year | 5 |

Jobs by area:

| Area | Jobs | Without flag |
| ---- | ---: | -----------: |
| `subdomains/generic/user` | 16 | 7 |
| `subdomains/core/monitoring` | 14 | — |
| `subdomains/core/accounting` | 13 | — |
| `subdomains/supporting/payin` | 12 | — |
| `integration/blockchain` | 7 | — |
| `subdomains/core/buy-crypto` | 6 | 4 |
| `shared/services` | 5 | 5 |
| `subdomains/core/sell-crypto` | 5 | 2 |
| `subdomains/supporting/payment` | 5 | 1 |
| `subdomains/core/payment-link` | 4 | — |
| `subdomains/generic/kyc` | 4 | — |
| `subdomains/supporting/bank` | 4 | — |
| `subdomains/supporting/bank-tx` | 4 | — |
| `subdomains/supporting/fiat-output` | 4 | — |
| `subdomains/supporting/support-issue` | 4 | — |
| `subdomains/core/liquidity-management` | 3 | — |
| `subdomains/core/referral` | 3 | — |
| `subdomains/core/trading` | 3 | — |
| `subdomains/supporting/pricing` | 3 | — |
| `integration/exchange` | 2 | 1 |
| `subdomains/core/custody` | 2 | — |
| `subdomains/supporting/log` | 2 | — |
| `subdomains/supporting/realunit` | 2 | — |
| `integration/binance-pay` | 1 | — |
| `subdomains/core/aml` | 1 | — |
| `subdomains/core/faucet-request` | 1 | — |
| `subdomains/core/history` | 1 | 1 |
| `subdomains/core/statistic` | 1 | — |
| `subdomains/generic/admin` | 1 | — |
| `subdomains/supporting/dashboard` | 1 | — |
| `subdomains/supporting/dex` | 1 | — |
| `subdomains/supporting/fiat-payin` | 1 | — |
| `subdomains/supporting/notification` | 1 | — |
| `subdomains/supporting/payout` | 1 | — |

## How this list is produced

Every `@DfxCron(` occurrence in `src/**/*.ts`. Decorator arguments are read by a balanced-paren
scan, so multi-line declarations are included — a line-based match misses 26 of them. Interval,
flag and scope come from those arguments, so all three are as accurate as the source. The parsed
count is asserted against a raw text count of the decorator: **138 = 138**, no gap. Class and
method come from the enclosing `export class` (including `export abstract class`) and the
identifier following the decorator.

## Known discrepancies

Both come from the same place: this list counts **declarations**, while `DfxCronService` registers
what `DiscoveryService.getProviders()` hands it. The two are not the same set.

`CitreaBaseStrategy::checkPayInEntries` is declared on an **abstract** class. NestJS discovers
providers rather than classes, so such a job is registered once per concrete subclass, not once per
declaration. There is currently one subclass, so the runtime count equals the declaration count —
but a second subclass would silently add another registration of the same job, sharing the flag and
the interval while running as an independent timer with its own lock.

`ExchangeController::checkTrades` is **never registered**. Its class is listed under `controllers:`
in `ExchangeModule` and nowhere under `providers:`, and `getProviders()` does not return
controllers — so the scan never sees the decorator. This predates the process split and is
unchanged by it; the job has never run. `TransactionController::checkLists` looks like the same
case but is not: `HistoryModule` lists that class under both `controllers:` and `providers:`, so
the job is registered — on the provider instance, which is a different object from the controller
instance the request handlers use.

Resolving either one is a decision about the jobs, not about this inventory, so both are recorded
here rather than fixed in passing. Of the 138 declarations, 137 have a registration path.

## Jobs

| Interval | Flag | Scope | Job | File |
| -------- | ---- | ----- | --- | ---- |
| second | `PAY_IN` | `worker` | `BitcoinStrategy::checkPayInEntries` | `subdomains/supporting/payin/strategies/register/impl/bitcoin.strategy.ts` |
| second | `PAY_IN` | `worker` | `FiroStrategy::checkPayInEntries` | `subdomains/supporting/payin/strategies/register/impl/firo.strategy.ts` |
| second | `PAY_IN` | `worker` | `MoneroStrategy::checkPayInEntries` | `subdomains/supporting/payin/strategies/register/impl/monero.strategy.ts` |
| second | `MONITOR_CONNECTION_POOL` | `both` | `MonitorConnectionPoolService::monitorConnectionPool` | `subdomains/core/monitoring/monitor-connection-pool.service.ts` |
| second | `PAY_IN` | `worker` | `ZanoStrategy::checkPayInEntries` | `subdomains/supporting/payin/strategies/register/impl/zano.strategy.ts` |
| 10 seconds | `LIQUIDITY_MANAGEMENT` | `worker` | `LiquidityManagementPipelineService::processPipelines` | `subdomains/core/liquidity-management/services/liquidity-management-pipeline.service.ts` |
| 10 seconds | `MONITOR_CONNECTION_POOL` | `both` | `MonitorConnectionPoolService::monitorConnectionPoolStatic` | `subdomains/core/monitoring/monitor-connection-pool.service.ts` |
| 10 seconds | `MONITOR_EVENT_LOOP` | `both` | `MonitorEventLoopService::monitorEventLoop` | `subdomains/core/monitoring/monitor-event-loop.service.ts` |
| 30 seconds | `LNURL_AUTH_CACHE` | `both` | `AuthLnUrlService::processCleanupAccessToken` | `subdomains/generic/user/models/auth/auth-lnurl.service.ts` |
| 30 seconds | `BANK_TX` | `worker` | `BankTxService::checkBankTx` | `subdomains/supporting/bank-tx/bank-tx/services/bank-tx.service.ts` |
| 30 seconds | `DEX_PURCHASE_ORDER` | `worker` | `DexService::finalizePurchaseOrders` | `subdomains/supporting/dex/services/dex.service.ts` |
| 30 seconds | — | `api` | `ExchangeController::checkTrades` | `integration/exchange/controllers/exchange.controller.ts` |
| 30 seconds | `PAY_OUT` | `worker` | `PayoutService::processOrders` | `subdomains/supporting/payout/services/payout.service.ts` |
| 30 seconds | — | `both` | `ProcessService::resyncDeniedJwtAccounts` | `shared/services/process.service.ts` |
| 30 seconds | — | `both` | `ProcessService::resyncDeniedJwtAddresses` | `shared/services/process.service.ts` |
| 30 seconds | — | `both` | `ProcessService::resyncDisabledProcesses` | `shared/services/process.service.ts` |
| 30 seconds | — | `both` | `ProcessService::resyncStaffKycClearance` | `shared/services/process.service.ts` |
| minute | `PAY_OUT` | `worker` | `AdminService::completeLiquidityOrders` | `subdomains/generic/admin/admin.service.ts` |
| minute | `MONITORING` | `worker` | `AmlObserver::fetch` | `subdomains/core/monitoring/observers/aml.observer.ts` |
| minute | — | `both` | `AuthService::checkLists` | `subdomains/generic/user/models/auth/auth.service.ts` |
| minute | `BANK_DATA_VERIFICATION` | `worker` | `BankDataService::checkAndSetActive` | `subdomains/generic/user/models/bank-data/bank-data.service.ts` |
| minute | `MONITORING` | `worker` | `BankObserver::fetch` | `subdomains/core/monitoring/observers/bank.observer.ts` |
| minute | `BANK_TX_RETURN_MAIL` | `worker` | `BankTxReturnNotificationService::sendBankTxReturnMail` | `subdomains/supporting/bank-tx/bank-tx-return/bank-tx-return-notification.service.ts` |
| minute | `BUY_CRYPTO` | `worker` | `BuyCryptoJobService::process` | `subdomains/core/buy-crypto/process/services/buy-crypto-job.service.ts` |
| minute | `BUY_FIAT` | `worker` | `BuyFiatJobService::addFiatOutputs` | `subdomains/core/sell-crypto/process/services/buy-fiat-job.service.ts` |
| minute | `BUY_FIAT` | `worker` | `BuyFiatJobService::checkCryptoPayIn` | `subdomains/core/sell-crypto/process/services/buy-fiat-job.service.ts` |
| minute | `BUY_FIAT_MAIL` | `worker` | `BuyFiatNotificationService::sendNotificationMails` | `subdomains/core/sell-crypto/process/services/buy-fiat-notification.service.ts` |
| minute | `PAY_IN` | `worker` | `CardanoStrategy::checkPayInEntries` | `subdomains/supporting/payin/strategies/register/impl/cardano.strategy.ts` |
| minute | `MONITORING` | `worker` | `CheckoutObserver::fetch` | `subdomains/core/monitoring/observers/checkout.observer.ts` |
| minute | `PAY_IN` | `worker` | `CitreaBaseStrategy::checkPayInEntries` | `subdomains/supporting/payin/strategies/register/impl/base/citrea.strategy.ts` |
| minute | `CUSTODY` | `worker` | `CustodyJobService::handleOrders` | `subdomains/core/custody/services/custody-job.service.ts` |
| minute | `LATEST_BALANCE_CACHE` | `api` | `DashboardFinancialService::refreshLatestBalance` | `subdomains/supporting/dashboard/dashboard-financial.service.ts` |
| minute | `FIAT_OUTPUT` | `worker` | `FiatOutputJobService::fillFiatOutput` | `subdomains/supporting/fiat-output/fiat-output-job.service.ts` |
| minute | `FIAT_PAY_IN` | `worker` | `FiatPayInSyncService::syncCheckout` | `subdomains/supporting/fiat-payin/services/fiat-payin-sync.service.ts` |
| minute | `PAY_IN` | `worker` | `InternetComputerStrategy::checkPayInEntries` | `subdomains/supporting/payin/strategies/register/impl/icp.strategy.ts` |
| minute | `JWT_REVOCATION_SYNC` | `worker` | `JwtRevocationSyncService::syncDeniedJwtAccounts` | `subdomains/generic/user/models/user-data/jwt-revocation-sync.service.ts` |
| minute | `KYC` | `worker` | `KycService::reviewKycSteps` | `subdomains/generic/kyc/services/kyc.service.ts` |
| minute | `LEDGER_BOOKING_BANK_TX` | `worker` | `LedgerBookingJobService::runBankTx` | `subdomains/core/accounting/services/ledger-booking-job.service.ts` |
| minute | `LEDGER_BOOKING_BUY_CRYPTO` | `worker` | `LedgerBookingJobService::runBuyCrypto` | `subdomains/core/accounting/services/ledger-booking-job.service.ts` |
| minute | `LEDGER_BOOKING_BUY_FIAT` | `worker` | `LedgerBookingJobService::runBuyFiat` | `subdomains/core/accounting/services/ledger-booking-job.service.ts` |
| minute | `LEDGER_BOOKING_CRYPTO_INPUT` | `worker` | `LedgerBookingJobService::runCryptoInput` | `subdomains/core/accounting/services/ledger-booking-job.service.ts` |
| minute | `LEDGER_BOOKING_EXCHANGE_TX` | `worker` | `LedgerBookingJobService::runExchangeTx` | `subdomains/core/accounting/services/ledger-booking-job.service.ts` |
| minute | `LEDGER_BOOKING_LIQUIDITY_MANAGEMENT` | `worker` | `LedgerBookingJobService::runLiquidityMgmt` | `subdomains/core/accounting/services/ledger-booking-job.service.ts` |
| minute | `LEDGER_BOOKING_LIQUIDITY_ORDER` | `worker` | `LedgerBookingJobService::runLiquidityOrderDex` | `subdomains/core/accounting/services/ledger-booking-job.service.ts` |
| minute | `LEDGER_BOOKING_PAYOUT` | `worker` | `LedgerBookingJobService::runPayoutOrder` | `subdomains/core/accounting/services/ledger-booking-job.service.ts` |
| minute | `LEDGER_BOOKING_TRADING_ORDER` | `worker` | `LedgerBookingJobService::runTradingOrder` | `subdomains/core/accounting/services/ledger-booking-job.service.ts` |
| minute | `LIQUIDITY_MANAGEMENT_CHECK_BALANCES` | `worker` | `LiquidityManagementService::checkLiquidityBalances` | `subdomains/core/liquidity-management/services/liquidity-management.service.ts` |
| minute | `MONITORING` | `worker` | `LiquidityObserver::fetch` | `subdomains/core/monitoring/observers/liquidity.observer.ts` |
| minute | `TRADING_LOG` | `worker` | `LogJobService::saveTradingLog` | `subdomains/supporting/log/log-job.service.ts` |
| minute | `MONITORING` | `worker` | `NodeHealthObserver::fetch` | `subdomains/core/monitoring/observers/node-health.observer.ts` |
| minute | `ORGANIZATION_SYNC` | `worker` | `OrganizationService::syncOrganization` | `subdomains/generic/user/models/organization/organization.service.ts` |
| minute | `PAY_IN` | `worker` | `PayInService::checkConfirmations` | `subdomains/supporting/payin/services/payin.service.ts` |
| minute | `PAY_IN` | `worker` | `PayInService::forwardPayInEntries` | `subdomains/supporting/payin/services/payin.service.ts` |
| minute | `PAY_IN` | `worker` | `PayInService::returnPayInEntries` | `subdomains/supporting/payin/services/payin.service.ts` |
| minute | `PAYMENT_CONFIRMATIONS` | `api` | `PaymentCronService::checkTxConfirmations` | `subdomains/core/payment-link/services/payment-cron.service.ts` |
| minute | `PAYMENT_EXPIRATION` | `api` | `PaymentCronService::processExpiredPayments` | `subdomains/core/payment-link/services/payment-cron.service.ts` |
| minute | `UPDATE_BLOCKCHAIN_FEE` | `api` | `PaymentLinkFeeService::updateFees` | `subdomains/core/payment-link/services/payment-link-fee.service.ts` |
| minute | `REALUNIT_QUOTE_COMPLETION` | `worker` | `RealUnitJobService::completeSettledQuotes` | `subdomains/supporting/realunit/realunit-job.service.ts` |
| minute | — | `worker` | `StaffKycClearanceService::syncStaffKycClearance` | `subdomains/generic/user/models/user/staff-kyc-clearance.service.ts` |
| minute | `SUPPORT_BOT` | `worker` | `SupportIssueJobService::sendAutoResponses` | `subdomains/supporting/support-issue/services/support-issue-job.service.ts` |
| minute | `TFA_CACHE` | `both` | `TfaService::processCleanupSecretCache` | `subdomains/generic/kyc/services/tfa.service.ts` |
| minute | `TRADING` | `worker` | `TradingJobService::processOrders` | `subdomains/core/trading/services/trading-job.service.ts` |
| minute | `TRADING` | `worker` | `TradingJobService::processRules` | `subdomains/core/trading/services/trading-job.service.ts` |
| minute | — | `api` | `TransactionController::checkLists` | `subdomains/core/history/controllers/transaction.controller.ts` |
| minute | `TX_MAIL` | `worker` | `TransactionNotificationService::sendNotificationMails` | `subdomains/supporting/payment/services/transaction-notification.service.ts` |
| minute | `TX_REQUEST` | `worker` | `TransactionRequestService::txRequestStatusSync` | `subdomains/supporting/payment/services/transaction-request.service.ts` |
| minute | `USER_DATA` | `worker` | `UserDataJobService::fillUserData` | `subdomains/generic/user/models/user-data/user-data-job.service.ts` |
| minute | — | `both` | `UserDataService::processCleanupMailSecretCache` | `subdomains/generic/user/models/user-data/user-data.service.ts` |
| minute | `USER` | `worker` | `UserJobService::fillUser` | `subdomains/generic/user/models/user/user-job.service.ts` |
| 5 minutes | `PRICING` | `worker` | `AssetPricesJobService::updatePaymentPrices` | `subdomains/supporting/pricing/services/asset-prices-job.service.ts` |
| 5 minutes | `LNURL_AUTH_CACHE` | `both` | `AuthLnUrlService::processCleanupAuthCache` | `subdomains/generic/user/models/auth/auth-lnurl.service.ts` |
| 5 minutes | `BANK_TX_RETURN` | `worker` | `BankTxReturnService::fillBankTxReturn` | `subdomains/supporting/bank-tx/bank-tx-return/bank-tx-return.service.ts` |
| 5 minutes | `BANK_TX` | `worker` | `BankTxService::enrichYapealTransactions` | `subdomains/supporting/bank-tx/bank-tx/services/bank-tx.service.ts` |
| 5 minutes | `BLOCKCHAIN_CONFIG_CHECK` | `worker` | `BlockchainConfigCheckService::logUnconfiguredClients` | `integration/blockchain/shared/services/blockchain-config-check.service.ts` |
| 5 minutes | `EXCHANGE_TX_SYNC` | `worker` | `ExchangeTxService::syncExchangeJob` | `integration/exchange/services/exchange-tx.service.ts` |
| 5 minutes | `CRYPTO_PAYOUT` | `worker` | `FaucetRequestService::checkFaucetRequests` | `subdomains/core/faucet-request/services/faucet-request.service.ts` |
| 5 minutes | `LEDGER_COA_BOOTSTRAP` | `worker` | `LedgerBookingJobService::runCoaBootstrap` | `subdomains/core/accounting/services/ledger-booking-job.service.ts` |
| 5 minutes | `LEDGER_CUTOVER` | `worker` | `LedgerCutoverService::run` | `subdomains/core/accounting/services/ledger-cutover.service.ts` |
| 5 minutes | `LIMIT_REQUEST_MAIL` | `worker` | `LimitRequestNotificationService::sendNotificationMails` | `subdomains/supporting/support-issue/services/limit-request-notification.service.ts` |
| 5 minutes | `LIQUIDITY_MANAGEMENT` | `worker` | `LiquidityManagementRuleService::reactivateRules` | `subdomains/core/liquidity-management/services/liquidity-management-rule.service.ts` |
| 5 minutes | `PAY_IN_MAIL` | `worker` | `PayInNotificationService::sendNotificationMails` | `subdomains/supporting/payin/services/payin-notification.service.ts` |
| 5 minutes | `REALUNIT_TRANSFER_RECONCILIATION` | `worker` | `RealUnitJobService::reconcilePendingTransfers` | `subdomains/supporting/realunit/realunit-job.service.ts` |
| 5 minutes | `SPARK_TOKEN_OPTIMIZATION` | `worker` | `SparkService::optimizeTokenOutputs` | `integration/blockchain/spark/spark.service.ts` |
| 5 minutes | `SUPPORT_BOT` | `worker` | `SupportEscalationService::checkEscalations` | `subdomains/supporting/support-issue/services/support-escalation.service.ts` |
| 5 minutes | `TRADING` | `worker` | `TradingJobService::reactivateRules` | `subdomains/core/trading/services/trading-job.service.ts` |
| 5 minutes | — | `both` | `TransactionHelper::updateCache` | `subdomains/supporting/payment/services/transaction-helper.ts` |
| 5 minutes | `WEBHOOK` | `worker` | `WebhookNotificationService::sendWebhooks` | `subdomains/generic/user/services/webhook/webhook-notification.service.ts` |
| 10 minutes | `BANK_ACCOUNT` | `worker` | `BankAccountService::reloadUncheckedBankAccounts` | `subdomains/supporting/bank/bank-account/bank-account.service.ts` |
| 10 minutes | `DEURO_LOG_INFO` | `worker` | `DEuroService::processLogInfo` | `integration/blockchain/deuro/deuro.service.ts` |
| 10 minutes | — | `both` | `DfxCronService::reportRole` | `shared/services/dfx-cron.service.ts` |
| 10 minutes | `MONITORING` | `worker` | `ExchangeObserver::fetch` | `subdomains/core/monitoring/observers/exchange.observer.ts` |
| 10 minutes | `MONITORING` | `worker` | `ExternalServicesObserver::fetch` | `subdomains/core/monitoring/observers/external-services.observer.ts` |
| 10 minutes | `BLOCKCHAIN_FEE_UPDATE` | `worker` | `FeeService::updateBlockchainFees` | `subdomains/supporting/payment/services/fee.service.ts` |
| 10 minutes | `FRANKENCOIN_LOG_INFO` | `worker` | `FrankencoinService::processLogInfo` | `integration/blockchain/frankencoin/frankencoin.service.ts` |
| 10 minutes | `JUICE_LOG_INFO` | `worker` | `JuiceService::processLogInfo` | `integration/blockchain/juice/juice.service.ts` |
| 10 minutes | `MONITORING` | `worker` | `NodeBalanceObserver::fetch` | `subdomains/core/monitoring/observers/node-balance.observer.ts` |
| 10 minutes | `MAIL_RETRY` | `worker` | `NotificationJobService::resendUncompletedMails` | `subdomains/supporting/notification/services/notification-job.service.ts` |
| 10 minutes | `PAY_IN` | `worker` | `PayInService::updateFailedPayments` | `subdomains/supporting/payin/services/payin.service.ts` |
| 10 minutes | `MONITORING` | `worker` | `PaymentObserver::fetch` | `subdomains/core/monitoring/observers/payment.observer.ts` |
| 10 minutes | `MONITORING` | `worker` | `RealUnitW2wGasObserver::fetch` | `subdomains/core/monitoring/observers/realunit-w2w-gas.observer.ts` |
| 10 minutes | `REF_PAYOUT` | `worker` | `RefRewardJobService::processPendingRefRewards` | `subdomains/core/referral/reward/services/ref-reward-job.service.ts` |
| 10 minutes | `MONITORING` | `worker` | `UserObserver::fetch` | `subdomains/core/monitoring/observers/user.observer.ts` |
| 10 minutes | `ZANO_ASSET_WHITELIST` | `worker` | `ZanoService::setupAssetWhitelist` | `integration/blockchain/zano/services/zano.service.ts` |
| hour | `PRICING` | `worker` | `AssetPricesJobService::updatePrices` | `subdomains/supporting/pricing/services/asset-prices-job.service.ts` |
| hour | `BANK_ACCOUNT` | `worker` | `BankAccountService::reloadErrorBankAccounts` | `subdomains/supporting/bank/bank-account/bank-account.service.ts` |
| hour | `BINANCE_PAY_CERTIFICATES_UPDATE` | `worker` | `BinancePayService::updateCertificates` | `integration/binance-pay/services/binance-pay.service.ts` |
| hour | `BUY_CRYPTO_AGGREGATION` | `worker` | `BuyCryptoJobService::checkAggregatingTransactions` | `subdomains/core/buy-crypto/process/services/buy-crypto-job.service.ts` |
| hour | `ASSET_DECIMALS` | `worker` | `EvmDecimalsService::setDecimals` | `integration/blockchain/shared/evm/evm-decimals.service.ts` |
| hour | `FIAT_OUTPUT` | `worker` | `FiatOutputFrickService::checkFrickOrderStatus` | `subdomains/supporting/fiat-output/fiat-output-frick.service.ts` |
| hour | `FIAT_OUTPUT` | `worker` | `FiatOutputJobService::checkOlkypayOrderStatus` | `subdomains/supporting/fiat-output/fiat-output-job.service.ts` |
| hour | `FIAT_OUTPUT` | `worker` | `FiatOutputJobService::generateReports` | `subdomains/supporting/fiat-output/fiat-output-job.service.ts` |
| hour | `PRICING` | `worker` | `FiatPricesService::updatePrices` | `subdomains/supporting/pricing/services/fiat-prices.service.ts` |
| hour | `KYC_MAIL` | `worker` | `KycNotificationService::sendNotificationMails` | `subdomains/generic/kyc/services/kyc-notification.service.ts` |
| hour | `PAYMENT_FORWARDING` | `worker` | `PaymentCronService::forwardDeposits` | `subdomains/core/payment-link/services/payment-cron.service.ts` |
| hour | `REF_CLEANUP` | `worker` | `RefService::checkRefs` | `subdomains/core/referral/process/ref.service.ts` |
| hour | `UPDATE_STATISTIC` | `api` | `StatisticService::doUpdate` | `subdomains/core/statistic/statistic.service.ts` |
| hour | `SUPPORT_BOT` | `worker` | `SupportIssueJobService::autoOnHold` | `subdomains/supporting/support-issue/services/support-issue-job.service.ts` |
| hour | `BLACK_SQUAD_MAIL` | `worker` | `UserDataNotificationService::sendNotificationMails` | `subdomains/generic/user/models/user-data/user-data-notification.service.ts` |
| hour | `VIRTUAL_IBAN_FRICK_ISSUANCE_RECONCILIATION` | `worker` | `VirtualIbanFrickIssuanceReconciliationService::reconcileRetiredIssuanceReferences` | `subdomains/supporting/bank/virtual-iban/virtual-iban-frick-issuance-reconciliation.service.ts` |
| day at 3am | `TX_REQUEST_WAITING_EXPIRY` | `worker` | `TransactionRequestService::txRequestWaitingExpiryCheck` | `subdomains/supporting/payment/services/transaction-request.service.ts` |
| day at 4am | `CUSTODY` | `worker` | `CustodyJobService::resetExpiredConfirmedOrders` | `subdomains/core/custody/services/custody-job.service.ts` |
| day at 4am | `KYC` | `worker` | `KycService::checkIdentSteps` | `subdomains/generic/kyc/services/kyc.service.ts` |
| day at 4am | `LEDGER_MARK_TO_MARKET` | `worker` | `LedgerMarkToMarketService::run` | `subdomains/core/accounting/services/ledger-mark-to-market.service.ts` |
| day at 5am | `LEDGER_RECONCILIATION` | `worker` | `LedgerReconciliationService::run` | `subdomains/core/accounting/services/ledger-reconciliation.service.ts` |
| day at 6am | `REF_PAYOUT` | `worker` | `RefRewardJobService::createPendingRefRewards` | `subdomains/core/referral/reward/services/ref-reward-job.service.ts` |
| day at 11pm | `LOG_CLEANUP` | `worker` | `LogService::cleanup` | `subdomains/supporting/log/log.service.ts` |
| week | `BANK_ACCOUNT` | `worker` | `BankAccountService::checkFailedBankAccounts` | `subdomains/supporting/bank/bank-account/bank-account.service.ts` |
| weekend | `SANCTION_SYNC` | `worker` | `SanctionService::syncList` | `subdomains/core/aml/services/sanction.service.ts` |
| 1st day of month at midnight | — | `worker` | `BuyService::resetMonthlyVolumes` | `subdomains/core/buy-crypto/routes/buy/buy.service.ts` |
| 1st day of month at midnight | — | `worker` | `SellService::resetMonthlyVolumes` | `subdomains/core/sell-crypto/route/sell.service.ts` |
| 1st day of month at midnight | — | `worker` | `SwapService::resetMonthlyVolumes` | `subdomains/core/buy-crypto/routes/swap/swap.service.ts` |
| 1st day of month at midnight | — | `worker` | `UserDataService::resetMonthlyVolumes` | `subdomains/generic/user/models/user-data/user-data.service.ts` |
| 1st day of month at midnight | — | `worker` | `UserService::resetMonthlyVolumes` | `subdomains/generic/user/models/user/user.service.ts` |
| year | — | `worker` | `BuyService::resetAnnualVolumes` | `subdomains/core/buy-crypto/routes/buy/buy.service.ts` |
| year | — | `worker` | `SellService::resetAnnualVolumes` | `subdomains/core/sell-crypto/route/sell.service.ts` |
| year | — | `worker` | `SwapService::resetAnnualVolumes` | `subdomains/core/buy-crypto/routes/swap/swap.service.ts` |
| year | — | `worker` | `UserDataService::resetAnnualVolumes` | `subdomains/generic/user/models/user-data/user-data.service.ts` |
| year | — | `worker` | `UserService::resetAnnualVolumes` | `subdomains/generic/user/models/user/user.service.ts` |
