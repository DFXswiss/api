# Cron jobs

Every scheduled job this service runs: **132 `@DfxCron` declarations** across 92 files and 33 areas.

## Columns

| Column | Meaning |
| ------ | ------- |
| **Interval** | The `CronExpression` / `CustomCronExpression` the job is registered with |
| **Flag** | The `process:` kill switch that disables the job at runtime. `—` means the job has none and always runs |
| **Job** | Class and method |
| **File** | Path below `src/` |

## Flags

111 of the 132 jobs carry a `process` flag, 21 do not. A job with a flag can be switched off
without a deploy — `DfxCronService` skips it when the process appears in the disabled set, which
`ProcessService` refreshes from the `disabledProcesses` setting and the `DISABLED_PROCESSES`
environment variable every 30 seconds.

A job **without** a flag runs unconditionally. That is deliberate for three of them — the
`ProcessService::resync*` jobs maintain the disabled set and the JWT denylists themselves, so
making them switchable would let a configuration change disable the mechanism that reads
configuration changes. For the remaining 18 it is simply an omission:

| Job | Interval |
| --- | --- |
| `DexService::finalizePurchaseOrders` | 30 seconds |
| `ExchangeController::checkTrades` | 30 seconds |
| `AuthService::checkLists` | minute |
| `JwtRevocationSyncService::syncDeniedJwtAccounts` | minute |
| `TransactionController::checkLists` | minute |
| `UserDataService::processCleanupMailSecretCache` | minute |
| `TransactionHelper::updateCache` | 5 minutes |
| `RefService::checkRefs` | hour |
| `BuyService` / `SellService` / `SwapService` / `UserService` / `UserDataService` `::resetMonthlyVolumes` | 1st of month |
| `BuyService` / `SellService` / `SwapService` / `UserService` / `UserDataService` `::resetAnnualVolumes` | year |

New jobs should declare a flag unless there is a reason like the one above.

## Distribution

| Interval | Jobs |
| -------- | ---: |
| second | 5 |
| 10 seconds | 3 |
| 30 seconds | 8 |
| minute | 50 |
| 5 minutes | 17 |
| 10 minutes | 15 |
| hour | 16 |
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
| `subdomains/generic/user` | 15 | 7 |
| `subdomains/core/monitoring` | 14 | — |
| `subdomains/core/accounting` | 13 | — |
| `subdomains/supporting/payin` | 12 | — |
| `integration/blockchain` | 6 | — |
| `subdomains/core/buy-crypto` | 6 | 4 |
| `subdomains/core/sell-crypto` | 5 | 2 |
| `subdomains/core/payment-link` | 4 | — |
| `subdomains/generic/kyc` | 4 | — |
| `subdomains/supporting/bank-tx` | 4 | — |
| `subdomains/supporting/bank` | 4 | — |
| `subdomains/supporting/fiat-output` | 4 | — |
| `subdomains/supporting/support-issue` | 4 | — |
| `shared` | 3 | 3 |
| `subdomains/core/liquidity-management` | 3 | — |
| `subdomains/core/referral` | 3 | 1 |
| `subdomains/core/trading` | 3 | — |
| `subdomains/supporting/payment` | 3 | 1 |
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
| `subdomains/supporting/dex` | 1 | 1 |
| `subdomains/supporting/fiat-payin` | 1 | — |
| `subdomains/supporting/notification` | 1 | — |
| `subdomains/supporting/payout` | 2 | — |

## How this list is produced

Every `@DfxCron(` occurrence in `src/**/*.ts`. Decorator arguments are read by a balanced-paren
scan, so multi-line declarations are included — a line-based match misses four of them. The parsed
count is asserted against a raw text count of the decorator: **132 = 132**, no gap. Class and
method come from the enclosing `export class` (including `export abstract class`) and the
identifier following the decorator.

## Known discrepancy

`CitreaBaseStrategy::checkPayInEntries` is declared on an **abstract** class. NestJS discovers
providers rather than classes, so such a job is registered once per concrete subclass, not once per
declaration. There is currently one subclass, so the runtime count equals the declaration count —
but a second subclass would silently add another registration of the same job, sharing the flag and
the interval while running as an independent timer with its own lock.

## Jobs

| Interval | Flag | Job | File |
| -------- | ---- | --- | ---- |
| second | `PAY_IN` | `BitcoinStrategy::checkPayInEntries` | `subdomains/supporting/payin/strategies/register/impl/bitcoin.strategy.ts` |
| second | `PAY_IN` | `FiroStrategy::checkPayInEntries` | `subdomains/supporting/payin/strategies/register/impl/firo.strategy.ts` |
| second | `PAY_IN` | `MoneroStrategy::checkPayInEntries` | `subdomains/supporting/payin/strategies/register/impl/monero.strategy.ts` |
| second | `MONITOR_CONNECTION_POOL` | `MonitorConnectionPoolService::monitorConnectionPool` | `subdomains/core/monitoring/monitor-connection-pool.service.ts` |
| second | `PAY_IN` | `ZanoStrategy::checkPayInEntries` | `subdomains/supporting/payin/strategies/register/impl/zano.strategy.ts` |
| 10 seconds | `LIQUIDITY_MANAGEMENT` | `LiquidityManagementPipelineService::processPipelines` | `subdomains/core/liquidity-management/services/liquidity-management-pipeline.service.ts` |
| 10 seconds | `MONITOR_CONNECTION_POOL` | `MonitorConnectionPoolService::monitorConnectionPoolStatic` | `subdomains/core/monitoring/monitor-connection-pool.service.ts` |
| 10 seconds | `MONITOR_EVENT_LOOP` | `MonitorEventLoopService::monitorEventLoop` | `subdomains/core/monitoring/monitor-event-loop.service.ts` |
| 30 seconds | `LNURL_AUTH_CACHE` | `AuthLnUrlService::processCleanupAccessToken` | `subdomains/generic/user/models/auth/auth-lnurl.service.ts` |
| 30 seconds | `BANK_TX` | `BankTxService::checkBankTx` | `subdomains/supporting/bank-tx/bank-tx/services/bank-tx.service.ts` |
| 30 seconds | — | `DexService::finalizePurchaseOrders` | `subdomains/supporting/dex/services/dex.service.ts` |
| 30 seconds | — | `ExchangeController::checkTrades` | `integration/exchange/controllers/exchange.controller.ts` |
| 30 seconds | `PAY_OUT` | `PayoutService::processOrders` | `subdomains/supporting/payout/services/payout.service.ts` |
| 30 seconds | — | `ProcessService::resyncDeniedJwtAccounts` | `shared/services/process.service.ts` |
| 30 seconds | — | `ProcessService::resyncDeniedJwtAddresses` | `shared/services/process.service.ts` |
| 30 seconds | — | `ProcessService::resyncDisabledProcesses` | `shared/services/process.service.ts` |
| minute | `PAY_OUT` | `AdminService::completeLiquidityOrders` | `subdomains/generic/admin/admin.service.ts` |
| minute | `MONITORING` | `AmlObserver::fetch` | `subdomains/core/monitoring/observers/aml.observer.ts` |
| minute | — | `AuthService::checkLists` | `subdomains/generic/user/models/auth/auth.service.ts` |
| minute | `BANK_DATA_VERIFICATION` | `BankDataService::checkAndSetActive` | `subdomains/generic/user/models/bank-data/bank-data.service.ts` |
| minute | `MONITORING` | `BankObserver::fetch` | `subdomains/core/monitoring/observers/bank.observer.ts` |
| minute | `BANK_TX_RETURN_MAIL` | `BankTxReturnNotificationService::sendBankTxReturnMail` | `subdomains/supporting/bank-tx/bank-tx-return/bank-tx-return-notification.service.ts` |
| minute | `BUY_CRYPTO` | `BuyCryptoJobService::process` | `subdomains/core/buy-crypto/process/services/buy-crypto-job.service.ts` |
| minute | `BUY_FIAT` | `BuyFiatJobService::addFiatOutputs` | `subdomains/core/sell-crypto/process/services/buy-fiat-job.service.ts` |
| minute | `BUY_FIAT` | `BuyFiatJobService::checkCryptoPayIn` | `subdomains/core/sell-crypto/process/services/buy-fiat-job.service.ts` |
| minute | `BUY_FIAT_MAIL` | `BuyFiatNotificationService::sendNotificationMails` | `subdomains/core/sell-crypto/process/services/buy-fiat-notification.service.ts` |
| minute | `PAY_IN` | `CardanoStrategy::checkPayInEntries` | `subdomains/supporting/payin/strategies/register/impl/cardano.strategy.ts` |
| minute | `MONITORING` | `CheckoutObserver::fetch` | `subdomains/core/monitoring/observers/checkout.observer.ts` |
| minute | `PAY_IN` | `CitreaBaseStrategy::checkPayInEntries` | `subdomains/supporting/payin/strategies/register/impl/base/citrea.strategy.ts` |
| minute | `CUSTODY` | `CustodyJobService::handleOrders` | `subdomains/core/custody/services/custody-job.service.ts` |
| minute | `FIAT_OUTPUT` | `FiatOutputJobService::fillFiatOutput` | `subdomains/supporting/fiat-output/fiat-output-job.service.ts` |
| minute | `FIAT_PAY_IN` | `FiatPayInSyncService::syncCheckout` | `subdomains/supporting/fiat-payin/services/fiat-payin-sync.service.ts` |
| minute | `PAY_IN` | `InternetComputerStrategy::checkPayInEntries` | `subdomains/supporting/payin/strategies/register/impl/icp.strategy.ts` |
| minute | — | `JwtRevocationSyncService::syncDeniedJwtAccounts` | `subdomains/generic/user/models/user-data/jwt-revocation-sync.service.ts` |
| minute | `KYC` | `KycService::reviewKycSteps` | `subdomains/generic/kyc/services/kyc.service.ts` |
| minute | `LEDGER_BOOKING_BANK_TX` | `LedgerBookingJobService::runBankTx` | `subdomains/core/accounting/services/ledger-booking-job.service.ts` |
| minute | `LEDGER_BOOKING_BUY_CRYPTO` | `LedgerBookingJobService::runBuyCrypto` | `subdomains/core/accounting/services/ledger-booking-job.service.ts` |
| minute | `LEDGER_BOOKING_BUY_FIAT` | `LedgerBookingJobService::runBuyFiat` | `subdomains/core/accounting/services/ledger-booking-job.service.ts` |
| minute | `LEDGER_BOOKING_CRYPTO_INPUT` | `LedgerBookingJobService::runCryptoInput` | `subdomains/core/accounting/services/ledger-booking-job.service.ts` |
| minute | `LEDGER_BOOKING_EXCHANGE_TX` | `LedgerBookingJobService::runExchangeTx` | `subdomains/core/accounting/services/ledger-booking-job.service.ts` |
| minute | `LEDGER_BOOKING_LIQUIDITY_MANAGEMENT` | `LedgerBookingJobService::runLiquidityMgmt` | `subdomains/core/accounting/services/ledger-booking-job.service.ts` |
| minute | `LEDGER_BOOKING_LIQUIDITY_ORDER` | `LedgerBookingJobService::runLiquidityOrderDex` | `subdomains/core/accounting/services/ledger-booking-job.service.ts` |
| minute | `LEDGER_BOOKING_PAYOUT` | `LedgerBookingJobService::runPayoutOrder` | `subdomains/core/accounting/services/ledger-booking-job.service.ts` |
| minute | `LEDGER_BOOKING_TRADING_ORDER` | `LedgerBookingJobService::runTradingOrder` | `subdomains/core/accounting/services/ledger-booking-job.service.ts` |
| minute | `LIQUIDITY_MANAGEMENT_CHECK_BALANCES` | `LiquidityManagementService::checkLiquidityBalances` | `subdomains/core/liquidity-management/services/liquidity-management.service.ts` |
| minute | `MONITORING` | `LiquidityObserver::fetch` | `subdomains/core/monitoring/observers/liquidity.observer.ts` |
| minute | `TRADING_LOG` | `LogJobService::saveTradingLog` | `subdomains/supporting/log/log-job.service.ts` |
| minute | `MONITORING` | `NodeHealthObserver::fetch` | `subdomains/core/monitoring/observers/node-health.observer.ts` |
| minute | `ORGANIZATION_SYNC` | `OrganizationService::syncOrganization` | `subdomains/generic/user/models/organization/organization.service.ts` |
| minute | `PAY_IN` | `PayInService::checkConfirmations` | `subdomains/supporting/payin/services/payin.service.ts` |
| minute | `PAY_IN` | `PayInService::forwardPayInEntries` | `subdomains/supporting/payin/services/payin.service.ts` |
| minute | `PAY_IN` | `PayInService::returnPayInEntries` | `subdomains/supporting/payin/services/payin.service.ts` |
| minute | `PAYMENT_CONFIRMATIONS` | `PaymentCronService::checkTxConfirmations` | `subdomains/core/payment-link/services/payment-cron.service.ts` |
| minute | `PAYMENT_EXPIRATION` | `PaymentCronService::processExpiredPayments` | `subdomains/core/payment-link/services/payment-cron.service.ts` |
| minute | `UPDATE_BLOCKCHAIN_FEE` | `PaymentLinkFeeService::updateFees` | `subdomains/core/payment-link/services/payment-link-fee.service.ts` |
| minute | `MONITORING` | `PayoutService::logUncertainOrdersSnapshot` | `subdomains/supporting/payout/services/payout.service.ts` |
| minute | `REALUNIT_QUOTE_COMPLETION` | `RealUnitJobService::completeSettledQuotes` | `subdomains/supporting/realunit/realunit-job.service.ts` |
| minute | `SUPPORT_BOT` | `SupportIssueJobService::sendAutoResponses` | `subdomains/supporting/support-issue/services/support-issue-job.service.ts` |
| minute | `TFA_CACHE` | `TfaService::processCleanupSecretCache` | `subdomains/generic/kyc/services/tfa.service.ts` |
| minute | `TRADING` | `TradingJobService::processOrders` | `subdomains/core/trading/services/trading-job.service.ts` |
| minute | `TRADING` | `TradingJobService::processRules` | `subdomains/core/trading/services/trading-job.service.ts` |
| minute | — | `TransactionController::checkLists` | `subdomains/core/history/controllers/transaction.controller.ts` |
| minute | `TX_MAIL` | `TransactionNotificationService::sendNotificationMails` | `subdomains/supporting/payment/services/transaction-notification.service.ts` |
| minute | `USER_DATA` | `UserDataJobService::fillUserData` | `subdomains/generic/user/models/user-data/user-data-job.service.ts` |
| minute | — | `UserDataService::processCleanupMailSecretCache` | `subdomains/generic/user/models/user-data/user-data.service.ts` |
| minute | `USER` | `UserJobService::fillUser` | `subdomains/generic/user/models/user/user-job.service.ts` |
| 5 minutes | `PRICING` | `AssetPricesJobService::updatePaymentPrices` | `subdomains/supporting/pricing/services/asset-prices-job.service.ts` |
| 5 minutes | `LNURL_AUTH_CACHE` | `AuthLnUrlService::processCleanupAuthCache` | `subdomains/generic/user/models/auth/auth-lnurl.service.ts` |
| 5 minutes | `BANK_TX_RETURN` | `BankTxReturnService::fillBankTxReturn` | `subdomains/supporting/bank-tx/bank-tx-return/bank-tx-return.service.ts` |
| 5 minutes | `BANK_TX` | `BankTxService::enrichYapealTransactions` | `subdomains/supporting/bank-tx/bank-tx/services/bank-tx.service.ts` |
| 5 minutes | `BLOCKCHAIN_CONFIG_CHECK` | `BlockchainConfigCheckService::logUnconfiguredClients` | `integration/blockchain/shared/services/blockchain-config-check.service.ts` |
| 5 minutes | `EXCHANGE_TX_SYNC` | `ExchangeTxService::syncExchangeJob` | `integration/exchange/services/exchange-tx.service.ts` |
| 5 minutes | `CRYPTO_PAYOUT` | `FaucetRequestService::checkFaucetRequests` | `subdomains/core/faucet-request/services/faucet-request.service.ts` |
| 5 minutes | `LEDGER_COA_BOOTSTRAP` | `LedgerBookingJobService::runCoaBootstrap` | `subdomains/core/accounting/services/ledger-booking-job.service.ts` |
| 5 minutes | `LEDGER_CUTOVER` | `LedgerCutoverService::run` | `subdomains/core/accounting/services/ledger-cutover.service.ts` |
| 5 minutes | `LIMIT_REQUEST_MAIL` | `LimitRequestNotificationService::sendNotificationMails` | `subdomains/supporting/support-issue/services/limit-request-notification.service.ts` |
| 5 minutes | `LIQUIDITY_MANAGEMENT` | `LiquidityManagementRuleService::reactivateRules` | `subdomains/core/liquidity-management/services/liquidity-management-rule.service.ts` |
| 5 minutes | `PAY_IN_MAIL` | `PayInNotificationService::sendNotificationMails` | `subdomains/supporting/payin/services/payin-notification.service.ts` |
| 5 minutes | `REALUNIT_TRANSFER_RECONCILIATION` | `RealUnitJobService::reconcilePendingTransfers` | `subdomains/supporting/realunit/realunit-job.service.ts` |
| 5 minutes | `SUPPORT_BOT` | `SupportEscalationService::checkEscalations` | `subdomains/supporting/support-issue/services/support-escalation.service.ts` |
| 5 minutes | `TRADING` | `TradingJobService::reactivateRules` | `subdomains/core/trading/services/trading-job.service.ts` |
| 5 minutes | — | `TransactionHelper::updateCache` | `subdomains/supporting/payment/services/transaction-helper.ts` |
| 5 minutes | `WEBHOOK` | `WebhookNotificationService::sendWebhooks` | `subdomains/generic/user/services/webhook/webhook-notification.service.ts` |
| 10 minutes | `BANK_ACCOUNT` | `BankAccountService::reloadUncheckedBankAccounts` | `subdomains/supporting/bank/bank-account/bank-account.service.ts` |
| 10 minutes | `DEURO_LOG_INFO` | `DEuroService::processLogInfo` | `integration/blockchain/deuro/deuro.service.ts` |
| 10 minutes | `MONITORING` | `ExchangeObserver::fetch` | `subdomains/core/monitoring/observers/exchange.observer.ts` |
| 10 minutes | `MONITORING` | `ExternalServicesObserver::fetch` | `subdomains/core/monitoring/observers/external-services.observer.ts` |
| 10 minutes | `BLOCKCHAIN_FEE_UPDATE` | `FeeService::updateBlockchainFees` | `subdomains/supporting/payment/services/fee.service.ts` |
| 10 minutes | `FRANKENCOIN_LOG_INFO` | `FrankencoinService::processLogInfo` | `integration/blockchain/frankencoin/frankencoin.service.ts` |
| 10 minutes | `JUICE_LOG_INFO` | `JuiceService::processLogInfo` | `integration/blockchain/juice/juice.service.ts` |
| 10 minutes | `MONITORING` | `NodeBalanceObserver::fetch` | `subdomains/core/monitoring/observers/node-balance.observer.ts` |
| 10 minutes | `MAIL_RETRY` | `NotificationJobService::resendUncompletedMails` | `subdomains/supporting/notification/services/notification-job.service.ts` |
| 10 minutes | `PAY_IN` | `PayInService::updateFailedPayments` | `subdomains/supporting/payin/services/payin.service.ts` |
| 10 minutes | `MONITORING` | `PaymentObserver::fetch` | `subdomains/core/monitoring/observers/payment.observer.ts` |
| 10 minutes | `MONITORING` | `RealUnitW2wGasObserver::fetch` | `subdomains/core/monitoring/observers/realunit-w2w-gas.observer.ts` |
| 10 minutes | `REF_PAYOUT` | `RefRewardJobService::processPendingRefRewards` | `subdomains/core/referral/reward/services/ref-reward-job.service.ts` |
| 10 minutes | `MONITORING` | `UserObserver::fetch` | `subdomains/core/monitoring/observers/user.observer.ts` |
| 10 minutes | `ZANO_ASSET_WHITELIST` | `ZanoService::setupAssetWhitelist` | `integration/blockchain/zano/services/zano.service.ts` |
| hour | `PRICING` | `AssetPricesJobService::updatePrices` | `subdomains/supporting/pricing/services/asset-prices-job.service.ts` |
| hour | `BANK_ACCOUNT` | `BankAccountService::reloadErrorBankAccounts` | `subdomains/supporting/bank/bank-account/bank-account.service.ts` |
| hour | `BINANCE_PAY_CERTIFICATES_UPDATE` | `BinancePayService::updateCertificates` | `integration/binance-pay/services/binance-pay.service.ts` |
| hour | `BUY_CRYPTO_AGGREGATION` | `BuyCryptoJobService::checkAggregatingTransactions` | `subdomains/core/buy-crypto/process/services/buy-crypto-job.service.ts` |
| hour | `ASSET_DECIMALS` | `EvmDecimalsService::setDecimals` | `integration/blockchain/shared/evm/evm-decimals.service.ts` |
| hour | `FIAT_OUTPUT` | `FiatOutputFrickService::checkFrickOrderStatus` | `subdomains/supporting/fiat-output/fiat-output-frick.service.ts` |
| hour | `FIAT_OUTPUT` | `FiatOutputJobService::checkOlkypayOrderStatus` | `subdomains/supporting/fiat-output/fiat-output-job.service.ts` |
| hour | `FIAT_OUTPUT` | `FiatOutputJobService::generateReports` | `subdomains/supporting/fiat-output/fiat-output-job.service.ts` |
| hour | `PRICING` | `FiatPricesService::updatePrices` | `subdomains/supporting/pricing/services/fiat-prices.service.ts` |
| hour | `KYC_MAIL` | `KycNotificationService::sendNotificationMails` | `subdomains/generic/kyc/services/kyc-notification.service.ts` |
| hour | `PAYMENT_FORWARDING` | `PaymentCronService::forwardDeposits` | `subdomains/core/payment-link/services/payment-cron.service.ts` |
| hour | — | `RefService::checkRefs` | `subdomains/core/referral/process/ref.service.ts` |
| hour | `UPDATE_STATISTIC` | `StatisticService::doUpdate` | `subdomains/core/statistic/statistic.service.ts` |
| hour | `SUPPORT_BOT` | `SupportIssueJobService::autoOnHold` | `subdomains/supporting/support-issue/services/support-issue-job.service.ts` |
| hour | `BLACK_SQUAD_MAIL` | `UserDataNotificationService::sendNotificationMails` | `subdomains/generic/user/models/user-data/user-data-notification.service.ts` |
| hour | `VIRTUAL_IBAN_FRICK_ISSUANCE_RECONCILIATION` | `VirtualIbanFrickIssuanceReconciliationService::reconcileRetiredIssuanceReferences` | `subdomains/supporting/bank/virtual-iban/virtual-iban-frick-issuance-reconciliation.service.ts` |
| day at 4am | `CUSTODY` | `CustodyJobService::resetExpiredConfirmedOrders` | `subdomains/core/custody/services/custody-job.service.ts` |
| day at 4am | `KYC` | `KycService::checkIdentSteps` | `subdomains/generic/kyc/services/kyc.service.ts` |
| day at 4am | `LEDGER_MARK_TO_MARKET` | `LedgerMarkToMarketService::run` | `subdomains/core/accounting/services/ledger-mark-to-market.service.ts` |
| day at 5am | `LEDGER_RECONCILIATION` | `LedgerReconciliationService::run` | `subdomains/core/accounting/services/ledger-reconciliation.service.ts` |
| day at 6am | `REF_PAYOUT` | `RefRewardJobService::createPendingRefRewards` | `subdomains/core/referral/reward/services/ref-reward-job.service.ts` |
| day at 11pm | `LOG_CLEANUP` | `LogService::cleanup` | `subdomains/supporting/log/log.service.ts` |
| week | `BANK_ACCOUNT` | `BankAccountService::checkFailedBankAccounts` | `subdomains/supporting/bank/bank-account/bank-account.service.ts` |
| weekend | `SANCTION_SYNC` | `SanctionService::syncList` | `subdomains/core/aml/services/sanction.service.ts` |
| 1st day of month at midnight | — | `BuyService::resetMonthlyVolumes` | `subdomains/core/buy-crypto/routes/buy/buy.service.ts` |
| 1st day of month at midnight | — | `SellService::resetMonthlyVolumes` | `subdomains/core/sell-crypto/route/sell.service.ts` |
| 1st day of month at midnight | — | `SwapService::resetMonthlyVolumes` | `subdomains/core/buy-crypto/routes/swap/swap.service.ts` |
| 1st day of month at midnight | — | `UserDataService::resetMonthlyVolumes` | `subdomains/generic/user/models/user-data/user-data.service.ts` |
| 1st day of month at midnight | — | `UserService::resetMonthlyVolumes` | `subdomains/generic/user/models/user/user.service.ts` |
| year | — | `BuyService::resetAnnualVolumes` | `subdomains/core/buy-crypto/routes/buy/buy.service.ts` |
| year | — | `SellService::resetAnnualVolumes` | `subdomains/core/sell-crypto/route/sell.service.ts` |
| year | — | `SwapService::resetAnnualVolumes` | `subdomains/core/buy-crypto/routes/swap/swap.service.ts` |
| year | — | `UserDataService::resetAnnualVolumes` | `subdomains/generic/user/models/user-data/user-data.service.ts` |
| year | — | `UserService::resetAnnualVolumes` | `subdomains/generic/user/models/user/user.service.ts` |
