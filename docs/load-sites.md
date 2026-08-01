# Database load sites

Every place in the code that reads from the database: **1105 load sites** across 249 files.

This is the level at which the statement is unambiguous. An endpoint reaches several load sites — a permission check, a lookup, the actual query — so asking whether *an endpoint* loads efficiently has no single answer. Asking it of a load site does. [endpoints.md](endpoints.md) carries the per-endpoint summary derived from these sites.

## What the mechanism means

| Mechanism | Sites | Eager relations | Columns selected |
| --------- | ----: | --------------- | ---------------- |
| `find` family | 957 | **applied** — expanded recursively | all columns of the entity plus every eager relation |
| `createQueryBuilder` | 143 | not applied | all columns of the root entity, unless `.select([...])` narrows it |
| raw SQL | 5 | not applied | whatever the statement lists |

Statements that load nothing are excluded from the count: 2 `createQueryBuilder` calls carrying `.update()`, 6 advisory locks (`SELECT pg_advisory_xact_lock(...)`, which return no rows) and 1 raw `INSERT`. Each of the 5 raw reads that remain names its columns.

Among the query builders, the field list is what decides whether anything is actually saved:

| | Sites |
| --- | ---: |
| `.select([...])` or `PROJECTION.apply(...)` — an explicit field list | **18** |
| `.select('alias.column')` — names columns one by one | **90** |
| `.select('alias')` — selects the root alias, **loads every column** | 17 |
| no `select` at all — loads every column | 14 |
| `getCount()` or `getExists()` — the select list is discarded, **no row is materialised** | 3 |
| projects, but a `leftJoinAndSelect` loads a relation whole | 1 |

`.select('alias')` is the trap: it reads like a projection but the argument is the entity alias, not a field list. Such a query still loads every column of the root entity — it merely avoids the eager relations. `.select('alias.column')` is the opposite case and easy to lump in with it: it names a column and does narrow the query. The distinction is the presence of a dot in the argument, and it matters — the sites that name columns this way select 2 columns at the median, against 957 `find` calls that select every one. Most of them are counts, maxima and id lookups rather than response payloads, which is why the endpoint summary still reads the way it does.

## Measurements

Columns were measured against the real entity metadata by building the query and counting its SELECT list — 790 of 1105 sites.

- **338 are exact**: the `relations` tree is written at the call site.
- **452 are lower bounds**: the tree arrives as a parameter, so only the base query is visible here. `transaction.service.ts` is the clearest case — its callers pass trees reaching well over a thousand columns.
- 315 could not be measured: no resolvable target entity, or raw SQL.

Median across measured sites: **101 columns**. 14 sites exceed 1000, 71 exceed 500, 390 exceed 100.

Postgres refuses a statement with more than 1664 columns, so a query near that number is one added column away from failing outright.

## Load sites

Sorted by measured columns, largest first. `—` means not measurable, not zero.

| Columns | Joins | Mechanism | Entity | Location | Method |
| ------: | ----: | --------- | ------ | -------- | ------ |
| 1453 | 49 | find | `FiatOutput` | `subdomains/supporting/fiat-output/fiat-output-job.service.ts:229` | `FiatOutputJobService.setReadyDate` |
| 1359 | 46 | find | `Transaction` | `subdomains/supporting/payment/services/transaction.service.ts:267` | `TransactionService.getTransactionsForAccount` |
| 1282 | 50 | find | `BuyCrypto` | `subdomains/core/buy-crypto/process/services/buy-crypto-preparation.service.ts:426` | `BuyCryptoPreparationService.fillPaymentLinkPayments` |
| 1231 | 38 | find | `FiatOutput` | `subdomains/supporting/fiat-output/fiat-output-job.service.ts:174` | `FiatOutputJobService.assignBankAccount` |
| 1158 | 43 | find | `BuyCrypto` | `subdomains/core/buy-crypto/process/services/buy-crypto-batch.service.ts:65` | `BuyCryptoBatchService.batchAndOptimizeTransactions` |
| 1135 | 40 | find | `BuyCrypto` | `subdomains/core/buy-crypto/process/services/buy-crypto-preparation.service.ts:317` | `BuyCryptoPreparationService.In` |
| 1088 | 40 | find | `Transaction` | `subdomains/supporting/payment/services/transaction.service.ts:299` | `TransactionService.getTransactionsForUsers` |
| 1086 | 39 | find | `BuyCrypto` | `subdomains/core/buy-crypto/process/services/buy-crypto.service.ts:274` | `BuyCryptoService.update` |
| 1059 | 41 | find | `BuyCrypto` | `subdomains/core/buy-crypto/process/services/buy-crypto-preparation.service.ts:119` | `BuyCryptoPreparationService.doAmlCheck` |
| 1051 | 36 | find | `BuyCrypto` | `subdomains/core/buy-crypto/process/services/buy-crypto.service.ts:513` | `BuyCryptoService.refundBuyCrypto` |
| 1051 | 32 | find | `BankTx` | `subdomains/supporting/bank-tx/bank-tx/services/bank-tx.service.ts:328` | `BankTxService.create` |
| 1051 | 32 | find | `BankTx` | `subdomains/supporting/bank-tx/bank-tx/services/bank-tx.service.ts:341` | `BankTxService.update` |
| 1033 | 40 | find | `BuyFiat` | `subdomains/core/sell-crypto/process/services/buy-fiat.service.ts:180` | `BuyFiatService.update` |
| 1003 | 36 | find | `BuyFiat` | `subdomains/core/sell-crypto/process/services/buy-fiat-preparation.service.ts:534` | `BuyFiatPreparationService.addFiatOutputs` |
| 903 | 30 | find | `BuyCrypto` | `subdomains/core/buy-crypto/process/services/buy-crypto.service.ts:1165` | `BuyCryptoService.getAllUserTransactions` |
| 891 | 37 | find | `BuyFiat` | `subdomains/core/sell-crypto/process/services/buy-fiat-preparation.service.ts:340` | `BuyFiatPreparationService.fillPaymentLinkPayments` |
| 881 | 32 | find | `BuyCryptoBatch` | `subdomains/core/buy-crypto/process/services/buy-crypto-out.service.ts:133` | `BuyCryptoOutService.fetchBatchesForPayout` |
| 880 | 26 | find | `BuyCrypto` | `subdomains/core/buy-crypto/process/services/buy-crypto-preparation.service.ts:626` | `BuyCryptoPreparationService.chargebackFillUp` |
| 844 | 26 | find | `BuyCrypto` | `subdomains/core/buy-crypto/process/services/buy-crypto-webhook.service.ts:17` | `BuyCryptoWebhookService.triggerWebhookManual` |
| 826 | 27 | find | `Transaction` | `subdomains/supporting/payment/services/transaction.service.ts:189` | `TransactionService.getTransactionsWithoutUid` |
| 826 | 27 | find | `Transaction` | `subdomains/supporting/payment/services/transaction.service.ts:198` | `TransactionService.getTransactionsByUserDataId` |
| 811 | 27 | find | `BuyCrypto` | `subdomains/core/buy-crypto/process/services/buy-crypto.service.ts:922` | `BuyCryptoService.getRefTransactions` |
| 811 | 27 | find | `BuyCrypto` | `subdomains/core/buy-crypto/process/services/buy-crypto.service.ts:1147` | `BuyCryptoService.getAllRefTransactions` |
| 813 | 29 | find | `BuyFiat` | `subdomains/core/sell-crypto/process/services/buy-fiat-preparation.service.ts:255` | `BuyFiatPreparationService.refreshFee` |
| 803 | 29 | find | `BuyFiat` | `subdomains/core/sell-crypto/process/services/buy-fiat.service.ts:400` | `BuyFiatService.refundBuyFiat` |
| 790 | 26 | find | `Transaction` | `subdomains/supporting/payment/services/transaction-notification.service.ts:37` | `TransactionNotificationService.txAssigned` |
| 785 | 24 | find | `BuyCrypto` | `subdomains/core/buy-crypto/process/services/buy-crypto-notification.service.ts:267` | `BuyCryptoNotificationService.chargebackInitiated` |
| 765 | 23 | find | `BuyCrypto` | `subdomains/core/buy-crypto/process/services/buy-crypto-preparation.service.ts:588` | `BuyCryptoPreparationService.chargebackTx` |
| 737 | 30 | find | `BuyFiat` | `subdomains/core/sell-crypto/process/services/buy-fiat-preparation.service.ts:107` | `BuyFiatPreparationService.doAmlCheck` |
| 727 | 23 | find | `BankTxReturn` | `subdomains/supporting/bank-tx/bank-tx-return/bank-tx-return.service.ts:176` | `BankTxReturnService.refundBankTxReturn` |
| 713 | 26 | find | `BuyCrypto` | `subdomains/core/buy-crypto/process/services/buy-crypto.service.ts:788` | `BuyCryptoService.retriggerScorechain` |
| 703 | 24 | find | `BuyFiat` | `subdomains/core/sell-crypto/process/services/buy-fiat-preparation.service.ts:491` | `BuyFiatPreparationService.complete` |
| 668 | 22 | find | `BuyCrypto` | `subdomains/core/buy-crypto/process/services/buy-crypto.service.ts:1203` | `BuyCryptoService.getByAmlReason` |
| 644 | 22 | find | `BuyFiat` | `subdomains/core/sell-crypto/process/services/buy-fiat.service.ts:374` | `BuyFiatService.getBuyFiat` |
| 644 | 22 | find | `BuyFiat` | `subdomains/core/sell-crypto/process/services/buy-fiat.service.ts:378` | `BuyFiatService.triggerWebhookManual` |
| 643 | 21 | find | `Recommendation` | `subdomains/generic/user/models/recommendation/recommendation.service.ts:196` | `RecommendationService.confirmRecommendation` |
| 643 | 21 | find | `Recommendation` | `subdomains/generic/user/models/recommendation/recommendation.service.ts:255` | `RecommendationService.getAndCheckRecommendationByCode` |
| 643 | 21 | find | `Recommendation` | `subdomains/generic/user/models/recommendation/recommendation.service.ts:294` | `RecommendationService.checkAndConfirmRecommendInvitation` |
| 639 | 24 | find | `FiatOutput` | `subdomains/supporting/fiat-output/fiat-output-job.service.ts:108` | `FiatOutputJobService.generateReports` |
| 630 | 20 | find | `Recommendation` | `subdomains/generic/user/models/recommendation/recommendation.service.ts:284` | `RecommendationService.getUserDataRecommendation` |
| 623 | 20 | find | `BuyFiat` | `subdomains/core/sell-crypto/process/services/buy-fiat.service.ts:619` | `BuyFiatService.getAllUserTransactions` |
| 613 | 19 | find | `BuyCrypto` | `subdomains/core/buy-crypto/process/services/buy-crypto-notification.service.ts:82` | `BuyCryptoNotificationService.paymentCompleted` |
| 613 | 19 | find | `BuyCrypto` | `subdomains/core/buy-crypto/process/services/buy-crypto-notification.service.ts:175` | `BuyCryptoNotificationService.pendingBuyCrypto` |
| 613 | 19 | find | `BuyCrypto` | `subdomains/core/buy-crypto/process/services/buy-crypto-notification.service.ts:350` | `BuyCryptoNotificationService.chargebackUnconfirmed` |
| 597 | 21 | find | `BuyFiat` | `subdomains/core/sell-crypto/process/services/buy-fiat-preparation.service.ts:432` | `BuyFiatPreparationService.setOutput` |
| 593 | 18 | find | `BuyCrypto` | `subdomains/core/buy-crypto/process/services/buy-crypto.service.ts:738` | `BuyCryptoService.getBuyCryptosByChargebackIban` |
| 583 | 21 | find | `BuyFiat` | `subdomains/core/sell-crypto/process/services/buy-fiat-notification.service.ts:209` | `BuyFiatNotificationService.chargebackInitiated` |
| 583 | 21 | find | `BuyFiat` | `subdomains/core/sell-crypto/process/services/buy-fiat-registration.service.ts:35` | `BuyFiatRegistrationService.syncReturnTxId` |
| 567 | 17 | find | `BuyCrypto` | `subdomains/core/accounting/services/consumers/buy-crypto.consumer.ts:114` | `BuyCryptoConsumer.processForward` |
| 558 | 24 | find | `PaymentQuote` | `subdomains/core/payment-link/services/payment-quote.service.ts:150` | `PaymentQuoteService.getConfirmingQuotes` |
| 545 | 23 | find | `PaymentLink` | `subdomains/core/payment-link/repositories/payment-link.repository.ts:99` | `PaymentLinkRepository.getHistoryByStatus` |
| 545 | 23 | find | `PaymentLinkPayment` | `subdomains/core/payment-link/services/payment-link-payment.service.ts:97` | `PaymentLinkPaymentService.updatePayment` |
| 545 | 23 | find | `PaymentLinkPayment` | `subdomains/core/payment-link/services/payment-link-payment.service.ts:104` | `PaymentLinkPaymentService.getPendingPaymentByUniqueId` |
| 545 | 23 | find | `PaymentLinkPayment` | `subdomains/core/payment-link/services/payment-link-payment.service.ts:372` | `PaymentLinkPaymentService.handleBlockchainConfirmed` |
| 545 | 23 | find | `PaymentLinkPayment` | `subdomains/core/payment-link/services/payment-link-payment.service.ts:449` | `PaymentLinkPaymentService.sendWebhook` |
| 540 | 17 | find | `BuyFiat` | `subdomains/core/sell-crypto/process/services/buy-fiat.service.ts:763` | `BuyFiatService.getByAmlReason` |
| 538 | 21 | find | `CryptoInput` | `subdomains/core/accounting/services/consumers/crypto-input.consumer.ts:89` | `CryptoInputConsumer.processForward` |
| 535 | 15 | find | `BuyCrypto` | `subdomains/core/buy-crypto/process/services/buy-crypto.service.ts:947` | `BuyCryptoService.getPendingTransactions` |
| 427 | 13 | find | `CustodyOrder` | `subdomains/core/custody/services/custody-order.service.ts:283` | `CustodyOrderService.confirmOrder` |
| 427 | 13 | find | `CustodyOrder` | `subdomains/core/custody/services/custody-order.service.ts:299` | `CustodyOrderService.getOrdersForSupport` |
| 517 | 16 | find | `BuyFiat` | `subdomains/core/sell-crypto/process/services/buy-fiat-preparation.service.ts:615` | `BuyFiatPreparationService.chargebackTx` |
| 517 | 16 | find | `BuyFiat` | `subdomains/core/sell-crypto/process/services/buy-fiat.service.ts:486` | `BuyFiatService.retriggerScorechain` |
| 513 | 21 | find | `PaymentLink` | `subdomains/core/payment-link/repositories/payment-link.repository.ts:72` | `PaymentLinkRepository.getAllPaymentLinks` |
| 513 | 21 | find | `PaymentLink` | `subdomains/core/payment-link/repositories/payment-link.repository.ts:79` | `PaymentLinkRepository.getAllPaymentLinksByExternalLinkId` |
| 513 | 21 | find | `PaymentLink` | `subdomains/core/payment-link/repositories/payment-link.repository.ts:86` | `PaymentLinkRepository.getAllPaymentLinksByExternalPaymentId` |
| 513 | 21 | find | `PaymentLink` | `subdomains/core/payment-link/repositories/payment-link.repository.ts:123` | `PaymentLinkRepository.getPaymentLinkByLinkId` |
| 513 | 21 | find | `PaymentLink` | `subdomains/core/payment-link/repositories/payment-link.repository.ts:130` | `PaymentLinkRepository.getPaymentLinkByExternalId` |
| 513 | 21 | find | `PaymentLink` | `subdomains/core/payment-link/repositories/payment-link.repository.ts:140` | `PaymentLinkRepository.getPaymentLinkByExternalPaymentId` |
| 513 | 21 | find | `PaymentLink` | `subdomains/core/payment-link/services/payment-link.service.ts:430` | `PaymentLinkService.updatePaymentLinkAdmin` |
| 513 | 21 | find | `PaymentLink` | `subdomains/core/payment-link/services/payment-link.service.ts:485` | `PaymentLinkService.getActivePaymentLink` |
| 513 | 21 | find | `PaymentLink` | `subdomains/core/payment-link/services/payment-link.service.ts:504` | `PaymentLinkService.assignPaymentLink` |
| 513 | 21 | find | `PaymentLink` | `subdomains/core/payment-link/services/payment-link.service.ts:520` | `PaymentLinkService.getLocations` |
| 507 | 18 | find | `KycStep` | `subdomains/generic/kyc/services/kyc.service.ts:358` | `KycService.reviewRecommendationStep` |
| 484 | 15 | find | `TransactionRequest` | `subdomains/supporting/payment/services/transaction-request.service.ts:218` | `TransactionRequestService.getOrThrow` |
| 499 | 14 | find | `BankTxReturn` | `subdomains/supporting/bank-tx/bank-tx-return/bank-tx-return.service.ts:169` | `BankTxReturnService.getPendingTx` |
| 497 | 18 | find | `BuyFiat` | `subdomains/core/sell-crypto/process/services/buy-fiat-notification.service.ts:128` | `BuyFiatNotificationService.pendingBuyFiat` |
| 497 | 15 | find | `BankTxReturn` | `subdomains/supporting/bank-tx/bank-tx-return/bank-tx-return.service.ts:86` | `BankTxReturnService.setFiatAmounts` |
| 493 | 19 | find | `SupportIssue` | `subdomains/supporting/support-issue/services/support-issue.service.ts:366` | `SupportIssueService.createIssueInternal` |
| 490 | 20 | find | `PaymentLink` | `subdomains/core/payment-link/services/payment-link.service.ts:587` | `PaymentLinkService.getPublicPaymentLinkByUniqueId` |
| 490 | 15 | find | `BuyFiat` | `subdomains/core/sell-crypto/process/services/buy-fiat.service.ts:473` | `BuyFiatService.resetAmlCheck` |
| 483 | 18 | find | `BuyCrypto` | `subdomains/core/buy-crypto/process/services/buy-crypto.service.ts:745` | `BuyCryptoService.getBuyCryptoByTransactionId` |
| 483 | 18 | find | `BuyCrypto` | `subdomains/core/buy-crypto/process/services/buy-crypto.service.ts:749` | `BuyCryptoService.getBuyCrypto` |
| 483 | 18 | find | `BuyCrypto` | `subdomains/core/buy-crypto/process/services/buy-crypto.service.ts:753` | `BuyCryptoService.updateVolumes` |
| 484 | 15 | find | `RefReward` | `subdomains/core/referral/reward/services/ref-reward-notification.service.ts:27` | `RefRewardNotificationService.refRewardPayouts` |
| 474 | 14 | find | `KycStep` | `subdomains/generic/kyc/services/kyc.service.ts:198` | `KycService.reviewIdentSteps` |
| 474 | 16 | find | `Recommendation` | `subdomains/generic/user/models/recommendation/recommendation.service.ts:274` | `RecommendationService.getAllRecommendationForUserData` |
| 474 | 16 | find | `Recommendation` | `subdomains/generic/user/models/recommendation/recommendation.service.ts:318` | `RecommendationService.getRecommendationsByKycStepIdsOrUserDataId` |
| 474 | 16 | find | `Recommendation` | `subdomains/generic/user/models/recommendation/recommendation.service.ts:326` | `RecommendationService.getRecommendationsByKycStepIdsOrUserDataId` |
| 474 | 16 | find | `Recommendation` | `subdomains/generic/user/models/recommendation/recommendation.service.ts:336` | `RecommendationService.getAllRecommendationsByRecommenderId` |
| 474 | 16 | find | `Recommendation` | `subdomains/generic/user/models/recommendation/recommendation.service.ts:344` | `RecommendationService.getRecommendationsByRecommendedId` |
| 473 | 18 | find | `SupportIssue` | `subdomains/supporting/support-issue/services/support-issue.service.ts:578` | `SupportIssueService.getIssueEntities` |
| 472 | 14 | find | `BuyFiat` | `subdomains/core/accounting/services/consumers/buy-fiat.consumer.ts:122` | `BuyFiatConsumer.processForward` |
| 472 | 19 | find | `DepositRoute` | `subdomains/supporting/address-pool/route/deposit-route.service.ts:15` | `DepositRouteService.get` |
| 472 | 19 | find | `DepositRoute` | `subdomains/supporting/address-pool/route/deposit-route.service.ts:25` | `DepositRouteService.getById` |
| 472 | 19 | find | `DepositRoute` | `subdomains/supporting/address-pool/route/deposit-route.service.ts:29` | `DepositRouteService.getLatest` |
| 472 | 19 | find | `DepositRoute` | `subdomains/supporting/address-pool/route/deposit-route.service.ts:75` | `DepositRouteService.getPaymentRoutesForPublicName` |
| 470 | 16 | find | `AccountMerge` | `subdomains/generic/user/models/account-merge/account-merge.service.ts:119` | `AccountMergeService.executeMerge` |
| 458 | 14 | find | `BankTxReturn` | `subdomains/supporting/bank-tx/bank-tx-return/bank-tx-return-notification.service.ts:27` | `BankTxReturnNotificationService.chargebackInitiated` |
| 454 | 16 | find | `LimitRequest` | `subdomains/supporting/support-issue/services/limit-request-notification.service.ts:31` | `LimitRequestNotificationService.limitRequestAcceptedManual` |
| 451 | 14 | find | `BuyFiat` | `subdomains/core/sell-crypto/process/services/buy-fiat-notification.service.ts:42` | `BuyFiatNotificationService.paymentCompleted` |
| 451 | 14 | find | `BuyFiat` | `subdomains/core/sell-crypto/process/services/buy-fiat-notification.service.ts:290` | `BuyFiatNotificationService.chargebackUnconfirmed` |
| 450 | 16 | find | `SupportIssue` | `subdomains/supporting/support-issue/services/support-issue.service.ts:457` | `SupportIssueService.closeIssue` |
| 450 | 16 | find | `SupportIssue` | `subdomains/supporting/support-issue/services/support-issue.service.ts:642` | `SupportIssueService.getUserIssues` |
| 449 | 13 | find | `BuyCrypto` | `subdomains/core/accounting/services/ledger-cutover.service.ts:475` | `LedgerCutoverService.openBuyCryptoReceived` |
| 449 | 13 | find | `BuyCrypto` | `subdomains/core/accounting/services/ledger-cutover.service.ts:536` | `LedgerCutoverService.openBuyCryptoOwed` |
| 449 | 13 | find | `BuyCrypto` | `subdomains/core/buy-crypto/process/services/buy-crypto-registration.service.ts:25` | `BuyCryptoRegistrationService.syncReturnTxId` |
| 444 | 16 | find | `SupportIssue` | `subdomains/supporting/support-issue/services/support-issue-job.service.ts:37` | `SupportIssueJobService.autoOnHold` |
| 444 | 16 | find | `SupportIssue` | `subdomains/supporting/support-issue/services/support-issue-job.service.ts:117` | `SupportIssueJobService.getAutoResponseIssues` |
| 441 | 15 | find | `SupportIssue` | `subdomains/supporting/support-issue/services/support-issue.service.ts:504` | `SupportIssueService.createMessage` |
| 441 | 15 | find | `SupportIssue` | `subdomains/supporting/support-issue/services/support-issue.service.ts:514` | `SupportIssueService.createMessageSupport` |
| 438 | 13 | find | `BankTxReturn` | `subdomains/core/accounting/services/consumers/bank-tx.consumer.ts:547` | `BankTxConsumer.openingBankTxId` |
| 438 | 13 | find | `BankTxReturn` | `subdomains/core/accounting/services/ledger-cutover.service.ts:610` | `LedgerCutoverService.openBankTxReturn` |
| 438 | 13 | find | `BankTxReturn` | `subdomains/supporting/bank-tx/bank-tx-return/bank-tx-return.service.ts:54` | `BankTxReturnService.chargebackTx` |
| 438 | 13 | find | `BankTxReturn` | `subdomains/supporting/bank-tx/bank-tx-return/bank-tx-return.service.ts:137` | `BankTxReturnService.update` |
| 434 | 15 | find | `LimitRequest` | `subdomains/supporting/support-issue/services/limit-request.service.ts:61` | `LimitRequestService.updateLimitRequest` |
| 434 | 15 | find | `LimitRequest` | `subdomains/supporting/support-issue/services/limit-request.service.ts:82` | `LimitRequestService.getUserLimitRequests` |
| 433 | 12 | find | `BankTx` | `subdomains/core/accounting/services/consumers/bank-tx.consumer.ts:106` | `BankTxConsumer.processForward` |
| 428 | 15 | find | `SupportMessage` | `subdomains/supporting/support-issue/services/support-issue.service.ts:478` | `SupportIssueService.closeIssue` |
| 428 | 15 | find | `SupportMessage` | `subdomains/supporting/support-issue/services/support-issue.service.ts:628` | `SupportIssueService.getIssueMessages` |
| 407 | 11 | find | `TransactionRequest` | `subdomains/supporting/payment/services/transaction-request.service.ts:67` | `TransactionRequestService.txRequestWaitingExpiryCheck` |
| 407 | 11 | find | `TransactionRequest` | `subdomains/supporting/payment/services/transaction-request.service.ts:78` | `TransactionRequestService.deleteOldTxRequests` |
| 422 | 12 | find | `BuyCrypto` | `subdomains/core/buy-crypto/process/services/buy-crypto.service.ts:778` | `BuyCryptoService.resetAmlCheck` |
| 421 | 14 | find | `SupportIssue` | `subdomains/supporting/support-issue/services/support-escalation.service.ts:214` | `SupportEscalationService.checkEscalations` |
| 421 | 14 | find | `SupportIssue` | `subdomains/supporting/support-issue/services/support-issue.service.ts:484` | `SupportIssueService.updateIssue` |
| 421 | 14 | find | `SupportIssue` | `subdomains/supporting/support-issue/services/support-issue.service.ts:618` | `SupportIssueService.getIssueMessages` |
| 421 | 14 | find | `SupportIssue` | `subdomains/supporting/support-issue/services/support-issue.service.ts:655` | `SupportIssueService.getIssueUserDataId` |
| 415 | 13 | find | `BuyCrypto` | `subdomains/core/buy-crypto/process/services/buy-crypto.service.ts:1186` | `BuyCryptoService.getTransactions` |
| 320 | 15 | find | `CustodyOrderStep` | `subdomains/core/custody/services/custody-job.service.ts:80` | `CustodyJobService.executeStep` |
| 418 | 11 | find | `User` | `subdomains/generic/user/models/user/user-job.service.ts:19` | `UserJobService.approveUser` |
| 411 | 15 | find | `Buy` | `subdomains/core/buy-crypto/process/services/buy-crypto.service.ts:1024` | `BuyCryptoService.getBuy` |
| 406 | 12 | find | `User` | `subdomains/generic/user/models/user/user.service.ts:393` | `UserService.updateUserV1` |
| 406 | 12 | find | `User` | `subdomains/generic/user/models/user/user.service.ts:447` | `UserService.updateUserData` |
| 396 | 15 | find | `Swap` | `subdomains/core/buy-crypto/process/services/buy-crypto-registration.service.ts:69` | `BuyCryptoRegistrationService.filterBuyCryptoPayIns` |
| 396 | 15 | find | `Swap` | `subdomains/core/buy-crypto/routes/swap/swap.service.ts:260` | `SwapService.updateSwap` |
| 396 | 15 | find | `Swap` | `subdomains/core/buy-crypto/routes/swap/swap.service.ts:268` | `SwapService.confirmSwap` |
| 392 | 14 | find | `BuyFiat` | `subdomains/core/sell-crypto/process/services/buy-fiat.service.ts:639` | `BuyFiatService.getPendingTransactions` |
| 386 | 11 | find | `User` | `subdomains/generic/user/models/user/user.service.ts:439` | `UserService.updateUserName` |
| 385 | 15 | find | `Sell` | `subdomains/core/sell-crypto/process/services/buy-fiat-registration.service.ts:139` | `BuyFiatRegistrationService.createBuyFiatsAndAckPayIns` |
| 385 | 14 | find | `KycStep` | `subdomains/generic/kyc/services/kyc-admin.service.ts:45` | `KycAdminService.updateKycStep` |
| 380 | 13 | find | `Buy` | `subdomains/core/buy-crypto/routes/buy/buy.service.ts:223` | `BuyService.getByBankUsage` |
| 384 | 13 | find | `UserData` | `subdomains/generic/user/models/user-data/user-data.service.ts:344` | `UserDataService.updateUserData` |
| 377 | 14 | find | `Sell` | `subdomains/core/sell-crypto/route/sell.service.ts:80` | `SellService.get` |
| 377 | 12 | find | `BankTxReturn` | `subdomains/supporting/bank-tx/bank-tx-return/bank-tx-return.service.ts:118` | `BankTxReturnService.create` |
| 377 | 12 | find | `BankTxReturn` | `subdomains/supporting/bank-tx/bank-tx-return/bank-tx-return.service.ts:148` | `BankTxReturnService.updateInternal` |
| 377 | 12 | find | `BankTxReturn` | `subdomains/supporting/bank-tx/bank-tx-return/bank-tx-return.service.ts:158` | `BankTxReturnService.getBankTxReturn` |
| 377 | 12 | find | `BankTxReturn` | `subdomains/supporting/bank-tx/bank-tx-return/bank-tx-return.service.ts:162` | `BankTxReturnService.getBankTxReturnsByIban` |
| 374 | 14 | find | `Sell` | `subdomains/core/sell-crypto/route/sell.service.ts:287` | `SellService.confirmSell` |
| 370 | 10 | find | `BankTx` | `subdomains/supporting/bank-tx/bank-tx/services/bank-tx.service.ts:268` | `BankTxService.fillBankTx` |
| 370 | 9 | find | `FiatOutput` | `subdomains/supporting/fiat-output/fiat-output-job.service.ts:554` | `FiatOutputJobService.searchOutgoingBankTx` |
| 360 | 12 | find | `Buy` | `subdomains/core/buy-crypto/routes/buy/buy.service.ts:162` | `BuyService.createBuy` |
| 364 | 12 | find | `Webhook` | `subdomains/generic/user/services/webhook/webhook-notification.service.ts:32` | `WebhookNotificationService.sendOpenWebhooks` |
| 364 | 12 | find | `Webhook` | `subdomains/generic/user/services/webhook/webhook.service.ts:146` | `WebhookService.createAndSendWebhook` |
| 363 | 10 | find | `BuyCrypto` | `subdomains/core/accounting/services/consumers/payout-order.consumer.ts:297` | `PayoutOrderConsumer.owedCompletionChf` |
| 363 | 10 | find | `BuyCrypto` | `subdomains/core/buy-crypto/process/services/buy-crypto-preparation.service.ts:554` | `BuyCryptoPreparationService.checkAggregatingTransactions` |
| 363 | 10 | find | `BuyCrypto` | `subdomains/core/buy-crypto/process/services/buy-crypto.service.ts:134` | `BuyCryptoService.checkAmlResetTx` |
| 363 | 10 | find | `BuyCrypto` | `subdomains/core/buy-crypto/process/services/buy-crypto.service.ts:148` | `BuyCryptoService.createFromBankTx` |
| 363 | 10 | find | `BuyCrypto` | `subdomains/core/buy-crypto/process/services/buy-crypto.service.ts:203` | `BuyCryptoService.createFromCheckoutTx` |
| 363 | 10 | find | `BuyCrypto` | `subdomains/core/buy-crypto/process/services/buy-crypto.service.ts:833` | `BuyCryptoService.manualPassAmlCheck` |
| 363 | 10 | find | `UserData` | `subdomains/generic/user/models/user-data/user-data-job.service.ts:25` | `UserDataJobService.bankTxVerification` |
| 363 | 10 | find | `BuyCrypto` | `subdomains/supporting/fiat-output/fiat-output.service.ts:108` | `FiatOutputService.create` |
| 362 | 11 | find | `Transaction` | `subdomains/supporting/payment/services/transaction.service.ts:375` | `TransactionService.getByAssetId` |
| 352 | 15 | find | `CryptoStaking` | `subdomains/core/staking/services/staking.service.ts:48` | `StakingService.getUserInvests` |
| 356 | 10 | find | `BankTx` | `subdomains/supporting/bank-tx/bank-tx/services/bank-tx.service.ts:624` | `BankTxService.getUnassignedBankTx` |
| 356 | 10 | find | `BankTx` | `subdomains/supporting/bank-tx/bank-tx/services/bank-tx.service.ts:634` | `BankTxService.getBankTxsByVirtualIban` |
| 354 | 13 | find | `Sell` | `subdomains/core/sell-crypto/route/sell.service.ts:117` | `SellService.getSellsByIban` |
| 351 | 11 | find | `UserData` | `subdomains/generic/user/models/kyc/kyc.service.ts:126` | `KycService.getUserByKycCode` |
| 351 | 11 | find | `UserData` | `subdomains/generic/user/models/user/user.service.ts:406` | `UserService.updateUser` |
| 351 | 11 | find | `UserData` | `subdomains/generic/user/models/user/user.service.ts:418` | `UserService.updateUserMail` |
| 351 | 11 | find | `UserData` | `subdomains/generic/user/models/user/user.service.ts:428` | `UserService.verifyMail` |
| 351 | 11 | find | `UserData` | `subdomains/generic/user/models/user/user.service.ts:484` | `UserService.updateAddress` |
| 344 | 11 | find | `UserData` | `subdomains/generic/user/models/user/user.service.ts:499` | `UserService.deactivateUser` |
| 343 | 10 | find | `CheckoutTx` | `subdomains/supporting/fiat-payin/services/fiat-payin-sync.service.ts:87` | `FiatPayInSyncService.createCheckoutTx` |
| 331 | 10 | find | `UserData` | `subdomains/generic/user/models/user-data/user-data.service.ts:1074` | `UserDataService.updateApiFilter` |
| 331 | 10 | find | `UserData` | `subdomains/generic/user/models/user-data/user-data.service.ts:1084` | `UserDataService.checkApiKey` |
| 327 | 13 | find | `VirtualIban` | `subdomains/supporting/bank/virtual-iban/virtual-iban.service.ts:169` | `VirtualIbanService.getByIdForUser` |
| 327 | 13 | find | `VirtualIban` | `subdomains/supporting/bank/virtual-iban/virtual-iban.service.ts:1262` | `VirtualIbanService.getActiveForBuyAndCurrency` |
| 327 | 13 | find | `VirtualIban` | `subdomains/supporting/bank/virtual-iban/virtual-iban.service.ts:1274` | `VirtualIbanService.getByIban` |
| 327 | 13 | find | `VirtualIban` | `subdomains/supporting/bank/virtual-iban/virtual-iban.service.ts:1316` | `VirtualIbanService.getVirtualIbansForAccount` |
| 309 | 8 | find | `TransactionRequest` | `subdomains/supporting/payment/services/transaction-request.service.ts:278` | `TransactionRequestService.findAndComplete` |
| 328 | 10 | find | `User` | `subdomains/generic/user/models/auth/auth.controller.ts:157` | `AuthController.createAccessTokenAfterMerge` |
| 328 | 10 | find | `User` | `subdomains/generic/user/models/kyc/kyc.service.ts:155` | `KycService.getKycFile` |
| 328 | 10 | find | `User` | `subdomains/generic/user/models/user/user.service.ts:129` | `UserService.getUserDto` |
| 323 | 10 | find | `AktionariatRegistration` | `subdomains/supporting/realunit/realunit.service.ts:1246` | `RealUnitService.forwardRegistrationToAktionariat` |
| 321 | 8 | find | `BuyFiat` | `subdomains/core/sell-crypto/process/services/buy-fiat.service.ts:362` | `BuyFiatService.getBuyFiatByTransactionId` |
| 321 | 8 | find | `BuyFiat` | `subdomains/core/sell-crypto/process/services/buy-fiat.service.ts:367` | `BuyFiatService.getBuyFiatsByTransactionIds` |
| 319 | 10 | find | `BuyFiat` | `subdomains/core/accounting/services/ledger-cutover.service.ts:308` | `LedgerCutoverService.openBuyFiatReceived` |
| 319 | 10 | find | `BuyFiat` | `subdomains/core/accounting/services/ledger-cutover.service.ts:357` | `LedgerCutoverService.openBuyFiatOwed` |
| 308 | 9 | find | `User` | `subdomains/generic/user/models/kyc/kyc.service.ts:60` | `KycService.transferKycData` |
| 308 | 9 | find | `User` | `subdomains/generic/user/models/kyc/kyc.service.ts:76` | `KycService.transferKycData` |
| 308 | 9 | find | `User` | `subdomains/generic/user/models/user/user.service.ts:80` | `UserService.getAllUser` |
| 308 | 9 | find | `User` | `subdomains/generic/user/models/user/user.service.ts:84` | `UserService.getUser` |
| 308 | 9 | find | `User` | `subdomains/generic/user/models/user/user.service.ts:88` | `UserService.getAllUserDataUsers` |
| 308 | 9 | find | `User` | `subdomains/generic/user/models/user/user.service.ts:93` | `UserService.getUsersByUserDataIds` |
| 308 | 9 | find | `User` | `subdomains/generic/user/models/user/user.service.ts:122` | `UserService.getUsersByIp` |
| 308 | 9 | find | `User` | `subdomains/generic/user/models/user/user.service.ts:204` | `UserService.getRefUser` |
| 308 | 9 | find | `User` | `subdomains/generic/user/models/user/user.service.ts:209` | `UserService.getRefUsersByRefs` |
| 308 | 9 | find | `User` | `subdomains/generic/user/models/user/user.service.ts:215` | `UserService.getUsersByUsedRefs` |
| 308 | 9 | find | `User` | `subdomains/generic/user/models/user/user.service.ts:461` | `UserService.updateUserAdmin` |
| 308 | 9 | find | `User` | `subdomains/generic/user/models/user/user.service.ts:566` | `UserService.updateUserDataVolume` |
| 308 | 9 | find | `User` | `subdomains/generic/user/models/user/user.service.ts:733` | `UserService.checkApiKey` |
| 308 | 9 | find | `User` | `subdomains/generic/user/models/user/user.service.ts:742` | `UserService.updateApiFilter` |
| 301 | 6 | find | `BankTxRepeat` | `subdomains/supporting/bank-tx/bank-tx-repeat/bank-tx-repeat.service.ts:89` | `BankTxRepeatService.getAllUserRepeats` |
| 299 | 12 | find | `TradingOrder` | `subdomains/core/trading/services/trading-order.service.ts:65` | `TradingOrderService.startNewOrders` |
| 197 | 5 | find | `CustodyOrder` | `subdomains/core/custody/services/custody-job.service.ts:113` | `CustodyJobService.onStepComplete` |
| 197 | 5 | find | `CustodyOrder` | `subdomains/core/custody/services/custody-order.service.ts:273` | `CustodyOrderService.getCustodyOrderByTx` |
| 287 | 8 | find | `BuyFiat` | `subdomains/core/sell-crypto/process/services/buy-fiat.service.ts:746` | `BuyFiatService.getTransactions` |
| 284 | 10 | find | `UserData` | `subdomains/generic/user/models/bank-data/bank-data.service.ts:173` | `BankDataService.addBankData` |
| 276 | 10 | find | `NameCheckLog` | `subdomains/generic/kyc/services/name-check.service.ts:205` | `NameCheckService.createNameCheckLog` |
| 274 | 10 | find | `BankData` | `subdomains/generic/user/models/bank-data/bank-data.service.ts:59` | `BankDataService.checkUnverifiedBankDatas` |
| 266 | 9 | find | `UserData` | `subdomains/generic/user/models/user-data/user-data-job.service.ts:39` | `UserDataJobService.setAccountOpener` |
| 264 | 9 | find | `KycFile` | `subdomains/generic/kyc/services/kyc-file.service.ts:27` | `KycFileService.getKycFile` |
| 264 | 9 | find | `KycFile` | `subdomains/generic/kyc/services/kyc-file.service.ts:34` | `KycFileService.getUserDataKycFiles` |
| 263 | 9 | find | `KycStep` | `subdomains/generic/kyc/services/kyc-notification.service.ts:35` | `KycNotificationService.autoKycStepReminder` |
| 263 | 9 | find | `KycStep` | `subdomains/generic/kyc/services/kyc.service.ts:137` | `KycService.checkIdentSteps` |
| 263 | 9 | find | `KycStep` | `subdomains/generic/kyc/services/kyc.service.ts:174` | `KycService.reviewNationalityStep` |
| 263 | 9 | find | `KycStep` | `subdomains/generic/kyc/services/kyc.service.ts:308` | `KycService.reviewFinancialData` |
| 263 | 9 | find | `KycStep` | `subdomains/generic/kyc/services/kyc.service.ts:1850` | `KycService.getUserByTransactionOrThrow` |
| 261 | 8 | find | `BuyCryptoBatch` | `subdomains/core/buy-crypto/process/services/buy-crypto-dex.service.ts:30` | `BuyCryptoDexService.secureLiquidity` |
| 261 | 8 | find | `BuyCryptoBatch` | `subdomains/core/buy-crypto/process/services/buy-crypto-dex.service.ts:35` | `BuyCryptoDexService.secureLiquidity` |
| 261 | 9 | find | `BankData` | `subdomains/generic/user/models/bank-data/bank-data.service.ts:92` | `BankDataService.verifyBankData` |
| 261 | 9 | find | `BankData` | `subdomains/generic/user/models/bank-data/bank-data.service.ts:279` | `BankDataService.getBankData` |
| 261 | 9 | find | `BankData` | `subdomains/generic/user/models/bank-data/bank-data.service.ts:299` | `BankDataService.getBankDatasByIban` |
| 261 | 9 | find | `BankData` | `subdomains/generic/user/models/bank-data/bank-data.service.ts:308` | `BankDataService.getBankDatasByUserData` |
| 261 | 9 | find | `BankData` | `subdomains/generic/user/models/bank-data/bank-data.service.ts:317` | `BankDataService.getApprovedAlternatives` |
| 261 | 9 | find | `BankData` | `subdomains/generic/user/models/bank-data/bank-data.service.ts:351` | `BankDataService.getValidBankDatasForUser` |
| 261 | 9 | find | `BankData` | `subdomains/generic/user/models/bank-data/bank-data.service.ts:369` | `BankDataService.getIdentBankDataForUser` |
| 261 | 9 | find | `BankData` | `subdomains/generic/user/models/bank-data/bank-data.service.ts:376` | `BankDataService.updateUserBankData` |
| 261 | 9 | find | `BankData` | `subdomains/generic/user/models/bank-data/bank-data.service.ts:399` | `BankDataService.updateUserBankData` |
| 261 | 9 | find | `BankData` | `subdomains/generic/user/models/bank-data/bank-data.service.ts:437` | `BankDataService.createIbanForUserInternal` |
| 261 | 9 | find | `BankData` | `subdomains/generic/user/models/bank-data/bank-data.service.ts:507` | `BankDataService.getPendingReviewList` |
| 253 | 8 | find | `UserData` | `subdomains/generic/user/models/bank-data/bank-data.service.ts:413` | `BankDataService.createIbanForUser` |
| 253 | 8 | find | `UserData` | `subdomains/generic/user/models/organization/organization.service.ts:26` | `OrganizationService.syncOrganization` |
| 253 | 8 | find | `UserData` | `subdomains/generic/user/models/user-data/jwt-revocation-sync.service.ts:30` | `JwtRevocationSyncService.syncDeniedJwtAccounts` |
| 253 | 8 | find | `UserData` | `subdomains/generic/user/models/user-data/user-data.controller.ts:54` | `UserDataController.getAllUserData` |
| 253 | 8 | find | `UserData` | `subdomains/generic/user/models/user-data/user-data.controller.ts:91` | `UserDataController.getUserData` |
| 253 | 8 | find | `UserData` | `subdomains/generic/user/models/user-data/user-data.service.ts:158` | `UserDataService.getUserData` |
| 253 | 8 | find | `UserData` | `subdomains/generic/user/models/user-data/user-data.service.ts:159` | `UserDataService.getUserData` |
| 253 | 8 | find | `UserData` | `subdomains/generic/user/models/user-data/user-data.service.ts:171` | `UserDataService.getUserDataByIds` |
| 253 | 8 | find | `UserData` | `subdomains/generic/user/models/user-data/user-data.service.ts:190` | `UserDataService.getByKycHashOrThrow` |
| 253 | 8 | find | `UserData` | `subdomains/generic/user/models/user-data/user-data.service.ts:216` | `UserDataService.getDifferentUserWithSameIdentDoc` |
| 253 | 8 | find | `UserData` | `subdomains/generic/user/models/user-data/user-data.service.ts:229` | `UserDataService.getUsersByMail` |
| 253 | 8 | find | `UserData` | `subdomains/generic/user/models/user-data/user-data.service.ts:241` | `UserDataService.getUserDataByBirthday` |
| 253 | 8 | find | `UserData` | `subdomains/generic/user/models/user-data/user-data.service.ts:281` | `UserDataService.getUsersByName` |
| 253 | 8 | find | `UserData` | `subdomains/generic/user/models/user-data/user-data.service.ts:285` | `UserDataService.getUsersByPhone` |
| 253 | 8 | find | `UserData` | `subdomains/generic/user/models/user-data/user-data.service.ts:289` | `UserDataService.getUserDatasWithKycFile` |
| 253 | 8 | find | `UserData` | `subdomains/generic/user/models/user-data/user-data.service.ts:606` | `UserDataService.assignNextKycFileId` |
| 253 | 8 | find | `UserData` | `subdomains/generic/user/models/user-data/user-data.service.ts:1128` | `UserDataService.loadRelationsAndVerify` |
| 253 | 8 | find | `UserData` | `subdomains/generic/user/models/user-data/user-data.service.ts:1139` | `UserDataService.loadRelationsAndVerify` |
| 253 | 8 | find | `UserData` | `subdomains/generic/user/models/user-data/user-data.service.ts:1146` | `UserDataService.loadRelationsAndVerify` |
| 253 | 8 | find | `UserData` | `subdomains/generic/user/models/user-data/user-data.service.ts:1783` | `UserDataService.getByPhoneCallStatuses` |
| 247 | 9 | find | `BuyFiat` | `subdomains/core/sell-crypto/process/services/buy-fiat.service.ts:575` | `BuyFiatService.updateVolumes` |
| 247 | 6 | find | `BankTx` | `subdomains/supporting/bank-tx/bank-tx/services/bank-tx.service.ts:384` | `BankTxService.reset` |
| 246 | 9 | find | `CustodyAccountAccess` | `subdomains/core/custody/services/custody-account.service.ts:61` | `CustodyAccountService.getCustodyAccountsForUser` |
| 245 | 8 | find | `NameCheckLog` | `subdomains/generic/kyc/services/name-check.service.ts:40` | `NameCheckService.updateLog` |
| 245 | 8 | find | `NameCheckLog` | `subdomains/generic/kyc/services/name-check.service.ts:169` | `NameCheckService.closeAndRefreshRiskStatus` |
| 243 | 8 | find | `KycStep` | `subdomains/generic/kyc/services/kyc-admin.service.ts:144` | `KycAdminService.triggerWebhook` |
| 243 | 8 | find | `KycStep` | `subdomains/generic/kyc/services/kyc.service.ts:1493` | `KycService.getKycStepById` |
| 243 | 8 | find | `KycStep` | `subdomains/generic/kyc/services/kyc.service.ts:1896` | `KycService.syncIdentFiles` |
| 243 | 8 | find | `KycStep` | `subdomains/generic/kyc/services/kyc.service.ts:1967` | `KycService.getDfxApprovalSteps` |
| 243 | 8 | find | `KycStep` | `subdomains/generic/kyc/services/kyc.service.ts:1995` | `KycService.getPendingReviewSteps` |
| 243 | 8 | find | `Mros` | `subdomains/supporting/mros/mros.service.ts:50` | `MrosService.getAll` |
| 243 | 8 | find | `Mros` | `subdomains/supporting/mros/mros.service.ts:54` | `MrosService.getById` |
| 240 | 5 | find | `BankTxRepeat` | `subdomains/supporting/bank-tx/bank-tx-repeat/bank-tx-repeat.service.ts:23` | `BankTxRepeatService.create` |
| 240 | 5 | find | `BankTxRepeat` | `subdomains/supporting/bank-tx/bank-tx-repeat/bank-tx-repeat.service.ts:36` | `BankTxRepeatService.update` |
| 240 | 5 | find | `BankTxRepeat` | `subdomains/supporting/bank-tx/bank-tx-repeat/bank-tx-repeat.service.ts:97` | `BankTxRepeatService.getPendingTx` |
| 239 | 8 | find | `SupportNote` | `subdomains/generic/support/services/support-note.service.ts:139` | `SupportNoteService.update` |
| 238 | 8 | find | `CustodyAccount` | `subdomains/core/custody/services/custody-account.service.ts:117` | `CustodyAccountService.getCustodyAccountById` |
| 238 | 8 | find | `CustodyAccountAccess` | `subdomains/core/custody/services/custody-account.service.ts:259` | `CustodyAccountService.getAccessList` |
| 238 | 8 | find | `CustodyAccount` | `subdomains/core/custody/services/custody-account.service.ts:384` | `CustodyAccountService.requireOwner` |
| 235 | 9 | find | `StakingReward` | `subdomains/core/staking/services/staking.service.ts:25` | `StakingService.getUserStakingRewards` |
| 234 | 6 | find | `RefReward` | `subdomains/core/referral/reward/services/ref-reward-out.service.ts:28` | `RefRewardOutService.checkPaidTransaction` |
| 234 | 6 | find | `RefReward` | `subdomains/core/referral/reward/services/ref-reward-out.service.ts:43` | `RefRewardOutService.payoutNewTransactions` |
| 234 | 6 | find | `RefReward` | `subdomains/core/referral/reward/services/ref-reward.service.ts:188` | `RefRewardService.updateRefReward` |
| 234 | 6 | find | `RefReward` | `subdomains/core/referral/reward/services/ref-reward.service.ts:199` | `RefRewardService.getAllUserRewards` |
| 234 | 6 | find | `RefReward` | `subdomains/core/referral/reward/services/ref-reward.service.ts:207` | `RefRewardService.getRefRewardsByUserDataId` |
| 229 | 11 | find | `CryptoInput` | `subdomains/supporting/dashboard/dashboard-reconciliation.service.ts:527` | `DashboardReconciliationService.getCryptoInputs` |
| 128 | 4 | find | `CustodyOrderStep` | `subdomains/core/custody/services/custody-job.service.ts:94` | `CustodyJobService.checkStep` |
| 119 | 3 | find | `CustodyOrder` | `subdomains/core/custody/services/custody-job.service.ts:52` | `CustodyJobService.resetExpiredConfirmedOrders` |
| 119 | 3 | find | `CustodyOrder` | `subdomains/core/custody/services/custody-order.service.ts:308` | `CustodyOrderService.approveOrder` |
| 119 | 3 | find | `CustodyOrder` | `subdomains/core/custody/services/custody.service.ts:257` | `CustodyService.getUserCustodyHistory` |
| 119 | 3 | find | `CustodyOrder` | `subdomains/core/custody/services/custody.service.ts:470` | `CustodyService.calculateAccruedInterest` |
| 201 | 5 | find | `BuyFiat` | `subdomains/core/accounting/services/consumers/payout-order.consumer.ts:293` | `PayoutOrderConsumer.owedCompletionChf` |
| 201 | 8 | find | `RefReward` | `subdomains/core/referral/reward/services/ref-reward-dex.service.ts:36` | `RefRewardDexService.secureLiquidity` |
| 201 | 5 | find | `BuyFiat` | `subdomains/core/sell-crypto/process/services/buy-fiat.service.ts:108` | `BuyFiatService.checkAmlResetTx` |
| 201 | 5 | find | `BuyFiat` | `subdomains/core/sell-crypto/process/services/buy-fiat.service.ts:548` | `BuyFiatService.manualPassAmlCheck` |
| 201 | 5 | find | `BuyFiat` | `subdomains/supporting/fiat-output/fiat-output.service.ts:98` | `FiatOutputService.create` |
| 195 | 8 | find | `PaymentLink` | `subdomains/core/payment-link/services/payment-link.service.ts:612` | `PaymentLinkService.deletePaymentLink` |
| 182 | 5 | find | `FiatOutput` | `subdomains/supporting/fiat-output/fiat-output.service.ts:222` | `FiatOutputService.delete` |
| 179 | 4 | find | `BankTxRepeat` | `subdomains/core/accounting/services/consumers/bank-tx.consumer.ts:553` | `BankTxConsumer.openingBankTxId` |
| 179 | 4 | find | `BankTxRepeat` | `subdomains/core/accounting/services/ledger-cutover.service.ts:641` | `LedgerCutoverService.openBankTxRepeat` |
| 176 | 5 | find | `TradingOrder` | `subdomains/core/accounting/services/consumers/trading-order.consumer.ts:84` | `TradingOrderConsumer.processForward` |
| 176 | 5 | find | `TradingOrder` | `subdomains/core/trading/services/trading-order.service.ts:164` | `TradingOrderService.checkRunningOrders` |
| 176 | 5 | find | `TradingOrder` | `subdomains/core/trading/services/trading-rule.service.ts:42` | `TradingRuleService.getCurrentTradingOrders` |
| 170 | 12 | find | `Route` | `subdomains/core/route/route.service.ts:19` | `RouteService.updateRoute` |
| 174 | 4 | find | `Recall` | `subdomains/supporting/recall/recall.service.ts:51` | `RecallService.update` |
| 174 | 4 | find | `Recall` | `subdomains/supporting/recall/recall.service.ts:63` | `RecallService.getAll` |
| 174 | 4 | find | `Recall` | `subdomains/supporting/recall/recall.service.ts:75` | `RecallService.getById` |
| 164 | 9 | find | `DepositRoute` | `subdomains/supporting/address-pool/route/deposit-route.service.ts:41` | `DepositRouteService.getByLabel` |
| 159 | 3 | find | `Transaction` | `subdomains/supporting/payment/services/transaction-notification.service.ts:114` | `TransactionNotificationService.txUnassigned` |
| 156 | 4 | find | `LiquidityOrder` | `subdomains/core/accounting/services/consumers/liquidity-order-dex.consumer.ts:104` | `LiquidityOrderDexConsumer.processForward` |
| 156 | 4 | find | `RefReward` | `subdomains/core/accounting/services/consumers/payout-order.consumer.ts:208` | `PayoutOrderConsumer.refRewardCounter` |
| 156 | 4 | find | `RefReward` | `subdomains/core/referral/reward/services/ref-reward.service.ts:140` | `RefRewardService.createPendingRefRewards` |
| 156 | 4 | find | `RefReward` | `subdomains/core/referral/reward/services/ref-reward.service.ts:261` | `RefRewardService.getTransactions` |
| 156 | 4 | find | `LiquidityOrder` | `subdomains/supporting/dex/services/base/dex-evm.service.ts:157` | `DexEvmService.getPendingAmount` |
| 156 | 4 | find | `LiquidityOrder` | `subdomains/supporting/dex/services/dex-arkade.service.ts:28` | `DexArkadeService.getPendingAmount` |
| 156 | 4 | find | `LiquidityOrder` | `subdomains/supporting/dex/services/dex-bitcoin-testnet4.service.ts:55` | `DexBitcoinTestnet4Service.getPendingAmount` |
| 156 | 4 | find | `LiquidityOrder` | `subdomains/supporting/dex/services/dex-bitcoin.service.ts:52` | `DexBitcoinService.getPendingAmount` |
| 156 | 4 | find | `LiquidityOrder` | `subdomains/supporting/dex/services/dex-cardano.service.ts:62` | `DexCardanoService.getPendingAmount` |
| 156 | 4 | find | `LiquidityOrder` | `subdomains/supporting/dex/services/dex-firo.service.ts:48` | `DexFiroService.getPendingAmount` |
| 156 | 4 | find | `LiquidityOrder` | `subdomains/supporting/dex/services/dex-icp.service.ts:73` | `DexIcpService.getPendingAmount` |
| 156 | 4 | find | `LiquidityOrder` | `subdomains/supporting/dex/services/dex-lightning.service.ts:30` | `DexLightningService.getPendingAmount` |
| 156 | 4 | find | `LiquidityOrder` | `subdomains/supporting/dex/services/dex-monero.service.ts:42` | `DexMoneroService.getPendingAmount` |
| 156 | 4 | find | `LiquidityOrder` | `subdomains/supporting/dex/services/dex-solana.service.ts:62` | `DexSolanaService.getPendingAmount` |
| 156 | 4 | find | `LiquidityOrder` | `subdomains/supporting/dex/services/dex-spark.service.ts:28` | `DexSparkService.getPendingAmount` |
| 156 | 4 | find | `LiquidityOrder` | `subdomains/supporting/dex/services/dex-tron.service.ts:62` | `DexTronService.getPendingAmount` |
| 156 | 4 | find | `LiquidityOrder` | `subdomains/supporting/dex/services/dex-zano.service.ts:58` | `DexZanoService.getPendingAmount` |
| 156 | 4 | find | `LiquidityOrder` | `subdomains/supporting/dex/services/dex.service.ts:162` | `DexService.fetchLiquidityTransactionResult` |
| 156 | 4 | find | `LiquidityOrder` | `subdomains/supporting/dex/services/dex.service.ts:182` | `DexService.checkOrderReady` |
| 156 | 4 | find | `LiquidityOrder` | `subdomains/supporting/dex/services/dex.service.ts:199` | `DexService.checkOrderCompletion` |
| 156 | 4 | find | `LiquidityOrder` | `subdomains/supporting/dex/services/dex.service.ts:211` | `DexService.completeOrders` |
| 156 | 4 | find | `LiquidityOrder` | `subdomains/supporting/dex/services/dex.service.ts:222` | `DexService.cancelOrders` |
| 156 | 4 | find | `LiquidityOrder` | `subdomains/supporting/dex/services/dex.service.ts:234` | `DexService.hasOrder` |
| 156 | 4 | find | `LiquidityOrder` | `subdomains/supporting/dex/services/dex.service.ts:239` | `DexService.getPendingOrders` |
| 156 | 4 | find | `LiquidityOrder` | `subdomains/supporting/dex/services/dex.service.ts:329` | `DexService.finalizePurchaseOrders` |
| 156 | 4 | find | `LiquidityOrder` | `subdomains/supporting/dex/services/dex.service.ts:341` | `DexService.alertStrandedPurchaseOrders` |
| 150 | 10 | find | `LiquidityManagementPipeline` | `subdomains/core/liquidity-management/services/liquidity-management.service.ts:56` | `LiquidityManagementService.getPipelineWithOrders` |
| 146 | 6 | find | `Swap` | `subdomains/core/buy-crypto/routes/swap/swap.service.ts:106` | `SwapService.updateVolume` |
| 146 | 6 | find | `Swap` | `subdomains/core/buy-crypto/routes/swap/swap.service.ts:140` | `SwapService.getSwapWithoutRoute` |
| 146 | 6 | find | `Swap` | `subdomains/core/buy-crypto/routes/swap/swap.service.ts:145` | `SwapService.get` |
| 146 | 6 | find | `Swap` | `subdomains/core/buy-crypto/routes/swap/swap.service.ts:174` | `SwapService.getAllUserSwaps` |
| 146 | 6 | find | `Swap` | `subdomains/core/buy-crypto/routes/swap/swap.service.ts:182` | `SwapService.getSwapsByUserDataId` |
| 146 | 6 | find | `Swap` | `subdomains/core/buy-crypto/routes/swap/swap.service.ts:214` | `SwapService.createSwap` |
| 146 | 6 | find | `Swap` | `subdomains/core/buy-crypto/routes/swap/swap.service.ts:253` | `SwapService.getUserSwaps` |
| 144 | 6 | find | `Sell` | `subdomains/core/sell-crypto/process/services/buy-fiat.service.ts:664` | `BuyFiatService.getSell` |
| 143 | 4 | find | `Fee` | `subdomains/supporting/payment/services/fee.service.ts:342` | `FeeService.getAllFees` |
| 139 | 9 | find | `LiquidityManagementOrder` | `subdomains/core/accounting/services/consumers/liquidity-mgmt.consumer.ts:89` | `LiquidityMgmtConsumer.processForward` |
| 139 | 9 | find | `LiquidityManagementOrder` | `subdomains/core/liquidity-management/adapters/actions/liquidity-pipeline.adapter.ts:62` | `LiquidityPipelineAdapter.buy` |
| 139 | 9 | find | `LiquidityManagementOrder` | `subdomains/core/liquidity-management/adapters/actions/liquidity-pipeline.adapter.ts:98` | `LiquidityPipelineAdapter.checkBuyCompletion` |
| 139 | 9 | find | `LiquidityManagementOrder` | `subdomains/core/liquidity-management/services/liquidity-management-pipeline.service.ts:122` | `LiquidityManagementPipelineService.getProcessingOrders` |
| 139 | 9 | find | `LiquidityManagementOrder` | `subdomains/core/liquidity-management/services/liquidity-management-pipeline.service.ts:133` | `LiquidityManagementPipelineService.getPendingTx` |
| 139 | 9 | find | `LiquidityManagementOrder` | `subdomains/core/liquidity-management/services/liquidity-management-pipeline.service.ts:181` | `LiquidityManagementPipelineService.checkRunningPipelines` |
| 139 | 9 | find | `LiquidityManagementOrder` | `subdomains/core/liquidity-management/services/liquidity-management-pipeline.service.ts:243` | `LiquidityManagementPipelineService.startNewOrders` |
| 139 | 9 | find | `LiquidityManagementOrder` | `subdomains/core/liquidity-management/services/liquidity-management-pipeline.service.ts:334` | `LiquidityManagementPipelineService.resolveUncertainOrders` |
| 139 | 9 | find | `LiquidityManagementOrder` | `subdomains/core/liquidity-management/services/liquidity-management-pipeline.service.ts:506` | `LiquidityManagementPipelineService.blockConfirmedOrder` |
| 139 | 9 | find | `LiquidityManagementOrder` | `subdomains/core/liquidity-management/services/liquidity-management-pipeline.service.ts:649` | `LiquidityManagementPipelineService.resolveUncertainOrderManually` |
| 139 | 9 | find | `LiquidityManagementOrder` | `subdomains/core/liquidity-management/services/liquidity-management-pipeline.service.ts:702` | `LiquidityManagementPipelineService.checkRunningOrders` |
| 139 | 9 | find | `LiquidityManagementOrder` | `subdomains/supporting/dashboard/dashboard-reconciliation.service.ts:510` | `DashboardReconciliationService.getLmOrders` |
| 130 | 4 | find | `Buy` | `subdomains/core/buy-crypto/routes/buy/buy.service.ts:84` | `BuyService.updateVolume` |
| 130 | 4 | find | `Buy` | `subdomains/core/buy-crypto/routes/buy/buy.service.ts:120` | `BuyService.getAllBankUsages` |
| 130 | 4 | find | `Buy` | `subdomains/core/buy-crypto/routes/buy/buy.service.ts:131` | `BuyService.get` |
| 130 | 4 | find | `Buy` | `subdomains/core/buy-crypto/routes/buy/buy.service.ts:204` | `BuyService.getBuyWithoutRoute` |
| 130 | 4 | find | `Buy` | `subdomains/core/buy-crypto/routes/buy/buy.service.ts:208` | `BuyService.getUserBuys` |
| 130 | 4 | find | `Buy` | `subdomains/core/buy-crypto/routes/buy/buy.service.ts:212` | `BuyService.getUserDataBuys` |
| 130 | 4 | find | `Buy` | `subdomains/core/buy-crypto/routes/buy/buy.service.ts:250` | `BuyService.getAllUserBuys` |
| 131 | 3 | find | `StakingRefReward` | `subdomains/core/staking/services/staking.service.ts:37` | `StakingService.getUserStakingRefRewards` |
| 130 | 9 | find | `LiquidityManagementPipeline` | `subdomains/core/liquidity-management/services/liquidity-management-pipeline.service.ts:173` | `LiquidityManagementPipelineService.checkRunningPipelines` |
| 126 | 2 | find | `BankTx` | `subdomains/supporting/bank-tx/bank-tx/services/bank-tx.service.ts:223` | `BankTxService.assignTransactions` |
| 126 | 2 | find | `BankTx` | `subdomains/supporting/bank-tx/bank-tx/services/bank-tx.service.ts:417` | `BankTxService.getBankTxByTransactionId` |
| 126 | 2 | find | `BankTx` | `subdomains/supporting/bank-tx/bank-tx/services/bank-tx.service.ts:422` | `BankTxService.getBankTxsByTransactionIds` |
| 126 | 2 | find | `BankTx` | `subdomains/supporting/bank-tx/bank-tx/services/bank-tx.service.ts:678` | `BankTxService.getBankTxsByName` |
| 124 | 5 | find | `Sell` | `subdomains/core/sell-crypto/route/sell.service.ts:123` | `SellService.getUserSells` |
| 124 | 5 | find | `Sell` | `subdomains/core/sell-crypto/route/sell.service.ts:136` | `SellService.getSellsByUserDataId` |
| 124 | 5 | find | `Sell` | `subdomains/core/sell-crypto/route/sell.service.ts:167` | `SellService.createSell` |
| 124 | 5 | find | `Sell` | `subdomains/core/sell-crypto/route/sell.service.ts:216` | `SellService.updateSell` |
| 124 | 5 | find | `Sell` | `subdomains/core/sell-crypto/route/sell.service.ts:244` | `SellService.updateVolume` |
| 124 | 5 | find | `Sell` | `subdomains/core/sell-crypto/route/sell.service.ts:278` | `SellService.getAllUserSells` |
| 123 | 3 | find | `PayoutOrder` | `subdomains/core/accounting/services/consumers/payout-order.consumer.ts:109` | `PayoutOrderConsumer.processForward` |
| 123 | 3 | find | `PayoutOrder` | `subdomains/supporting/dashboard/dashboard-reconciliation.service.ts:521` | `DashboardReconciliationService.getPayoutOrders` |
| 123 | 3 | find | `PayoutOrder` | `subdomains/supporting/payout/services/payout.service.ts:37` | `PayoutService.getPayoutOrders` |
| 123 | 3 | find | `PayoutOrder` | `subdomains/supporting/payout/services/payout.service.ts:69` | `PayoutService.checkOrderCompletion` |
| 123 | 3 | find | `PayoutOrder` | `subdomains/supporting/payout/services/payout.service.ts:91` | `PayoutService.getRecentPayoutSentCorrelationIds` |
| 123 | 3 | find | `PayoutOrder` | `subdomains/supporting/payout/services/payout.service.ts:117` | `PayoutService.speedupTransaction` |
| 123 | 3 | find | `PayoutOrder` | `subdomains/supporting/payout/services/payout.service.ts:140` | `PayoutService.retryUncertainPayout` |
| 123 | 3 | find | `PayoutOrder` | `subdomains/supporting/payout/services/payout.service.ts:193` | `PayoutService.getLatestOrderDate` |
| 123 | 3 | find | `PayoutOrder` | `subdomains/supporting/payout/services/payout.service.ts:206` | `PayoutService.checkPreparationCompletion` |
| 123 | 3 | find | `PayoutOrder` | `subdomains/supporting/payout/services/payout.service.ts:226` | `PayoutService.checkPayoutCompletion` |
| 123 | 3 | find | `PayoutOrder` | `subdomains/supporting/payout/services/payout.service.ts:249` | `PayoutService.prepareNewOrders` |
| 123 | 3 | find | `PayoutOrder` | `subdomains/supporting/payout/services/payout.service.ts:266` | `PayoutService.payoutOrders` |
| 123 | 3 | find | `PayoutOrder` | `subdomains/supporting/payout/services/payout.service.ts:283` | `PayoutService.processFailedOrders` |
| 40 | 1 | find | `CustodyBalance` | `subdomains/core/custody/services/custody-pdf.service.ts:47` | `CustodyPdfService.getBalancesWithHistoricalPrices` |
| 40 | 1 | find | `CustodyBalance` | `subdomains/core/custody/services/custody.service.ts:111` | `CustodyService.getUserCustodyBalance` |
| 40 | 1 | find | `CustodyBalance` | `subdomains/core/custody/services/custody.service.ts:238` | `CustodyService.updateCustodyBalance` |
| 118 | 3 | find | `BankTxRepeat` | `subdomains/supporting/bank-tx/bank-tx-repeat/bank-tx-repeat.service.ts:49` | `BankTxRepeatService.update` |
| 118 | 3 | find | `BankTxRepeat` | `subdomains/supporting/bank-tx/bank-tx-repeat/bank-tx-repeat.service.ts:62` | `BankTxRepeatService.update` |
| 118 | 3 | find | `BankTxRepeat` | `subdomains/supporting/bank-tx/bank-tx-repeat/bank-tx-repeat.service.ts:104` | `BankTxRepeatService.getBankTxRepeat` |
| 112 | 7 | find | `LiquidityManagementPipeline` | `subdomains/core/liquidity-management/adapters/actions/liquidity-pipeline.adapter.ts:86` | `LiquidityPipelineAdapter.checkBuyCompletion` |
| 112 | 7 | find | `LiquidityManagementPipeline` | `subdomains/core/liquidity-management/services/liquidity-management-pipeline.service.ts:110` | `LiquidityManagementPipelineService.getProcessingPipelines` |
| 112 | 7 | find | `LiquidityManagementPipeline` | `subdomains/core/liquidity-management/services/liquidity-management-pipeline.service.ts:116` | `LiquidityManagementPipelineService.getStoppedPipelines` |
| 112 | 7 | find | `LiquidityManagementPipeline` | `subdomains/core/liquidity-management/services/liquidity-management-pipeline.service.ts:155` | `LiquidityManagementPipelineService.startNewPipelines` |
| 112 | 7 | find | `LiquidityManagementPipeline` | `subdomains/core/liquidity-management/services/liquidity-management.service.ts:196` | `LiquidityManagementService.findRunningPipeline` |
| 112 | 2 | find | `TransactionRequest` | `subdomains/supporting/payment/services/transaction-request.service.ts:257` | `TransactionRequestService.getTransactionRequestByUid` |
| 112 | 2 | find | `TransactionRequest` | `subdomains/supporting/payment/services/transaction-request.service.ts:261` | `TransactionRequestService.getOpenBuyQuotes` |
| 112 | 2 | find | `TransactionRequest` | `subdomains/supporting/payment/services/transaction-request.service.ts:424` | `TransactionRequestService.getByAssetId` |
| 97 | 5 | find | `VirtualIban` | `subdomains/supporting/bank/bank/bank.service.ts:181` | `BankService.getReceiveIbanStatus` |
| 97 | 5 | find | `VirtualIban` | `subdomains/supporting/bank/virtual-iban/virtual-iban.service.ts:130` | `VirtualIbanService.getActiveReceivingForUserAndCurrency` |
| 97 | 5 | find | `VirtualIban` | `subdomains/supporting/bank/virtual-iban/virtual-iban.service.ts:155` | `VirtualIbanService.getActiveSendingCandidatesForUserAndCurrency` |
| 99 | 0 | query-builder (nur-alias) | `UserData` | `subdomains/generic/user/models/user-data/user-data-notification.service.ts:173` | `UserDataNotificationService.blackSquadInvitation` |
| 99 | 0 | query-builder (ohne-select) | `UserData` | `subdomains/generic/user/models/user-data/user-data.service.ts:141` | `UserDataService.getUserDataByUser` |
| 99 | 0 | query-builder (nur-alias) | `UserData` | `subdomains/generic/user/models/user-data/user-data.service.ts:313` | `UserDataService.getUserDataByKey` |
| 98 | 2 | find | `User` | `subdomains/generic/user/models/user-data/user-data.service.ts:1033` | `UserDataService.customIdentMethod` |
| 98 | 2 | find | `User` | `subdomains/generic/user/models/user/user.service.ts:274` | `UserService.getRefDtoV2` |
| 98 | 2 | find | `User` | `subdomains/generic/user/models/user/user.service.ts:282` | `UserService.updateRef` |
| 98 | 2 | find | `User` | `subdomains/generic/user/services/webhook/webhook.service.ts:107` | `WebhookService.sendWebhooks` |
| 98 | 2 | find | `User` | `subdomains/generic/user/services/webhook/webhook.service.ts:176` | `WebhookService.getUsers` |
| 98 | 2 | find | `Transaction` | `subdomains/supporting/payment/services/transaction.service.ts:146` | `TransactionService.getTransactionById` |
| 98 | 2 | find | `Transaction` | `subdomains/supporting/payment/services/transaction.service.ts:151` | `TransactionService.getTransactionsByIds` |
| 98 | 2 | find | `Transaction` | `subdomains/supporting/payment/services/transaction.service.ts:159` | `TransactionService.getTransactionByUid` |
| 98 | 2 | find | `Transaction` | `subdomains/supporting/payment/services/transaction.service.ts:166` | `TransactionService.getTransactionByRequestId` |
| 98 | 2 | find | `Transaction` | `subdomains/supporting/payment/services/transaction.service.ts:173` | `TransactionService.getTransactionByRequestUid` |
| 98 | 2 | find | `Transaction` | `subdomains/supporting/payment/services/transaction.service.ts:181` | `TransactionService.getTransactionByExternalId` |
| 98 | 2 | find | `Transaction` | `subdomains/supporting/payment/services/transaction.service.ts:185` | `TransactionService.getTransactionByCkoId` |
| 93 | 2 | find | `AktionariatRegistration` | `subdomains/supporting/realunit/realunit.service.ts:1281` | `RealUnitService.findRegistration` |
| 93 | 2 | find | `AktionariatRegistration` | `subdomains/supporting/realunit/realunit.service.ts:1296` | `RealUnitService.findRegistration` |
| 91 | 4 | find | `PaymentActivation` | `subdomains/core/payment-link/services/payment-activation.service.ts:64` | `PaymentActivationService.getActivationByTxId` |
| 91 | 4 | find | `PaymentActivation` | `subdomains/core/payment-link/services/payment-activation.service.ts:131` | `PaymentActivationService.getExistingActivations` |
| 87 | 2 | find | `TradingRule` | `subdomains/core/trading/services/trading-rule.service.ts:46` | `TradingRuleService.updateTradingRule` |
| 87 | 2 | find | `TradingRule` | `subdomains/core/trading/services/trading-rule.service.ts:53` | `TradingRuleService.processRules` |
| 87 | 2 | find | `TradingRule` | `subdomains/core/trading/services/trading-rule.service.ts:63` | `TradingRuleService.reactivateRules` |
| 87 | 2 | find | `RealUnitTransferRequest` | `subdomains/supporting/realunit/realunit.service.ts:3103` | `RealUnitService.confirmTransfer` |
| 87 | 2 | find | `RealUnitTransferRequest` | `subdomains/supporting/realunit/realunit.service.ts:3209` | `RealUnitService.reconcilePendingTransfers` |
| 86 | 2 | find | `Asset` | `shared/models/asset/asset.service.ts:78` | `AssetService.getAssetsByPriceRules` |
| 83 | 4 | find | `LiquidityManagementRule` | `subdomains/core/liquidity-management/services/liquidity-management-rule.service.ts:56` | `LiquidityManagementRuleService.updateRule` |
| 83 | 4 | find | `LiquidityManagementRule` | `subdomains/core/liquidity-management/services/liquidity-management-rule.service.ts:64` | `LiquidityManagementRuleService.getRule` |
| 83 | 4 | find | `LiquidityManagementRule` | `subdomains/core/liquidity-management/services/liquidity-management-rule.service.ts:72` | `LiquidityManagementRuleService.deactivateRule` |
| 83 | 4 | find | `LiquidityManagementRule` | `subdomains/core/liquidity-management/services/liquidity-management-rule.service.ts:82` | `LiquidityManagementRuleService.reactivateRule` |
| 83 | 4 | find | `LiquidityManagementRule` | `subdomains/core/liquidity-management/services/liquidity-management-rule.service.ts:95` | `LiquidityManagementRuleService.updateRuleSettings` |
| 83 | 4 | find | `LiquidityManagementRule` | `subdomains/core/liquidity-management/services/liquidity-management-rule.service.ts:110` | `LiquidityManagementRuleService.reactivateRules` |
| 83 | 4 | find | `LiquidityManagementRule` | `subdomains/core/liquidity-management/services/liquidity-management-rule.service.ts:147` | `LiquidityManagementRuleService.findExistingRuleOnCreation` |
| 83 | 4 | find | `LiquidityManagementRule` | `subdomains/core/liquidity-management/services/liquidity-management.service.ts:109` | `LiquidityManagementService.findRuleByAssetOrThrow` |
| 81 | 0 | query-builder (feldliste) | `SupportIssue` | `subdomains/supporting/support-issue/repositories/support-issue.repository.ts:336` | `SupportIssueRepository.findIssueData` |
| 78 | 1 | find | `User` | `subdomains/generic/user/models/user/user.service.ts:97` | `UserService.getUserByAddress` |
| 78 | 3 | find | `Mros` | `subdomains/supporting/mros/mros.service.ts:32` | `MrosService.update` |
| 77 | 0 | query-builder (nur-alias) | `BuyCrypto` | `subdomains/core/buy-crypto/process/services/buy-crypto.service.ts:712` | `BuyCryptoService.getBuyCryptoByKeys` |
| 75 | 2 | find | `BuyCryptoBatch` | `subdomains/core/buy-crypto/process/services/buy-crypto-batch.service.ts:238` | `BuyCryptoBatchService.filterOutExistingBatches` |
| 71 | 0 | query-builder (nur-alias) | `BuyFiat` | `subdomains/core/sell-crypto/process/services/buy-fiat.service.ts:340` | `BuyFiatService.getBuyFiatByKey` |
| 71 | 1 | find | `Recall` | `subdomains/supporting/recall/recall.service.ts:68` | `RecallService.getByBankTxIds` |
| 68 | 4 | find | `Swap` | `subdomains/core/buy-crypto/routes/swap/swap.service.ts:204` | `SwapService.getById` |
| 66 | 0 | query-builder (feldliste) | `UserData` | `subdomains/generic/user/models/user-data/user-data.repository.ts:252` | `UserDataRepository.getUserV2` |
| 65 | 2 | find | `Fee` | `subdomains/supporting/payment/services/fee.service.ts:115` | `FeeService.createFee` |
| 61 | 0 | find | `BankTx` | `subdomains/core/accounting/services/consumers/exchange-tx.consumer.ts:386` | `ExchangeTxConsumer.hasBankRouteMatch` |
| 61 | 0 | find | `BankTx` | `subdomains/core/accounting/services/ledger-cutover.service.ts:710` | `LedgerCutoverService.openUnattributed` |
| 61 | 0 | find | `BankTx` | `subdomains/supporting/bank-tx/bank-tx-repeat/bank-tx-repeat.service.ts:46` | `BankTxRepeatService.update` |
| 61 | 0 | find | `BankTx` | `subdomains/supporting/bank-tx/bank-tx-repeat/bank-tx-repeat.service.ts:59` | `BankTxRepeatService.update` |
| 61 | 0 | query-builder (alias only) | `BankTx` | `subdomains/supporting/bank-tx/bank-tx/services/bank-tx-outgoing-match.service.ts:36` | `BankTxOutgoingMatchService.getUniqueOutgoingBankTx` |
| 61 | 0 | find | `BankTx` | `subdomains/supporting/bank-tx/bank-tx/services/bank-tx.service.ts:153` | `BankTxService.enrichYapealTransactions` |
| 61 | 0 | query-builder (alias only) | `BankTx` | `subdomains/supporting/bank-tx/bank-tx/services/bank-tx.service.ts:395` | `BankTxService.getBankTxByKey` |
| 61 | 0 | find | `BankTx` | `subdomains/supporting/bank-tx/bank-tx/services/bank-tx.service.ts:429` | `BankTxService.getBankTxById` |
| 61 | 0 | find | `BankTx` | `subdomains/supporting/bank-tx/bank-tx/services/bank-tx.service.ts:433` | `BankTxService.getPendingTx` |
| 61 | 0 | find | `BankTx` | `subdomains/supporting/bank-tx/bank-tx/services/bank-tx.service.ts:525` | `BankTxService.getRecentBankToBankTx` |
| 61 | 0 | find | `BankTx` | `subdomains/supporting/bank-tx/bank-tx/services/bank-tx.service.ts:532` | `BankTxService.getRecentExchangeTx` |
| 61 | 0 | find | `BankTx` | `subdomains/supporting/bank-tx/bank-tx/services/bank-tx.service.ts:552` | `BankTxService.storeSepaFile` |
| 61 | 0 | find | `BankTx` | `subdomains/supporting/dashboard/dashboard-reconciliation.service.ts:464` | `DashboardReconciliationService.getBankFlows` |
| 59 | 2 | find | `PaymentQuote` | `subdomains/core/payment-link/services/payment-quote.service.ts:94` | `PaymentQuoteService.getActualQuoteByUniqueId` |
| 59 | 1 | find | `FiatOutput` | `subdomains/supporting/fiat-output/fiat-output-frick.service.ts:37` | `FiatOutputFrickService.checkFrickOrderStatus` |
| 59 | 1 | find | `FiatOutput` | `subdomains/supporting/fiat-output/fiat-output-frick.service.ts:101` | `FiatOutputFrickService.transmitPayments` |
| 59 | 1 | find | `FiatOutput` | `subdomains/supporting/fiat-output/fiat-output-job.service.ts:85` | `FiatOutputJobService.checkOlkypayOrderStatus` |
| 59 | 1 | find | `FiatOutput` | `subdomains/supporting/fiat-output/fiat-output-job.service.ts:362` | `FiatOutputJobService.DisabledProcess` |
| 59 | 1 | find | `FiatOutput` | `subdomains/supporting/fiat-output/fiat-output-job.service.ts:407` | `FiatOutputJobService.checkTransmission` |
| 59 | 1 | find | `FiatOutput` | `subdomains/supporting/fiat-output/fiat-output-job.service.ts:432` | `FiatOutputJobService.transmitYapealPayments` |
| 59 | 1 | find | `FiatOutput` | `subdomains/supporting/fiat-output/fiat-output-job.service.ts:495` | `FiatOutputJobService.transmitOlkypayPayments` |
| 59 | 1 | find | `FiatOutput` | `subdomains/supporting/fiat-output/fiat-output-job.service.ts:603` | `FiatOutputJobService.getLastBatchId` |
| 59 | 1 | find | `FiatOutput` | `subdomains/supporting/fiat-output/fiat-output-job.service.ts:638` | `FiatOutputJobService.notifyScryptDeposits` |
| 59 | 1 | find | `FiatOutput` | `subdomains/supporting/fiat-output/fiat-output.service.ts:203` | `FiatOutputService.update` |
| 52 | 2 | find | `Buy` | `subdomains/core/buy-crypto/routes/buy/buy.service.ts:140` | `BuyService.getById` |
| 52 | 2 | find | `Buy` | `subdomains/core/buy-crypto/routes/buy/buy.service.ts:258` | `BuyService.updateBuy` |
| 54 | 2 | find | `LedgerAccount` | `subdomains/core/accounting/services/ledger-query.service.ts:89` | `LedgerQueryService.getAccounts` |
| 54 | 2 | find | `LedgerAccount` | `subdomains/core/accounting/services/ledger-query.service.ts:157` | `LedgerQueryService.getReconStatus` |
| 54 | 2 | find | `LedgerAccount` | `subdomains/core/accounting/services/ledger-query.service.ts:613` | `LedgerQueryService.unverifiedAccountIds` |
| 54 | 2 | find | `LedgerAccount` | `subdomains/core/accounting/services/ledger-reconciliation.service.ts:146` | `LedgerReconciliationService.reconcileAssets` |
| 53 | 1 | find | `PriceRule` | `subdomains/supporting/pricing/services/pricing.service.ts:163` | `PricingService.updatePrices` |
| 50 | 2 | find | `PaymentLinkPayment` | `subdomains/core/payment-link/services/payment-link-payment.service.ts:58` | `PaymentLinkPaymentService.processExpiredPayments` |
| 50 | 2 | find | `PaymentLinkPayment` | `subdomains/core/payment-link/services/payment-link-payment.service.ts:264` | `PaymentLinkPaymentService.expirePaymentIfPending` |
| 50 | 2 | find | `PaymentLink` | `subdomains/core/payment-link/services/payment-link.service.ts:172` | `PaymentLinkService.createInvoice` |
| 46 | 1 | find | `Bank` | `subdomains/core/accounting/services/consumers/bank-tx.consumer.ts:839` | `BankTxConsumer.bankContext` |
| 46 | 1 | find | `Bank` | `subdomains/core/accounting/services/consumers/bank-tx.consumer.ts:870` | `BankTxConsumer.currencyMarkAssetId` |
| 46 | 1 | find | `Bank` | `subdomains/core/accounting/services/ledger-cutover.service.ts:750` | `LedgerCutoverService.bankMaps` |
| 46 | 3 | find | `Sell` | `subdomains/core/sell-crypto/route/sell.service.ts:90` | `SellService.getById` |
| 46 | 3 | find | `Sell` | `subdomains/core/sell-crypto/route/sell.service.ts:143` | `SellService.getSellWithoutRoute` |
| 46 | 1 | find | `Bank` | `subdomains/supporting/bank/bank/bank.service.ts:40` | `BankService.getAllBanks` |
| 46 | 1 | find | `Bank` | `subdomains/supporting/bank/bank/bank.service.ts:44` | `BankService.getBanksWithAsset` |
| 46 | 1 | find | `Bank` | `subdomains/supporting/bank/bank/bank.service.ts:48` | `BankService.getBanksByName` |
| 46 | 1 | find | `Bank` | `subdomains/supporting/bank/bank/bank.service.ts:222` | `BankService.loadIbanCache` |
| 46 | 1 | find | `Asset` | `subdomains/supporting/dashboard/dashboard-reconciliation.service.ts:74` | `DashboardReconciliationService.getReconciliation` |
| 46 | 1 | find | `Asset` | `subdomains/supporting/dashboard/dashboard-reconciliation.service.ts:146` | `DashboardReconciliationService.getOverview` |
| 46 | 3 | find | `Sell` | `subdomains/supporting/fiat-output/fiat-output.service.ts:149` | `FiatOutputService.createInternal` |
| 46 | 0 | query-builder (alias only) | `FiatOutput` | `subdomains/supporting/fiat-output/fiat-output.service.ts:231` | `FiatOutputService.getFiatOutputByKey` |
| 45 | 2 | find | `PaymentQuote` | `subdomains/core/payment-link/services/payment-quote.service.ts:124` | `PaymentQuoteService.getQuoteByAsset` |
| 45 | 2 | find | `PaymentQuote` | `subdomains/core/payment-link/services/payment-quote.service.ts:143` | `PaymentQuoteService.getQuoteByTxId` |
| 45 | 0 | query-builder (nur-alias) | `User` | `subdomains/generic/user/models/user/user.service.ts:102` | `UserService.getUserByKey` |
| 45 | 0 | query-builder (ohne-select) | `User` | `subdomains/generic/user/models/user/user.service.ts:177` | `UserService.getOpenRefCreditUser` |
| 42 | 1 | find | `FaucetRequest` | `subdomains/core/faucet-request/services/faucet-request.service.ts:41` | `FaucetRequestService.checkFaucetRequests` |
| 42 | 1 | find | `FaucetRequest` | `subdomains/core/faucet-request/services/faucet-request.service.ts:93` | `FaucetRequestService.resetFaucet` |
| 41 | 0 | query-builder (feldliste) | `UserData` | `subdomains/generic/user/models/user-data/user-data.repository.ts:267` | `UserDataRepository.getProfile` |
| 40 | 1 | find | `LiquidityBalance` | `subdomains/core/liquidity-management/services/liquidity-management-balance.service.ts:38` | `LiquidityManagementBalanceService.getAllLiqBalancesForAssets` |
| 40 | 1 | find | `LiquidityBalance` | `subdomains/core/liquidity-management/services/liquidity-management-balance.service.ts:68` | `LiquidityManagementBalanceService.refreshBankBalance` |
| 40 | 1 | find | `LiquidityBalance` | `subdomains/core/liquidity-management/services/liquidity-management-balance.service.ts:82` | `LiquidityManagementBalanceService.getBalances` |
| 40 | 1 | find | `LiquidityBalance` | `subdomains/core/liquidity-management/services/liquidity-management-balance.service.ts:95` | `LiquidityManagementBalanceService.saveBalanceResults` |
| 40 | 1 | find | `AssetPrice` | `subdomains/supporting/pricing/services/asset-prices.service.ts:12` | `AssetPricesService.getAssetPrices` |
| 40 | 1 | find | `AssetPrice` | `subdomains/supporting/pricing/services/asset-prices.service.ts:38` | `AssetPricesService.getAssetPriceEntitiesForDate` |
| 39 | 1 | find | `Organization` | `subdomains/generic/user/models/organization/organization.service.ts:86` | `OrganizationService.getOrganizationByName` |
| 38 | 1 | find | `BlockchainFee` | `subdomains/supporting/payment/services/fee.service.ts:93` | `FeeService.updateBlockchainFees` |
| 38 | 1 | find | `BlockchainFee` | `subdomains/supporting/payment/services/fee.service.ts:297` | `FeeService.getBlockchainFeeInChf` |
| 38 | 1 | find | `BlockchainFee` | `subdomains/supporting/payment/services/fee.service.ts:550` | `FeeService.getBlockchainMaxFee` |
| 34 | 0 | find | `TransactionRequest` | `subdomains/supporting/payment/services/transaction-request.service.ts:96` | `TransactionRequestService.syncStatus` |
| 34 | 0 | find | `TransactionRequest` | `subdomains/supporting/payment/services/transaction-request.service.ts:233` | `TransactionRequestService.getTransactionRequest` |
| 34 | 0 | find | `TransactionRequest` | `subdomains/supporting/payment/services/transaction-request.service.ts:244` | `TransactionRequestService.getWaitingTransactionRequest` |
| 34 | 0 | find | `TransactionRequest` | `subdomains/supporting/payment/services/transaction-request.service.ts:341` | `TransactionRequestService.getConsumedSettlementEventIds` |
| 33 | 0 | find | `Asset` | `shared/models/asset/asset.service.ts:21` | `AssetService.updateAsset` |
| 33 | 0 | find | `Asset` | `shared/models/asset/asset.service.ts:30` | `AssetService.getAssetsWith` |
| 33 | 0 | find | `Asset` | `shared/models/asset/asset.service.ts:42` | `AssetService.getAllBlockchainAssets` |
| 33 | 0 | find | `Asset` | `shared/models/asset/asset.service.ts:46` | `AssetService.getPricedAssets` |
| 33 | 0 | find | `Asset` | `shared/models/asset/asset.service.ts:53` | `AssetService.getPaymentAssets` |
| 33 | 0 | find | `Asset` | `shared/models/asset/asset.service.ts:57` | `AssetService.getAssetById` |
| 33 | 0 | find | `Asset` | `shared/models/asset/asset.service.ts:61` | `AssetService.getAssetsById` |
| 33 | 0 | find | `Asset` | `shared/models/asset/asset.service.ts:87` | `AssetService.getAssetsByIdWith` |
| 33 | 0 | find | `Asset` | `shared/models/asset/asset.service.ts:91` | `AssetService.getAssetByChainId` |
| 33 | 0 | find | `Asset` | `shared/models/asset/asset.service.ts:95` | `AssetService.getAssetByUniqueName` |
| 33 | 0 | find | `Asset` | `shared/models/asset/asset.service.ts:99` | `AssetService.getAssetByQuery` |
| 33 | 0 | find | `Asset` | `shared/models/asset/asset.service.ts:103` | `AssetService.getAssetsByName` |
| 33 | 0 | find | `Asset` | `shared/models/asset/asset.service.ts:107` | `AssetService.getNativeAsset` |
| 33 | 0 | find | `Asset` | `shared/models/asset/asset.service.ts:121` | `AssetService.getTokens` |
| 33 | 0 | find | `Asset` | `shared/models/asset/asset.service.ts:126` | `AssetService.getSellableBlockchains` |
| 33 | 0 | find | `Asset` | `subdomains/supporting/dashboard/dashboard-reconciliation.service.ts:106` | `DashboardReconciliationService.getReconciliation` |
| 33 | 0 | find | `Asset` | `subdomains/supporting/dashboard/dashboard-reconciliation.service.ts:377` | `DashboardReconciliationService.getExchangeFlows` |
| 32 | 1 | find | `PaymentLinkPayment` | `subdomains/core/payment-link/services/payment-link-payment.service.ts:125` | `PaymentLinkPaymentService.getPaymentByExternalId` |
| 32 | 1 | find | `PaymentLinkPayment` | `subdomains/core/payment-link/services/payment-link-payment.service.ts:131` | `PaymentLinkPaymentService.getMostRecentPayment` |
| 31 | 1 | find | `BankData` | `subdomains/generic/user/models/bank-data/bank-data.service.ts:217` | `BankDataService.createBankDataInternal` |
| 31 | 1 | find | `BankData` | `subdomains/generic/user/models/bank-data/bank-data.service.ts:237` | `BankDataService.updateBankData` |
| 31 | 1 | find | `BankData` | `subdomains/generic/user/models/bank-data/bank-data.service.ts:332` | `BankDataService.getVerifiedBankDataWithIban` |
| 30 | 0 | find | `ExchangeTx` | `integration/exchange/services/exchange-tx.service.ts:76` | `ExchangeTxService.upsertScryptTx` |
| 30 | 0 | find | `ExchangeTx` | `integration/exchange/services/exchange-tx.service.ts:114` | `ExchangeTxService.syncExchanges` |
| 30 | 0 | find | `ExchangeTx` | `integration/exchange/services/exchange-tx.service.ts:211` | `ExchangeTxService.getExchangeTx` |
| 30 | 0 | find | `ExchangeTx` | `integration/exchange/services/exchange-tx.service.ts:215` | `ExchangeTxService.getLastExchangeTx` |
| 30 | 0 | find | `ExchangeTx` | `integration/exchange/services/exchange-tx.service.ts:219` | `ExchangeTxService.getRecentExchangeTx` |
| 30 | 0 | find | `ExchangeTx` | `integration/exchange/services/exchange-tx.service.ts:269` | `ExchangeTxService.getSyncSinceDate` |
| 30 | 2 | find | `LedgerTx` | `subdomains/core/accounting/services/consumers/bank-tx.consumer.ts:335` | `BankTxConsumer.cutoverOwedOpeningChf` |
| 30 | 2 | find | `LedgerTx` | `subdomains/core/accounting/services/consumers/bank-tx.consumer.ts:563` | `BankTxConsumer.openingLiabilityLegChf` |
| 30 | 2 | find | `LedgerTx` | `subdomains/core/accounting/services/consumers/bank-tx.consumer.ts:582` | `BankTxConsumer.cutoverOpeningLiabilityChf` |
| 30 | 2 | find | `LedgerTx` | `subdomains/core/accounting/services/consumers/buy-crypto.consumer.ts:323` | `BuyCryptoConsumer.paymentLinkOpeningChf` |
| 30 | 2 | find | `LedgerTx` | `subdomains/core/accounting/services/consumers/buy-fiat.consumer.ts:585` | `BuyFiatConsumer.cutoverOwedOpeningChf` |
| 30 | 2 | find | `LedgerTx` | `subdomains/core/accounting/services/consumers/buy-fiat.consumer.ts:603` | `BuyFiatConsumer.paymentLinkOpeningChf` |
| 30 | 2 | find | `LedgerTx` | `subdomains/core/accounting/services/consumers/buy-fiat.consumer.ts:621` | `BuyFiatConsumer.cutoverPaymentLinkOpeningChf` |
| 30 | 0 | find | `ExchangeTx` | `subdomains/core/accounting/services/consumers/exchange-tx.consumer.ts:78` | `ExchangeTxConsumer.processForward` |
| 30 | 2 | find | `LedgerLeg` | `subdomains/core/accounting/services/consumers/exchange-tx.consumer.ts:363` | `ExchangeTxConsumer.matchRaiffeisenSweep` |
| 30 | 0 | find | `ExchangeTx` | `subdomains/core/accounting/services/consumers/exchange-tx.consumer.ts:417` | `ExchangeTxConsumer.buildFillIndexMap` |
| 30 | 2 | find | `LedgerTx` | `subdomains/core/accounting/services/consumers/payout-order.consumer.ts:321` | `PayoutOrderConsumer.cutoverOwedOpeningChf` |
| 30 | 2 | find | `LedgerLeg` | `subdomains/core/accounting/services/ledger-query.service.ts:343` | `LedgerQueryService.counterAccountByTxId` |
| 30 | 0 | find | `ExchangeTx` | `subdomains/supporting/dashboard/dashboard-reconciliation.service.ts:286` | `DashboardReconciliationService.getBlockchainFlows` |
| 30 | 0 | find | `ExchangeTx` | `subdomains/supporting/dashboard/dashboard-reconciliation.service.ts:387` | `DashboardReconciliationService.getExchangeFlows` |
| 30 | 0 | find | `ExchangeTx` | `subdomains/supporting/dashboard/dashboard-reconciliation.service.ts:544` | `DashboardReconciliationService.getExchangeWithdrawalsForBlockchain` |
| 27 | 2 | find | `LiquidityManagementAction` | `subdomains/core/liquidity-management/services/liquidity-management-rule.service.ts:257` | `LiquidityManagementRuleService.findExistingAction` |
| 26 | 0 | query-builder (nur-alias) | `BankAccount` | `subdomains/supporting/bank/bank-account/bank-account.service.ts:22` | `BankAccountService.getBankAccountByKey` |
| 26 | 0 | find | `BankAccount` | `subdomains/supporting/bank/bank-account/bank-account.service.ts:40` | `BankAccountService.checkFailedBankAccounts` |
| 26 | 0 | find | `BankAccount` | `subdomains/supporting/bank/bank-account/bank-account.service.ts:48` | `BankAccountService.reloadErrorBankAccounts` |
| 26 | 0 | find | `BankAccount` | `subdomains/supporting/bank/bank-account/bank-account.service.ts:56` | `BankAccountService.reloadUncheckedBankAccounts` |
| 26 | 0 | find | `BankAccount` | `subdomains/supporting/bank/bank-account/bank-account.service.ts:66` | `BankAccountService.getOrCreateIbanBankAccountInternal` |
| 26 | 0 | find | `BankAccount` | `subdomains/supporting/bank/bank-account/bank-account.service.ts:73` | `BankAccountService.getOrCreateBicBankAccountInternal` |
| 25 | 0 | find | `CheckoutTx` | `subdomains/supporting/fiat-payin/services/checkout-tx.service.ts:53` | `CheckoutTxService.getCheckoutTx` |
| 25 | 0 | find | `CheckoutTx` | `subdomains/supporting/fiat-payin/services/checkout-tx.service.ts:60` | `CheckoutTxService.getPendingRefundedList` |
| 25 | 0 | find | `CheckoutTx` | `subdomains/supporting/fiat-payin/services/checkout-tx.service.ts:71` | `CheckoutTxService.getSyncDate` |
| 23 | 0 | find | `Country` | `shared/models/country/country.service.ts:12` | `CountryService.getAllCountry` |
| 23 | 0 | find | `Country` | `shared/models/country/country.service.ts:16` | `CountryService.getCountry` |
| 23 | 0 | find | `Country` | `shared/models/country/country.service.ts:21` | `CountryService.getCountryWithSymbol` |
| 23 | 0 | find | `Country` | `shared/models/country/country.service.ts:22` | `CountryService.getCountryWithSymbol` |
| 23 | 0 | find | `Country` | `shared/models/country/country.service.ts:28` | `CountryService.getCountriesByKycType` |
| 23 | 0 | find | `Country` | `shared/models/country/country.service.ts:31` | `CountryService.getCountriesByKycType` |
| 23 | 0 | find | `BankTxBatch` | `subdomains/supporting/bank-tx/bank-tx/services/bank-tx-batch.service.ts:10` | `BankTxBatchService.getBankTxBatchByIban` |
| 21 | 0 | query-builder (ohne-select) | `DepositRoute` | `subdomains/supporting/address-pool/route/deposit-route.service.ts:87` | `DepositRouteService.getPaymentRouteForKey` |
| 20 | 0 | query-builder (nur-alias) | `Sell` | `subdomains/core/sell-crypto/route/sell.service.ts:95` | `SellService.getSellByKey` |
| 20 | 0 | find | `Wallet` | `subdomains/generic/user/models/wallet/wallet.repository.ts:54` | `WalletRepository.getByAddress` |
| 20 | 0 | find | `Wallet` | `subdomains/generic/user/models/wallet/wallet.service.ts:19` | `WalletService.updateWallet` |
| 20 | 0 | find | `Wallet` | `subdomains/generic/user/models/wallet/wallet.service.ts:28` | `WalletService.getByAddress` |
| 20 | 0 | find | `Wallet` | `subdomains/generic/user/models/wallet/wallet.service.ts:36` | `WalletService.getByIdOrName` |
| 20 | 0 | find | `Wallet` | `subdomains/generic/user/models/wallet/wallet.service.ts:40` | `WalletService.getKycClients` |
| 20 | 0 | find | `Wallet` | `subdomains/generic/user/models/wallet/wallet.service.ts:44` | `WalletService.getDefault` |
| 20 | 0 | query-builder (nur-alias) | `Transaction` | `subdomains/supporting/payment/services/transaction.service.ts:221` | `TransactionService.getTransactionList` |
| 20 | 0 | query-builder (nur-alias) | `Transaction` | `subdomains/supporting/payment/services/transaction.service.ts:389` | `TransactionService.getTransactionByKey` |
| 20 | 0 | query-builder (ohne-select) | `PriceRule` | `subdomains/supporting/pricing/services/pricing.service.ts:272` | `PricingService.getRuleFor` |
| 19 | 0 | query-builder (ohne-select) | `Swap` | `subdomains/core/buy-crypto/routes/swap/swap.service.ts:79` | `SwapService.getSwapByAddress` |
| 19 | 0 | query-builder (nur-alias) | `Swap` | `subdomains/core/buy-crypto/routes/swap/swap.service.ts:152` | `SwapService.getSwapByKey` |
| 17 | 0 | find | `KycLog` | `subdomains/generic/kyc/services/kyc-log.service.ts:83` | `KycLogService.updateLog` |
| 17 | 0 | find | `KycLog` | `subdomains/generic/kyc/services/kyc-log.service.ts:90` | `KycLogService.updateLogPdfUrl` |
| 17 | 0 | find | `KycLog` | `subdomains/generic/kyc/services/kyc-log.service.ts:109` | `KycLogService.getLogsByUserDataId` |
| 16 | 0 | find | `Fiat` | `shared/models/fiat/fiat.service.ts:12` | `FiatService.getAllFiat` |
| 16 | 0 | find | `Fiat` | `shared/models/fiat/fiat.service.ts:16` | `FiatService.getActiveFiat` |
| 16 | 0 | find | `Fiat` | `shared/models/fiat/fiat.service.ts:27` | `FiatService.getFiat` |
| 16 | 0 | find | `Fiat` | `shared/models/fiat/fiat.service.ts:33` | `FiatService.getFiatByName` |
| 16 | 0 | find | `Fiat` | `shared/models/fiat/fiat.service.ts:43` | `FiatService.getFiatByCountry` |
| 16 | 0 | query-builder (projektion-mit-vollem-join) | `PaymentLinkPayment` | `subdomains/core/payment-link/services/payment-link-payment.service.ts:148` | `PaymentLinkPaymentService.getMostRecentPayments` |
| 16 | 0 | query-builder (nur-alias) | `VirtualIban` | `subdomains/supporting/bank/virtual-iban/virtual-iban.service.ts:1294` | `VirtualIbanService.getVirtualIbanByKey` |
| 15 | 0 | find | `WalletApp` | `subdomains/core/payment-link/services/wallet-app.service.ts:20` | `WalletAppService.getAllBlockchainWalletApps` |
| 15 | 0 | find | `WalletApp` | `subdomains/core/payment-link/services/wallet-app.service.ts:24` | `WalletAppService.getRecommendedWalletApps` |
| 15 | 0 | find | `WalletApp` | `subdomains/core/payment-link/services/wallet-app.service.ts:28` | `WalletAppService.getWalletAppById` |
| 15 | 0 | query-builder (nur-alias) | `BankData` | `subdomains/generic/user/models/bank-data/bank-data.service.ts:284` | `BankDataService.getBankDataByKey` |
| 15 | 0 | find | `AktionariatRegistration` | `subdomains/supporting/realunit/realunit.service.ts:2830` | `RealUnitService.getRegisteredWalletAddresses` |
| 14 | 0 | find | `ScorechainScreening` | `integration/scorechain/repositories/scorechain-screening.repository.ts:18` | `ScorechainScreeningRepository.getByObjectIds` |
| 14 | 0 | find | `ScorechainScreening` | `integration/scorechain/services/scorechain-screening.service.ts:233` | `ScorechainScreeningService.getCached` |
| 14 | 0 | query-builder (feldliste) | `CustodyOrder` | `subdomains/core/custody/repositories/custody-order.repository.ts:59` | `CustodyOrderRepository.findHistoryFor` |
| 14 | 0 | query-builder (feldliste) | `BuyFiat` | `subdomains/core/sell-crypto/process/buy-fiat.repository.ts:57` | `BuyFiatRepository.findSellHistory` |
| 13 | 0 | query-builder (nur-alias) | `Buy` | `subdomains/core/buy-crypto/routes/buy/buy.service.ts:228` | `BuyService.getBuyByKey` |
| 13 | 0 | find | `PaymentQuote` | `subdomains/core/payment-link/services/payment-quote.service.ts:76` | `PaymentQuoteService.processExpiredQuotes` |
| 13 | 0 | find | `PaymentQuote` | `subdomains/core/payment-link/services/payment-quote.service.ts:109` | `PaymentQuoteService.getActualQuoteByPaymentId` |
| 13 | 0 | find | `PaymentQuote` | `subdomains/core/payment-link/services/payment-quote.service.ts:157` | `PaymentQuoteService.cancelAllForPayment` |
| 13 | 0 | find | `KycStep` | `subdomains/generic/kyc/services/kyc.service.ts:147` | `KycService.checkIdentSteps` |
| 13 | 0 | find | `KycStep` | `subdomains/generic/kyc/services/kyc.service.ts:184` | `KycService.reviewNationalityStep` |
| 13 | 0 | find | `KycStep` | `subdomains/generic/kyc/services/kyc.service.ts:209` | `KycService.reviewIdentSteps` |
| 13 | 0 | find | `KycStep` | `subdomains/generic/kyc/services/kyc.service.ts:319` | `KycService.reviewFinancialData` |
| 13 | 0 | find | `KycStep` | `subdomains/generic/kyc/services/kyc.service.ts:371` | `KycService.reviewRecommendationStep` |
| 13 | 0 | find | `KycStep` | `subdomains/generic/kyc/services/kyc.service.ts:441` | `KycService.checkDfxApproval` |
| 13 | 0 | find | `KycStep` | `subdomains/generic/kyc/services/kyc.service.ts:1497` | `KycService.getStepsByUserData` |
| 13 | 0 | find | `TfaLog` | `subdomains/generic/kyc/services/tfa.service.ts:195` | `TfaService.checkVerification` |
| 13 | 0 | find | `Bank` | `subdomains/supporting/bank/bank/bank.service.ts:63` | `BankService.getBankInternal` |
| 13 | 0 | find | `Bank` | `subdomains/supporting/bank/bank/bank.service.ts:68` | `BankService.getBankById` |
| 13 | 0 | find | `Bank` | `subdomains/supporting/bank/bank/bank.service.ts:72` | `BankService.getBankByIdUncached` |
| 13 | 0 | find | `Bank` | `subdomains/supporting/bank/bank/bank.service.ts:76` | `BankService.getBankByIban` |
| 13 | 0 | find | `Bank` | `subdomains/supporting/bank/bank/bank.service.ts:80` | `BankService.getReceiveBanks` |
| 13 | 0 | find | `Bank` | `subdomains/supporting/bank/bank/bank.service.ts:84` | `BankService.getSenderBanks` |
| 13 | 0 | find | `Notification` | `subdomains/supporting/notification/services/notification-job.service.ts:38` | `NotificationJobService.resendUncompletedMails` |
| 13 | 0 | find | `Notification` | `subdomains/supporting/notification/services/notification.service.ts:49` | `NotificationService.getMails` |
| 13 | 0 | find | `Notification` | `subdomains/supporting/notification/services/notification.service.ts:107` | `NotificationService.isSuppressed` |
| 13 | 0 | find | `TransactionRiskAssessment` | `subdomains/supporting/payment/services/transaction-risk-assessment.service.ts:20` | `TransactionRiskAssessmentService.update` |
| 12 | 0 | find | `IpLog` | `shared/models/ip-log/ip-log.service.ts:66` | `IpLogService.getByUserDataId` |
| 12 | 0 | find | `IpLog` | `shared/models/ip-log/ip-log.service.ts:75` | `IpLogService.getLoginCountries` |
| 12 | 0 | find | `IpLog` | `shared/models/ip-log/ip-log.service.ts:119` | `IpLogService.updateUserIpLogs` |
| 12 | 0 | query-builder (feldliste) | `BuyCrypto` | `subdomains/core/buy-crypto/process/repositories/buy-crypto.repository.ts:77` | `BuyCryptoRepository.findBuyHistory` |
| 12 | 0 | query-builder (feldliste) | `BuyCrypto` | `subdomains/core/buy-crypto/process/repositories/buy-crypto.repository.ts:91` | `BuyCryptoRepository.findSwapHistory` |
| 11 | 0 | find | `OlkyRecipient` | `integration/bank/services/olkypay.service.ts:104` | `OlkypayService.getOrCreateRecipient` |
| 11 | 0 | query-builder (ohne-select) | `LedgerLeg` | `subdomains/core/accounting/services/ledger-query.service.ts:125` | `LedgerQueryService.getAccountDetail` |
| 11 | 0 | find | `Log` | `subdomains/supporting/log/log.repository.ts:119` | `LogRepository.getFinancialLogAt` |
| 11 | 0 | find | `Log` | `subdomains/supporting/log/log.repository.ts:132` | `LogRepository.getLatestFinancialLog` |
| 11 | 0 | find | `Log` | `subdomains/supporting/log/log.repository.ts:142` | `LogRepository.getLatestValidFinancialLogs` |
| 11 | 0 | find | `Log` | `subdomains/supporting/log/log.repository.ts:150` | `LogRepository.getLatestFinancialChangesLog` |
| 11 | 0 | find | `Log` | `subdomains/supporting/log/log.repository.ts:187` | `LogRepository.getFinancialChangesLogs` |
| 11 | 0 | find | `Log` | `subdomains/supporting/log/log.service.ts:51` | `LogService.update` |
| 11 | 0 | find | `Log` | `subdomains/supporting/log/log.service.ts:131` | `LogService.getLog` |
| 11 | 0 | find | `Log` | `subdomains/supporting/log/log.service.ts:135` | `LogService.maxEntity` |
| 11 | 0 | query-builder (ohne-select) | `Log` | `subdomains/supporting/log/log.service.ts:191` | `LogService.getBankLog` |
| 11 | 0 | query-builder (feldliste) | `SupportIssue` | `subdomains/supporting/support-issue/repositories/support-issue.repository.ts:346` | `SupportIssueRepository.findIssuesForAccount` |
| 11 | 0 | query-builder (feldliste) | `SupportIssue` | `subdomains/supporting/support-issue/repositories/support-issue.repository.ts:364` | `SupportIssueRepository.findIssueBy` |
| 10 | 0 | query-builder (feldliste) | `LedgerLeg` | `subdomains/core/accounting/repositories/ledger-leg.repository.ts:55` | `LedgerLegRepository.findSuspenseLegs` |
| 10 | 0 | find | `AccountMerge` | `subdomains/generic/user/models/account-merge/account-merge.service.ts:61` | `AccountMergeService.sendMergeRequest` |
| 10 | 0 | find | `AccountMerge` | `subdomains/generic/user/models/account-merge/account-merge.service.ts:162` | `AccountMergeService.pendingMergeRequest` |
| 10 | 0 | query-builder (feldliste) | `SupportIssue` | `subdomains/supporting/support-issue/repositories/support-issue.repository.ts:271` | `SupportIssueRepository.findIssueList` |
| 9 | 0 | find | `SupportNote` | `subdomains/generic/support/services/support-note.service.ts:57` | `SupportNoteService.search` |
| 9 | 0 | find | `SupportNote` | `subdomains/generic/support/services/support-note.service.ts:76` | `SupportNoteService.search` |
| 9 | 0 | find | `SupportNote` | `subdomains/generic/support/services/support-note.service.ts:152` | `SupportNoteService.delete` |
| 9 | 0 | query-builder (spaltenliste) | `—` | `subdomains/generic/user/models/user-data/user-data.service.ts:1214` | `UserDataService.updateVolumes` |
| 9 | 0 | find | `TransactionSpecification` | `subdomains/supporting/payment/services/transaction-helper.ts:92` | `TransactionHelper.updateCache` |
| 8 | 0 | find | `LedgerAccount` | `subdomains/core/accounting/services/ledger-account.service.ts:12` | `LedgerAccountService.findByName` |
| 8 | 0 | find | `LedgerAccount` | `subdomains/core/accounting/services/ledger-account.service.ts:16` | `LedgerAccountService.findByAssetId` |
| 8 | 0 | find | `LedgerAccount` | `subdomains/core/accounting/services/ledger-mark-to-market.service.ts:122` | `LedgerMarkToMarketService.selectCandidates` |
| 8 | 0 | find | `LedgerAccount` | `subdomains/core/accounting/services/ledger-query.service.ts:114` | `LedgerQueryService.getAccountDetail` |
| 8 | 0 | find | `CustodyAccountAccess` | `subdomains/core/custody/services/custody-account.service.ts:149` | `CustodyAccountService.checkAccess` |
| 8 | 0 | find | `CustodyAccountAccess` | `subdomains/core/custody/services/custody-account.service.ts:418` | `CustodyAccountService.requireActingAllowed` |
| 8 | 0 | find | `SupportIssueTemplate` | `subdomains/generic/support/services/support-issue-template.service.ts:28` | `SupportIssueTemplateService.search` |
| 8 | 0 | find | `SupportIssueTemplate` | `subdomains/generic/support/services/support-issue-template.service.ts:31` | `SupportIssueTemplateService.search` |
| 8 | 0 | find | `SupportIssueTemplate` | `subdomains/generic/support/services/support-issue-template.service.ts:58` | `SupportIssueTemplateService.update` |
| 8 | 0 | find | `SupportIssueTemplate` | `subdomains/generic/support/services/support-issue-template.service.ts:76` | `SupportIssueTemplateService.delete` |
| 7 | 0 | find | `Language` | `shared/models/language/language.service.ts:11` | `LanguageService.getAllLanguage` |
| 7 | 0 | find | `Language` | `shared/models/language/language.service.ts:15` | `LanguageService.getLanguage` |
| 7 | 0 | find | `Language` | `shared/models/language/language.service.ts:19` | `LanguageService.getLanguageBySymbol` |
| 7 | 0 | find | `Language` | `shared/models/language/language.service.ts:24` | `LanguageService.getLanguageByCountry` |
| 7 | 0 | query-builder (feldliste) | `PaymentLink` | `subdomains/core/payment-link/repositories/payment-link.repository.ts:66` | `PaymentLinkRepository.findForPosLink` |
| 7 | 0 | find | `UserDataRelation` | `subdomains/generic/user/models/user-data-relation/user-data-relation.service.ts:40` | `UserDataRelationService.updateUserDataRelation` |
| 7 | 0 | query-builder (feldliste) | `Wallet` | `subdomains/generic/user/models/wallet/wallet.repository.ts:48` | `WalletRepository.findKycData` |
| 7 | 0 | find | `SpecialExternalAccount` | `subdomains/supporting/payment/services/special-external-account.service.ts:12` | `SpecialExternalAccountService.createSpecialExternalAccount` |
| 7 | 0 | find | `SpecialExternalAccount` | `subdomains/supporting/payment/services/special-external-account.service.ts:24` | `SpecialExternalAccountService.getMultiAccounts` |
| 7 | 0 | find | `SpecialExternalAccount` | `subdomains/supporting/payment/services/special-external-account.service.ts:48` | `SpecialExternalAccountService.getPhoneCallList` |
| 7 | 0 | find | `SpecialExternalAccount` | `subdomains/supporting/payment/services/special-external-account.service.ts:58` | `SpecialExternalAccountService.getBlacklist` |
| 7 | 0 | find | `AssetPrice` | `subdomains/supporting/pricing/services/asset-prices-job.service.ts:81` | `AssetPricesJobService.saveAssetPrices` |
| 7 | 0 | find | `RealUnitLegalAcceptance` | `subdomains/supporting/realunit/realunit-legal.service.ts:57` | `RealUnitLegalService.getLatestAcceptance` |
| 6 | 0 | query-builder (spaltenliste) | `LedgerLeg` | `subdomains/core/accounting/services/ledger-mark-to-market.service.ts:173` | `LedgerMarkToMarketService.accountBalance` |
| 6 | 0 | query-builder (spaltenliste) | `LedgerLeg` | `subdomains/core/accounting/services/ledger-reconciliation.service.ts:517` | `LedgerReconciliationService.nativeBalanceByAccount` |
| 6 | 0 | find | `Ref` | `subdomains/core/referral/process/ref.repository.ts:13` | `RefRepository.getAndRemove` |
| 6 | 0 | find | `Ref` | `subdomains/core/referral/process/ref.service.ts:22` | `RefService.checkRefs` |
| 6 | 0 | find | `Ref` | `subdomains/core/referral/process/ref.service.ts:28` | `RefService.addOrUpdate` |
| 6 | 0 | find | `CustodyProvider` | `subdomains/generic/user/models/custody-provider/custody-provider.service.ts:17` | `CustodyProviderService.updateCustodyProvider` |
| 6 | 0 | find | `CustodyProvider` | `subdomains/generic/user/models/custody-provider/custody-provider.service.ts:26` | `CustodyProviderService.getWithMasterKey` |
| 6 | 0 | find | `Deposit` | `subdomains/supporting/address-pool/deposit/deposit.service.ts:63` | `DepositService.getDeposit` |
| 6 | 0 | find | `Deposit` | `subdomains/supporting/address-pool/deposit/deposit.service.ts:67` | `DepositService.getDepositByAddress` |
| 6 | 0 | find | `Deposit` | `subdomains/supporting/address-pool/deposit/deposit.service.ts:71` | `DepositService.getAllDeposits` |
| 6 | 0 | find | `Deposit` | `subdomains/supporting/address-pool/deposit/deposit.service.ts:75` | `DepositService.getDepositsByBlockchain` |
| 6 | 0 | find | `Deposit` | `subdomains/supporting/address-pool/deposit/deposit.service.ts:79` | `DepositService.getDepositByBlockchainAndIndex` |
| 6 | 0 | find | `Deposit` | `subdomains/supporting/address-pool/deposit/deposit.service.ts:83` | `DepositService.getUsedDepositsByBlockchain` |
| 6 | 0 | query-builder (ohne-select) | `Deposit` | `subdomains/supporting/address-pool/deposit/deposit.service.ts:89` | `DepositService.getNextDeposit` |
| 5 | 0 | find | `Setting` | `shared/models/setting/setting.repository.ts:36` | `SettingRepository.getStatusSettings` |
| 5 | 0 | find | `Setting` | `shared/models/setting/setting.service.ts:16` | `SettingService.getAll` |
| 5 | 0 | find | `Setting` | `shared/models/setting/setting.service.ts:26` | `SettingService.get` |
| 5 | 0 | find | `Setting` | `shared/models/setting/setting.service.ts:32` | `SettingService.set` |
| 5 | 0 | find | `Setting` | `shared/models/setting/setting.service.ts:202` | `SettingService.getObj` |
| 5 | 0 | find | `Setting` | `shared/models/setting/setting.service.ts:206` | `SettingService.getObjCached` |
| 5 | 0 | find | `Setting` | `shared/models/setting/setting.service.ts:210` | `SettingService.setObj` |
| 5 | 0 | find | `Sanction` | `subdomains/core/aml/services/sanction.service.ts:54` | `SanctionService.syncList` |
| 5 | 0 | query-builder (spaltenliste) | `SupportNote` | `subdomains/generic/support/services/support-note.service.ts:84` | `SupportNoteService.listUsers` |
| 5 | 0 | query-builder (feldliste) | `SupportMessage` | `subdomains/supporting/support-issue/repositories/support-message.repository.ts:61` | `SupportMessageRepository.findThread` |
| 4 | 0 | query-builder (spaltenliste) | `LedgerLeg` | `subdomains/core/accounting/services/ledger-query.service.ts:460` | `LedgerQueryService.marginBuckets` |
| 4 | 0 | query-builder (spaltenliste) | `LedgerLeg` | `subdomains/core/accounting/services/ledger-query.service.ts:534` | `LedgerQueryService.cumulativeEquityByDay` |
| 4 | 0 | find | `SystemStateSnapshot` | `subdomains/core/monitoring/monitoring.service.ts:47` | `MonitoringService.loadState` |
| 3 | 0 | query-builder (spaltenliste) | `LedgerLeg` | `subdomains/core/accounting/services/ledger-query.service.ts:278` | `LedgerQueryService.balancesByAccount` |
| 3 | 0 | query-builder (spaltenliste) | `LedgerLeg` | `subdomains/core/accounting/services/ledger-reconciliation.service.ts:271` | `LedgerReconciliationService.checkTransitAge` |
| 3 | 0 | query-builder (spaltenliste) | `LedgerLeg` | `subdomains/core/accounting/services/ledger-reconciliation.service.ts:347` | `LedgerReconciliationService.openResidualSince` |
| 3 | 0 | query-builder (spaltenliste) | `BuyCrypto` | `subdomains/core/buy-crypto/process/services/buy-crypto.service.ts:1051` | `BuyCryptoService.updateBuyVolume` |
| 3 | 0 | query-builder (spaltenliste) | `BuyCrypto` | `subdomains/core/buy-crypto/process/services/buy-crypto.service.ts:1079` | `BuyCryptoService.updateCryptoRouteVolume` |
| 3 | 0 | query-builder (spaltenliste) | `Buy` | `subdomains/core/buy-crypto/routes/buy/buy.service.ts:101` | `BuyService.getUserVolume` |
| 3 | 0 | query-builder (spaltenliste) | `Swap` | `subdomains/core/buy-crypto/routes/swap/swap.service.ts:123` | `SwapService.getUserVolume` |
| 3 | 0 | query-builder (spaltenliste) | `CustodyOrder` | `subdomains/core/custody/services/custody.service.ts:677` | `CustodyService.getHistoricalBalances` |
| 3 | 0 | query-builder (spaltenliste) | `CustodyOrder` | `subdomains/core/custody/services/custody.service.ts:689` | `CustodyService.getHistoricalBalances` |
| 3 | 0 | query-builder (spaltenliste) | `RefReward` | `subdomains/core/referral/reward/services/ref-reward.service.ts:278` | `RefRewardService.getRewardRecipients` |
| 3 | 0 | query-builder (spaltenliste) | `Sell` | `subdomains/core/sell-crypto/process/services/buy-fiat-registration.service.ts:97` | `BuyFiatRegistrationService.filterSellPayIns` |
| 3 | 0 | query-builder (spaltenliste) | `BuyFiat` | `subdomains/core/sell-crypto/process/services/buy-fiat.service.ts:678` | `BuyFiatService.updateSellVolume` |
| 3 | 0 | query-builder (spaltenliste) | `Sell` | `subdomains/core/sell-crypto/route/sell.service.ts:261` | `SellService.getUserVolume` |
| 3 | 0 | query-builder (spaltenliste) | `KycStep` | `subdomains/generic/kyc/services/kyc.service.ts:1981` | `KycService.getPendingReviewSummary` |
| 3 | 0 | query-builder (feldliste) | `UserData` | `subdomains/generic/user/models/user-data/user-data.repository.ts:240` | `UserDataRepository.getForApiKey` |
| 3 | 0 | query-builder (spaltenliste) | `BankTx` | `subdomains/supporting/bank-tx/bank-tx/services/bank-tx.service.ts:461` | `BankTxService.getBankTxFee` |
| 3 | 0 | query-builder (spaltenliste) | `SupportMessage` | `subdomains/supporting/support-issue/services/support-escalation.service.ts:310` | `SupportEscalationService.getLastMessages` |
| 3 | 0 | query-builder (spaltenliste) | `SupportIssue` | `subdomains/supporting/support-issue/services/support-issue.service.ts:245` | `SupportIssueService.getSupportIssueStatistics` |
| 2 | 0 | query-builder (spaltenliste) | `LedgerLeg` | `subdomains/core/accounting/services/ledger-query.service.ts:320` | `LedgerQueryService.nativeBalanceByAccount` |
| 2 | 0 | query-builder (spaltenliste) | `LedgerLeg` | `subdomains/core/accounting/services/ledger-reconciliation.service.ts:400` | `LedgerReconciliationService.checkSuspense` |
| 2 | 0 | query-builder (spaltenliste) | `BuyCrypto` | `subdomains/core/buy-crypto/process/services/buy-crypto.service.ts:1122` | `BuyCryptoService.getRefVolume` |
| 2 | 0 | query-builder (spaltenliste) | `BuyCrypto` | `subdomains/core/buy-crypto/process/services/buy-crypto.service.ts:1134` | `BuyCryptoService.getPartnerFeeRefVolume` |
| 2 | 0 | query-builder (feldliste) | `LiquidityManagementPipeline` | `subdomains/core/liquidity-management/repositories/liquidity-management-pipeline.repository.ts:43` | `LiquidityManagementPipelineRepository.findForStatus` |
| 2 | 0 | query-builder (spaltenliste) | `—` | `subdomains/core/monitoring/observers/payment.observer.ts:72` | `PaymentObserver.getPayment` |
| 2 | 0 | query-builder (spaltenliste) | `BuyFiat` | `subdomains/core/sell-crypto/process/services/buy-fiat.service.ts:721` | `BuyFiatService.getRefVolume` |
| 2 | 0 | query-builder (spaltenliste) | `BuyFiat` | `subdomains/core/sell-crypto/process/services/buy-fiat.service.ts:733` | `BuyFiatService.getPartnerFeeRefVolume` |
| 2 | 0 | query-builder (spaltenliste) | `TradingOrder` | `subdomains/core/trading/services/trading-order.service.ts:53` | `TradingOrderService.getTradingOrderYield` |
| 2 | 0 | query-builder (spaltenliste) | `—` | `subdomains/generic/gs/gs.service.ts:868` | `GsService.getExtendedBankTxData` |
| 2 | 0 | query-builder (spaltenliste) | `—` | `subdomains/generic/gs/gs.service.ts:887` | `GsService.getExtendedBankTxData` |
| 2 | 0 | query-builder (spaltenliste) | `BankData` | `subdomains/generic/user/models/bank-data/bank-data.service.ts:493` | `BankDataService.getPendingReviewSummary` |
| 2 | 0 | query-builder (spaltenliste) | `Recommendation` | `subdomains/generic/user/models/recommendation/recommendation.service.ts:354` | `RecommendationService.countByRecommenderIds` |
| 2 | 0 | query-builder (spaltenliste) | `Recommendation` | `subdomains/generic/user/models/recommendation/recommendation.service.ts:369` | `RecommendationService.countByRecommendedIds` |
| 2 | 0 | query-builder (feldliste) | `User` | `subdomains/generic/user/models/user/user.repository.ts:47` | `UserRepository.findAccountIdForAddress` |
| 2 | 0 | query-builder (spaltenliste) | `User` | `subdomains/generic/user/models/user/user.service.ts:226` | `UserService.countRefChildrenByUserDataIds` |
| 2 | 0 | query-builder (spaltenliste) | `User` | `subdomains/generic/user/models/user/user.service.ts:248` | `UserService.countRefReferrersByUserDataIds` |
| 2 | 0 | query-builder (spaltenliste) | `BankTx` | `subdomains/supporting/bank-tx/bank-tx/services/bank-tx.service.ts:505` | `BankTxService.getBankTxFee` |
| 2 | 0 | query-builder (feldliste) | `Log` | `subdomains/supporting/log/log.repository.ts:699` | `LogRepository.getFinancialLogValidityChangeSet` |
| 2 | 0 | query-builder (spaltenliste) | `Transaction` | `subdomains/supporting/payment/services/transaction.service.ts:324` | `TransactionService.getManualRefVolume` |
| 2 | 0 | query-builder (spaltenliste) | `Transaction` | `subdomains/supporting/payment/services/transaction.service.ts:353` | `TransactionService.getAuditPeriodVolumes` |
| 2 | 0 | query-builder (spaltenliste) | `SupportMessage` | `subdomains/supporting/support-issue/repositories/support-message.repository.ts:96` | `SupportMessageRepository.findStatsFor` |
| 2 | 0 | query-builder (spaltenliste) | `SupportIssue` | `subdomains/supporting/support-issue/services/support-issue.service.ts:109` | `SupportIssueService.getSupportIssueCounts` |
| 2 | 0 | query-builder (spaltenliste) | `SupportMessage` | `subdomains/supporting/support-issue/services/support-issue.service.ts:133` | `SupportIssueService.getSupportIssueActivity` |
| 2 | 0 | query-builder (spaltenliste) | `SupportIssue` | `subdomains/supporting/support-issue/services/support-issue.service.ts:198` | `SupportIssueService.getSupportIssueStatistics` |
| 1 | 0 | query-builder (spaltenliste) | `Asset` | `shared/models/asset/asset.service.ts:140` | `AssetService.getAssetsUsedOn` |
| 1 | 0 | query-builder (spaltenliste) | `IpLog` | `shared/models/ip-log/ip-log.service.ts:79` | `IpLogService.getLoginCountries` |
| 1 | 0 | query-builder (spaltenliste) | `IpLog` | `shared/models/ip-log/ip-log.service.ts:92` | `IpLogService.getUserDataIdsWith` |
| 1 | 0 | query-builder (spaltenliste) | `IpLog` | `shared/models/ip-log/ip-log.service.ts:103` | `IpLogService.getUserDataIdsWith` |
| 1 | 0 | query-builder (spaltenliste) | `—` | `subdomains/core/accounting/services/ledger-booking.service.ts:335` | `LedgerBookingService.nextSeqFrom` |
| 1 | 0 | query-builder (spaltenliste) | `—` | `subdomains/core/accounting/services/ledger-cutover.service.ts:958` | `LedgerCutoverService.maxSettledId` |
| 1 | 0 | query-builder (spaltenliste) | `—` | `subdomains/core/accounting/services/ledger-cutover.service.ts:1002` | `LedgerCutoverService.idsUpToBoundary` |
| 1 | 0 | query-builder (spaltenliste) | `LedgerLeg` | `subdomains/core/accounting/services/ledger-mark-to-market.service.ts:106` | `LedgerMarkToMarketService.selectCandidates` |
| 1 | 0 | query-builder (spaltenliste) | `LedgerLeg` | `subdomains/core/accounting/services/ledger-query.service.ts:292` | `LedgerQueryService.nativeBalanceBefore` |
| 1 | 0 | query-builder (spaltenliste) | `LedgerLeg` | `subdomains/core/accounting/services/ledger-query.service.ts:304` | `LedgerQueryService.nativeBalanceInPeriod` |
| 1 | 0 | query-builder (spaltenliste) | `LedgerLeg` | `subdomains/core/accounting/services/ledger-reconciliation.service.ts:487` | `LedgerReconciliationService.journalEquity` |
| 1 | 0 | query-builder (spaltenliste) | `BuyCrypto` | `subdomains/core/buy-crypto/process/services/buy-crypto.service.ts:767` | `BuyCryptoService.updateRefVolumes` |
| 1 | 0 | query-builder (spaltenliste) | `BuyCrypto` | `subdomains/core/buy-crypto/process/services/buy-crypto.service.ts:883` | `BuyCryptoService.getUserVolumeForType` |
| 1 | 0 | query-builder (spaltenliste) | `BuyCrypto` | `subdomains/core/buy-crypto/process/services/buy-crypto.service.ts:955` | `BuyCryptoService.getPendingLiquidityDemandChf` |
| 1 | 0 | query-builder (spaltenliste) | `Buy` | `subdomains/core/buy-crypto/routes/buy/buy.service.ts:111` | `BuyService.getTotalVolume` |
| 1 | 0 | query-builder (spaltenliste) | `Swap` | `subdomains/core/buy-crypto/routes/swap/swap.service.ts:133` | `SwapService.getTotalVolume` |
| 1 | 0 | query-builder (spaltenliste) | `CustodyOrder` | `subdomains/core/custody/services/custody.service.ts:221` | `CustodyService.updateCustodyBalance` |
| 1 | 0 | query-builder (spaltenliste) | `CustodyOrder` | `subdomains/core/custody/services/custody.service.ts:229` | `CustodyService.updateCustodyBalance` |
| 1 | 0 | query-builder (spaltenliste) | `—` | `subdomains/core/monitoring/observers/bank.observer.ts:117` | `BankObserver.getDbBalance` |
| 1 | 0 | query-builder (spaltenliste) | `RefReward` | `subdomains/core/referral/reward/services/ref-reward.service.ts:216` | `RefRewardService.getRefRewardVolume` |
| 1 | 0 | query-builder (spaltenliste) | `RefReward` | `subdomains/core/referral/reward/services/ref-reward.service.ts:249` | `RefRewardService.updatePaidRefCredit` |
| 1 | 0 | query-builder (spaltenliste) | `BuyFiat` | `subdomains/core/sell-crypto/process/services/buy-fiat.service.ts:586` | `BuyFiatService.updateRefVolumes` |
| 1 | 0 | query-builder (spaltenliste) | `BuyFiat` | `subdomains/core/sell-crypto/process/services/buy-fiat.service.ts:603` | `BuyFiatService.getUserVolume` |
| 1 | 0 | query-builder (spaltenliste) | `Sell` | `subdomains/core/sell-crypto/route/sell.service.ts:271` | `SellService.getTotalVolume` |
| 1 | 0 | query-builder (spaltenliste) | `TradingOrder` | `subdomains/core/trading/services/trading-rule.service.ts:35` | `TradingRuleService.getCurrentTradingOrders` |
| 1 | 0 | query-builder (ohne-select) | `—` | `subdomains/generic/gs/gs.service.ts:906` | `GsService.getExtendedBankTxData` |
| 1 | 0 | query-builder (spaltenliste) | `UserData` | `subdomains/generic/user/models/user-data/user-data.service.ts:179` | `UserDataService.getUserDataIdsByServiceProvider` |
| 1 | 0 | query-builder (spaltenliste) | `UserData` | `subdomains/generic/user/models/user-data/user-data.service.ts:1774` | `UserDataService.getMaxKycFileIdByDateRange` |
| 1 | 0 | query-builder (spaltenliste) | `User` | `subdomains/generic/user/models/user/user.service.ts:140` | `UserService.getAllLinkedUsers` |
| 1 | 0 | query-builder (spaltenliste) | `User` | `subdomains/generic/user/models/user/user.service.ts:195` | `UserService.getOpenRefCreditEur` |
| 1 | 0 | query-builder (spaltenliste) | `User` | `subdomains/generic/user/models/user/user.service.ts:576` | `UserService.getUserVolumes` |
| 1 | 0 | query-builder (spaltenliste) | `User` | `subdomains/generic/user/models/user/user.service.ts:586` | `UserService.getUserVolumes` |
| 1 | 0 | query-builder (spaltenliste) | `User` | `subdomains/generic/user/models/user/user.service.ts:648` | `UserService.getRefInfo` |
| 1 | 0 | query-builder (spaltenliste) | `User` | `subdomains/generic/user/models/user/user.service.ts:661` | `UserService.getRefInfo` |
| 1 | 0 | query-builder (spaltenliste) | `User` | `subdomains/generic/user/models/user/user.service.ts:720` | `UserService.getTotalRefRewards` |
| 1 | 0 | query-builder (spaltenliste) | `Deposit` | `subdomains/supporting/address-pool/deposit/deposit.service.ts:189` | `DepositService.getNextDepositIndex` |
| 1 | 0 | query-builder (spaltenliste) | `BankTx` | `subdomains/supporting/bank-tx/bank-tx/services/bank-tx.service.ts:449` | `BankTxService.getBankTxFee` |
| 1 | 0 | query-builder (spaltenliste) | `Log` | `subdomains/supporting/log/log.repository.ts:97` | `LogRepository.cleanup` |
| 1 | 0 | query-builder (spaltenliste) | `Log` | `subdomains/supporting/log/log.repository.ts:104` | `LogRepository.cleanup` |
| 1 | 0 | query-builder (spaltenliste) | `Log` | `subdomains/supporting/log/log.repository.ts:158` | `LogRepository.getFinancialChangesLogs` |
| 1 | 0 | query-builder (ohne-select) | `Log` | `subdomains/supporting/log/log.repository.ts:165` | `LogRepository.getFinancialChangesLogs` |
| 1 | 0 | query-builder (spaltenliste) | `Log` | `subdomains/supporting/log/log.repository.ts:206` | `LogRepository.getFinancialLogs` |
| 1 | 0 | query-builder (ohne-select) | `Log` | `subdomains/supporting/log/log.repository.ts:214` | `LogRepository.getFinancialLogs` |
| 1 | 0 | query-builder (ohne-select) | `Log` | `subdomains/supporting/log/log.repository.ts:244` | `LogRepository.getFinancialLogs` |
| 1 | 0 | query-builder (spaltenliste) | `—` | `subdomains/supporting/payin/services/payin.service.ts:217` | `PayInService.getPayInFee` |
| 1 | 0 | query-builder (spaltenliste) | `TransactionRequest` | `subdomains/supporting/payment/services/transaction-request.service.ts:352` | `TransactionRequestService.getLegacySettlementTxIds` |
| 1 | 0 | query-builder (spaltenliste) | `TransactionRequest` | `subdomains/supporting/payment/services/transaction-request.service.ts:406` | `TransactionRequestService.getActiveDepositAddresses` |
| 1 | 0 | query-builder (spaltenliste) | `SupportIssue` | `subdomains/supporting/support-issue/services/support-issue.service.ts:177` | `SupportIssueService.getSupportIssueStatistics` |
| 1 | 0 | query-builder (spaltenliste) | `SupportMessage` | `subdomains/supporting/support-issue/services/support-issue.service.ts:186` | `SupportIssueService.getSupportIssueStatistics` |
| — | — | find | `—` | `config/config.ts:1347` | `Configuration.isDomesticIban` |
| — | — | find | `—` | `integration/binance-pay/services/binance-pay.service.ts:271` | `BinancePayService.verifySignature` |
| — | — | find | `—` | `integration/blockchain/api/services/blockchain-balance.service.ts:52` | `BlockchainBalanceService.getSolanaBalances` |
| — | — | find | `—` | `integration/blockchain/api/services/blockchain-balance.service.ts:79` | `BlockchainBalanceService.getTronBalances` |
| — | — | find | `—` | `integration/blockchain/api/services/blockchain-balance.service.ts:115` | `BlockchainBalanceService.getEvmBalances` |
| — | — | find | `—` | `integration/blockchain/api/services/blockchain-balance.service.ts:132` | `BlockchainBalanceService.getEvmBalances` |
| — | — | find | `—` | `integration/blockchain/cardano/cardano-client.ts:81` | `CardanoClient.getNativeCoinBalanceForAddress` |
| — | — | find | `—` | `integration/blockchain/cardano/cardano-client.ts:100` | `CardanoClient.getTokenBalances` |
| — | — | find | `—` | `integration/blockchain/icp/icp-client.ts:231` | `InternetComputerClient.getNativeTransfersForAddress` |
| — | — | find | `—` | `integration/blockchain/icp/icp-client.ts:232` | `InternetComputerClient.getNativeTransfersForAddress` |
| — | — | find | `—` | `integration/blockchain/shared/evm/citrea-base-client.ts:248` | `CitreaBaseClient.swapViaGateway` |
| — | — | find | `—` | `integration/blockchain/shared/evm/citrea-base-client.ts:353` | `CitreaBaseClient.getTokenPairByAddresses` |
| — | — | find | `—` | `integration/blockchain/shared/evm/evm-client.ts:681` | `EvmClient.poolQuote` |
| — | — | find | `—` | `integration/blockchain/shared/evm/evm-client.ts:704` | `EvmClient.getSwapResultBaseUnits` |
| — | — | find | `—` | `integration/blockchain/shared/evm/evm-decimals.service.ts:24` | `EvmDecimalsService.setDecimals` |
| — | — | find | `—` | `integration/blockchain/solana/solana-client.ts:530` | `SolanaClient.updateTokenInstruction` |
| — | — | find | `—` | `integration/blockchain/solana/solana-client.ts:531` | `SolanaClient.updateTokenInstruction` |
| — | — | find | `—` | `integration/blockchain/tron/tron-client.ts:51` | `TronClient.getNativeCoinBalanceForAddress` |
| — | — | find | `—` | `integration/blockchain/zano/services/zano.service.ts:97` | `ZanoService.addAssetsToWhitelist` |
| — | — | find | `—` | `integration/blockchain/zano/services/zano.service.ts:98` | `ZanoService.addAssetsToWhitelist` |
| — | — | find | `—` | `integration/blockchain/zano/zano-client.ts:185` | `ZanoClient.getTokenBalances` |
| — | — | find | `—` | `integration/exchange/controllers/exchange.controller.ts:93` | `ExchangeController.syncExchange` |
| — | — | find | `—` | `integration/exchange/services/exchange-tx.service.ts:304` | `ExchangeTxService.getTransactionsFor` |
| — | — | find | `—` | `integration/exchange/services/exchange.service.ts:228` | `ExchangeService.getWithdraw` |
| — | — | find | `—` | `integration/exchange/services/exchange.service.ts:284` | `ExchangeService.getMarket` |
| — | — | find | `—` | `integration/exchange/services/exchange.service.ts:297` | `ExchangeService.getTradePair` |
| — | — | find | `—` | `integration/exchange/services/exchange.service.ts:343` | `ExchangeService.getBestBidLiquidity` |
| — | — | find | `—` | `integration/exchange/services/exchange.service.ts:368` | `ExchangeService.trade` |
| — | — | find | `—` | `integration/exchange/services/mexc.service.ts:159` | `MexcService.getWithdraw` |
| — | — | find | `—` | `integration/exchange/services/scrypt.service.ts:402` | `ScryptService.withdrawFunds` |
| — | — | find | `—` | `integration/exchange/services/scrypt.service.ts:577` | `ScryptService.findWithdrawal` |
| — | — | find | `—` | `integration/exchange/services/scrypt.service.ts:600` | `ScryptService.getOrderStatus` |
| — | — | find | `—` | `integration/exchange/services/scrypt.service.ts:832` | `ScryptService.placeOrder` |
| — | — | find | `—` | `integration/exchange/services/scrypt.service.ts:862` | `ScryptService.cancelOrder` |
| — | — | find | `—` | `integration/exchange/services/scrypt.service.ts:895` | `ScryptService.editOrder` |
| — | — | find | `—` | `integration/exchange/services/scrypt.service.ts:914` | `ScryptService.getTradePair` |
| — | — | find | `—` | `integration/exchange/services/scrypt.service.ts:930` | `ScryptService.getSecurity` |
| — | — | find | `—` | `integration/lightning/lightning-helper.ts:134` | — |
| — | — | find | `—` | `integration/lightning/services/lightning.service.ts:196` | `LightningService.findPayment` |
| — | — | find | `—` | `shared/models/asset/asset.controller.ts:39` | `AssetController.getAllAsset` |
| — | — | find | `—` | `shared/models/asset/asset.service.ts:153` | `AssetService.getByQuerySync` |
| — | — | find | `—` | `shared/models/asset/asset.service.ts:157` | `AssetService.getByChainIdSync` |
| — | — | find | `—` | `shared/models/fiat/fiat.controller.ts:27` | `FiatController.getAllFiat` |
| — | — | find | `—` | `shared/models/fiat/fiat.service.ts:32` | `FiatService.getFiatByName` |
| — | — | find | `—` | `shared/models/ip-log/ip-log.service.ts:143` | `IpLogService.checkIpCountry` |
| — | — | find | `—` | `shared/models/setting/setting.repository.ts:20` | `SettingRepository.setDateMax` |
| — | — | find | `—` | `shared/models/setting/setting.service.ts:169` | `SettingService.updateCustomSignUpFees` |
| — | — | find | `—` | `shared/models/setting/setting.service.ts:198` | `SettingService.getCustomSignUpFees` |
| — | — | find | `—` | `shared/repositories/cached.repository.ts:16` | `CachedRepository.findOneCached` |
| — | — | find | `—` | `shared/repositories/cached.repository.ts:20` | `CachedRepository.findOneCachedBy` |
| — | — | find | `—` | `shared/repositories/cached.repository.ts:24` | `CachedRepository.findCached` |
| — | — | find | `—` | `shared/repositories/cached.repository.ts:28` | `CachedRepository.findCachedBy` |
| — | — | find | `—` | `shared/services/http.service.ts:84` | `HttpService.getMockResponse` |
| — | — | find | `—` | `shared/utils/util.ts:786` | `Util.clearTimeout` |
| — | — | find | `—` | `subdomains/core/accounting/services/consumers/bank-tx.consumer.ts:339` | `BankTxConsumer.cutoverOwedOpeningChf` |
| — | — | find | `—` | `subdomains/core/accounting/services/consumers/bank-tx.consumer.ts:567` | `BankTxConsumer.openingLiabilityLegChf` |
| — | — | find | `—` | `subdomains/core/accounting/services/consumers/bank-tx.consumer.ts:586` | `BankTxConsumer.cutoverOpeningLiabilityChf` |
| — | — | find | `—` | `subdomains/core/accounting/services/consumers/buy-crypto.consumer.ts:327` | `BuyCryptoConsumer.paymentLinkOpeningChf` |
| — | — | find | `—` | `subdomains/core/accounting/services/consumers/buy-fiat.consumer.ts:589` | `BuyFiatConsumer.cutoverOwedOpeningChf` |
| — | — | find | `—` | `subdomains/core/accounting/services/consumers/buy-fiat.consumer.ts:607` | `BuyFiatConsumer.paymentLinkOpeningChf` |
| — | — | find | `—` | `subdomains/core/accounting/services/consumers/buy-fiat.consumer.ts:625` | `BuyFiatConsumer.cutoverPaymentLinkOpeningChf` |
| — | — | find | `—` | `subdomains/core/accounting/services/consumers/ledger-watermark.helper.ts:225` | — |
| — | — | find | `—` | `subdomains/core/accounting/services/consumers/payout-order.consumer.ts:325` | `PayoutOrderConsumer.cutoverOwedOpeningChf` |
| — | — | find | `—` | `subdomains/core/accounting/services/ledger-booking.service.ts:257` | `LedgerBookingService.activeTx` |
| — | — | find | `—` | `subdomains/core/accounting/services/ledger-booking.service.ts:264` | `LedgerBookingService.activeTx` |
| — | — | find | `—` | `subdomains/core/accounting/services/ledger-booking.service.ts:268` | `LedgerBookingService.activeTx` |
| — | — | find | `—` | `subdomains/core/accounting/services/ledger-booking.service.ts:274` | `LedgerBookingService.activeTx` |
| — | — | query-builder (zaehlend) | `LedgerLeg` | `subdomains/core/accounting/services/ledger-mark-to-market.service.ts:212` | `LedgerMarkToMarketService.alreadyBooked` |
| — | — | find | `—` | `subdomains/core/aml/services/aml-helper.service.ts:375` | — |
| — | — | find | `—` | `subdomains/core/aml/services/aml-helper.service.ts:684` | — |
| — | — | find | `—` | `subdomains/core/aml/services/aml-helper.service.ts:685` | — |
| — | — | find | `—` | `subdomains/core/aml/services/aml-helper.service.ts:686` | — |
| — | — | find | `—` | `subdomains/core/aml/services/aml-helper.service.ts:700` | — |
| — | — | find | `—` | `subdomains/core/aml/services/aml.service.ts:132` | `AmlService.getAmlCheckInput` |
| — | — | find | `—` | `subdomains/core/aml/services/aml.service.ts:278` | `AmlService.getBankData` |
| — | — | find | `—` | `subdomains/core/buy-crypto/process/entities/buy-crypto.entity.ts:370` | `BuyCrypto.calculateOutputReferenceAmount` |
| — | — | find | `—` | `subdomains/core/buy-crypto/process/entities/buy-crypto.entity.ts:662` | `BuyCrypto.setFeeAndFiatReference` |
| — | — | find | `—` | `subdomains/core/buy-crypto/process/services/buy-crypto-batch.service.ts:242` | `BuyCryptoBatchService.filterOutExistingBatches` |
| — | — | find | `—` | `subdomains/core/buy-crypto/process/services/buy-crypto-registration.service.ts:93` | `BuyCryptoRegistrationService.findMatchingRoute` |
| — | — | find | `—` | `subdomains/core/buy-crypto/process/services/buy-crypto-registration.service.ts:95` | `BuyCryptoRegistrationService.findMatchingRoute` |
| — | — | find | `—` | `subdomains/core/buy-crypto/process/services/buy-crypto.service.ts:297` | `BuyCryptoService.update` |
| — | — | find | `—` | `subdomains/core/buy-crypto/process/services/buy-crypto.service.ts:1037` | `BuyCryptoService.getCryptoRoute` |
| — | — | find | `—` | `subdomains/core/custody/controllers/custody-account.controller.ts:66` | `CustodyAccountController.getCustodyAccount` |
| — | — | find | `—` | `subdomains/core/custody/controllers/custody-account.controller.ts:67` | `CustodyAccountController.getCustodyAccount` |
| — | — | query-builder (no select) | `—` | `subdomains/core/custody/services/custody-account.service.ts:482` | `CustodyAccountService.lockActiveAccessGrant` |
| — | — | find | `—` | `subdomains/core/custody/services/custody-account.service.ts:504` | `CustodyAccountService.createGrant` |
| — | — | find | `—` | `subdomains/core/custody/services/custody-account.service.ts:598` | `CustodyAccountService.grantAccessForLegacy` |
| — | — | find | `CustodyOrder` | `subdomains/core/custody/services/custody-job.service.ts:65` | `CustodyJobService.executeOrder` |
| — | — | find | `—` | `subdomains/core/custody/services/custody-order.service.ts:388` | `CustodyOrderService.checkBalance` |
| — | — | find | `—` | `subdomains/core/custody/services/custody.service.ts:307` | `CustodyService.getUserCustodyHistory` |
| — | — | find | `—` | `subdomains/core/history/mappers/transaction-dto.mapper.ts:211` | `TransactionDtoMapper.feeAmountType` |
| — | — | find | `—` | `subdomains/core/history/services/history-access.service.ts:122` | `HistoryAccessService.resolveFromApiKey` |
| — | — | find | `—` | `subdomains/core/history/services/history-access.service.ts:130` | `HistoryAccessService.findOwnedUser` |
| — | — | find | `—` | `subdomains/core/history/services/history.service.ts:169` | `HistoryService.getHistoryTransactions` |
| — | — | find | `—` | `subdomains/core/liquidity-management/adapters/actions/base/ccxt-exchange.adapter.ts:451` | `CcxtExchangeAdapter.checkTransferCompletion` |
| — | — | find | `—` | `subdomains/core/liquidity-management/adapters/actions/dfx-dex.adapter.ts:228` | `DfxDexAdapter.checkWithdrawCompletion` |
| — | — | find | `—` | `subdomains/core/liquidity-management/adapters/actions/layerzero-bridge.adapter.ts:124` | `LayerZeroBridgeAdapter.checkDepositCompletion` |
| — | — | find | `—` | `subdomains/core/liquidity-management/adapters/actions/layerzero-bridge.adapter.ts:190` | `LayerZeroBridgeAdapter.checkWithdrawCompletion` |
| — | — | find | `—` | `subdomains/core/liquidity-management/adapters/balances/bank.adapter.ts:38` | `BankAdapter.getBalances` |
| — | — | find | `—` | `subdomains/core/liquidity-management/adapters/balances/bank.adapter.ts:88` | `BankAdapter.getForBank` |
| — | — | find | `—` | `subdomains/core/liquidity-management/adapters/balances/bank.adapter.ts:92` | `BankAdapter.getForBank` |
| — | — | find | `—` | `subdomains/core/liquidity-management/adapters/balances/bank.adapter.ts:134` | `BankAdapter.getForBank` |
| — | — | find | `—` | `subdomains/core/liquidity-management/adapters/balances/exchange.adapter.ts:40` | `ExchangeAdapter.hasPendingOrders` |
| — | — | find | `—` | `subdomains/core/liquidity-management/services/liquidity-management-balance.service.ts:78` | `LiquidityManagementBalanceService.findRelevantBalance` |
| — | — | find | `—` | `subdomains/core/liquidity-management/services/liquidity-management-rule.service.ts:197` | `LiquidityManagementRuleService.confirmOrCreateActionTree` |
| — | — | find | `LiquidityManagementRule` | `subdomains/core/liquidity-management/services/liquidity-management.service.ts:42` | `LiquidityManagementService.checkLiquidityBalances` |
| — | — | find | `—` | `subdomains/core/liquidity-management/validators/liquidity-actions-all-steps-match.validator.ts:11` | `LiquidityActionsAllStepsMatchValidator.validate` |
| — | — | find | `—` | `subdomains/core/liquidity-management/validators/liquidity-actions-all-steps-match.validator.ts:12` | `LiquidityActionsAllStepsMatchValidator.validate` |
| — | — | find | `—` | `subdomains/core/monitoring/observers/node-health.observer.ts:131` | `NodeHealthObserver.getPoolState` |
| — | — | find | `—` | `subdomains/core/monitoring/observers/node-health.observer.ts:139` | `NodeHealthObserver.getNodeStateInPool` |
| — | — | find | `—` | `subdomains/core/monitoring/observers/payment.observer.ts:157` | `PaymentObserver.getLastOutputDates` |
| — | — | find | `—` | `subdomains/core/monitoring/observers/payment.observer.ts:160` | `PaymentObserver.getLastOutputDates` |
| — | — | find | `—` | `subdomains/core/payment-link/entities/payment-quote.entity.ts:116` | `PaymentQuote.getTransferAmount` |
| — | — | find | `—` | `subdomains/core/payment-link/entities/payment-quote.entity.ts:123` | `PaymentQuote.getTransferAmountFor` |
| — | — | find | `—` | `subdomains/core/payment-link/services/ocp-sticker.service.ts:206` | `OCPStickerService.generateBitcoinFocusStickersPdf` |
| — | — | find | `—` | `subdomains/core/payment-link/services/payment-activation.service.ts:118` | `PaymentActivationService.doCreateRequest` |
| — | — | find | `—` | `subdomains/core/payment-link/services/payment-balance.service.ts:93` | `PaymentBalanceService.getPaymentBalances` |
| — | — | find | `—` | `subdomains/core/payment-link/services/payment-balance.service.ts:108` | `PaymentBalanceService.getPaymentBalances` |
| — | — | find | `—` | `subdomains/core/payment-link/services/payment-link-payment.service.ts:179` | `PaymentLinkPaymentService.handleBinanceWaiting` |
| — | — | find | `—` | `subdomains/core/payment-link/services/payment-link-payment.service.ts:284` | `PaymentLinkPaymentService.cancelByLink` |
| — | — | find | `—` | `subdomains/core/payment-link/services/payment-link.service.ts:181` | `PaymentLinkService.createInvoice` |
| — | — | find | `—` | `subdomains/core/payment-link/services/payment-link.service.ts:633` | `PaymentLinkService.getPaymentLinkByAccessKey` |
| — | — | find | `—` | `subdomains/core/payment-link/services/payment-link.service.ts:643` | `PaymentLinkService.getPaymentLinkByAccessKey` |
| — | — | find | `—` | `subdomains/core/payment-link/services/payment-link.service.ts:663` | `PaymentLinkService.waitForPayment` |
| — | — | find | `—` | `subdomains/core/payment-link/services/payment-quote.service.ts:118` | `PaymentQuoteService.getActualQuoteByPaymentId` |
| — | — | find | `—` | `subdomains/core/payment-link/services/payment-quote.service.ts:503` | `PaymentQuoteService.validateEvmTx` |
| — | — | find | `—` | `subdomains/core/payment-link/services/payment-quote.service.ts:504` | `PaymentQuoteService.validateEvmTx` |
| — | — | find | `—` | `subdomains/core/payment-link/services/payment-quote.service.ts:552` | `PaymentQuoteService.async` |
| — | — | find | `—` | `subdomains/core/payment-link/services/payment-quote.service.ts:560` | `PaymentQuoteService.async` |
| — | — | find | `—` | `subdomains/core/payment-link/services/payment-quote.service.ts:704` | `PaymentQuoteService.doIcpPayment` |
| — | — | find | `—` | `subdomains/core/payment-link/services/payment-standard.service.ts:13` | `PaymentStandardService.getById` |
| — | — | find | `—` | `subdomains/core/sell-crypto/process/buy-fiat.entity.ts:367` | `BuyFiat.setFeeAndFiatReference` |
| — | — | find | `—` | `subdomains/core/sell-crypto/process/services/buy-fiat-registration.service.ts:124` | `BuyFiatRegistrationService.findMatchingRoute` |
| — | — | find | `—` | `subdomains/core/sell-crypto/process/services/buy-fiat-registration.service.ts:126` | `BuyFiatRegistrationService.findMatchingRoute` |
| — | — | find | `—` | `subdomains/core/sell-crypto/process/services/buy-fiat-registration.service.ts:128` | `BuyFiatRegistrationService.findMatchingRoute` |
| — | — | find | `—` | `subdomains/core/sell-crypto/process/services/buy-fiat.service.ts:205` | `BuyFiatService.update` |
| — | — | raw-sql | `—` | `subdomains/generic/gs/gs.service.ts:337` | `GsService.executeDebugQuery` |
| — | — | find | `—` | `subdomains/generic/gs/gs.service.ts:739` | `GsService.getParsedJsonData` |
| — | — | find | `—` | `subdomains/generic/gs/gs.service.ts:742` | `GsService.getParsedJsonData` |
| — | — | query-builder (ohne-select) | `—` | `subdomains/generic/gs/gs.service.ts:805` | `GsService.getRawDbData` |
| — | — | find | `—` | `subdomains/generic/kyc/dto/mapper/kyc-info.mapper.ts:35` | — |
| — | — | find | `—` | `subdomains/generic/kyc/dto/mapper/kyc-info.mapper.ts:36` | — |
| — | — | find | `—` | `subdomains/generic/kyc/dto/mapper/kyc-info.mapper.ts:125` | — |
| — | — | find | `—` | `subdomains/generic/kyc/dto/mapper/kyc-info.mapper.ts:126` | — |
| — | — | find | `—` | `subdomains/generic/kyc/dto/mapper/kyc-info.mapper.ts:135` | — |
| — | — | find | `—` | `subdomains/generic/kyc/enums/kyc.enum.ts:19` | — |
| — | — | find | `—` | `subdomains/generic/kyc/services/integration/financial.service.ts:39` | `FinancialService.getQuestions` |
| — | — | find | `—` | `subdomains/generic/kyc/services/kyc-admin.service.ts:41` | `KycAdminService.getKycSteps` |
| — | — | find | `—` | `subdomains/generic/kyc/services/kyc-client.service.ts:55` | `KycClientService.getAllUserPayments` |
| — | — | find | `—` | `subdomains/generic/kyc/services/kyc-client.service.ts:111` | `KycClientService.getFileFor` |
| — | — | find | `—` | `subdomains/generic/kyc/services/kyc.service.ts:218` | `KycService.reviewIdentSteps` |
| — | — | find | `—` | `subdomains/generic/kyc/services/kyc.service.ts:433` | `KycService.checkDfxApproval` |
| — | — | find | `—` | `subdomains/generic/kyc/services/kyc.service.ts:436` | `KycService.checkDfxApproval` |
| — | — | find | `—` | `subdomains/generic/kyc/services/kyc.service.ts:459` | `KycService.isKycStepUniqueViolation` |
| — | — | find | `—` | `subdomains/generic/kyc/services/kyc.service.ts:515` | `KycService.initializeProcess` |
| — | — | find | `—` | `subdomains/generic/kyc/services/kyc.service.ts:531` | `KycService.failContactStepForMail` |
| — | — | find | `—` | `subdomains/generic/kyc/services/kyc.service.ts:1174` | `KycService.getOrCreateStepInternal` |
| — | — | find | `—` | `subdomains/generic/kyc/services/kyc.service.ts:1200` | `KycService.getOrCreateStep` |
| — | — | find | `—` | `subdomains/generic/kyc/services/kyc.service.ts:1201` | `KycService.getOrCreateStep` |
| — | — | find | `—` | `subdomains/generic/kyc/services/kyc.service.ts:1295` | `KycService.getNext` |
| — | — | find | `—` | `subdomains/generic/kyc/services/kyc.service.ts:1358` | `KycService.initiateStep` |
| — | — | find | `—` | `subdomains/generic/kyc/services/kyc.service.ts:1465` | `KycService.completeReferencedSteps` |
| — | — | find | `—` | `subdomains/generic/kyc/services/kyc.service.ts:1777` | `KycService.getIdentCheckErrors` |
| — | — | find | `—` | `subdomains/generic/support/support-pdf.service.ts:332` | `SupportPdfService.createOnboardingPdf` |
| — | — | find | `—` | `subdomains/generic/support/support-pdf.service.ts:358` | `SupportPdfService.createOnboardingPdf` |
| — | — | find | `—` | `subdomains/generic/support/support-pdf.service.ts:370` | `SupportPdfService.createOnboardingPdf` |
| — | — | find | `—` | `subdomains/generic/support/support-pdf.service.ts:386` | `SupportPdfService.createOnboardingPdf` |
| — | — | find | `—` | `subdomains/generic/support/support.service.ts:1327` | `SupportService.getUniqueUserDataByKey` |
| — | — | find | `—` | `subdomains/generic/support/support.service.ts:1336` | `SupportService.getUniqueUserDataByKey` |
| — | — | find | `—` | `subdomains/generic/user/models/auth/auth.service.ts:497` | `AuthService.checkPendingRecommendation` |
| — | — | find | `—` | `subdomains/generic/user/models/auth/auth.service.ts:515` | `AuthService.confirmRecommendationCode` |
| — | — | find | `—` | `subdomains/generic/user/models/auth/auth.service.ts:530` | `AuthService.getLinkedUser` |
| — | — | find | `—` | `subdomains/generic/user/models/bank-data/bank-data.entity.ts:155` | `BankData.internalReview` |
| — | — | find | `—` | `subdomains/generic/user/models/bank-data/bank-data.service.ts:246` | `BankDataService.updateBankDataInternal` |
| — | — | find | `—` | `subdomains/generic/user/models/bank-data/bank-data.service.ts:338` | `BankDataService.getVerifiedBankDataWithIban` |
| — | — | find | `—` | `subdomains/generic/user/models/bank-data/bank-data.service.ts:339` | `BankDataService.getVerifiedBankDataWithIban` |
| — | — | find | `—` | `subdomains/generic/user/models/bank-data/bank-data.service.ts:340` | `BankDataService.getVerifiedBankDataWithIban` |
| — | — | find | `—` | `subdomains/generic/user/models/bank-data/bank-data.service.ts:362` | `BankDataService.getAllBankDatasForUser` |
| — | — | find | `—` | `subdomains/generic/user/models/bank-data/bank-data.service.ts:444` | `BankDataService.createIbanForUserInternal` |
| — | — | find | `Wallet` | `subdomains/generic/user/models/kyc/kyc.service.ts:57` | `KycService.transferKycData` |
| — | — | find | `—` | `subdomains/generic/user/models/kyc/kyc.service.ts:178` | `KycService.getFileFor` |
| — | — | find | `—` | `subdomains/generic/user/models/kyc/kyc.service.ts:185` | `KycService.getFileFor` |
| — | — | find | `—` | `subdomains/generic/user/models/recommendation/recommendation.service.ts:45` | `RecommendationService.createRecommendationByRecommender` |
| — | — | find | `—` | `subdomains/generic/user/models/recommendation/recommendation.service.ts:135` | `RecommendationService.handleRecommendationRequest` |
| — | — | find | `—` | `subdomains/generic/user/models/recommendation/recommendation.service.ts:246` | `RecommendationService.setRecommenderRefCode` |
| — | — | find | `—` | `subdomains/generic/user/models/user-data/user-data-job.service.ts:51` | `UserDataJobService.setAccountOpener` |
| — | — | find | `—` | `subdomains/generic/user/models/user-data/user-data.entity.ts:621` | `UserData.addPhoneCallExternalAccountCheckValue` |
| — | — | find | `—` | `subdomains/generic/user/models/user-data/user-data.entity.ts:722` | `UserData.getMailLoginUser` |
| — | — | find | `—` | `subdomains/generic/user/models/user-data/user-data.entity.ts:761` | `UserData.getStep` |
| — | — | find | `—` | `subdomains/generic/user/models/user-data/user-data.entity.ts:781` | `UserData.getPendingStepWith` |
| — | — | find | `—` | `subdomains/generic/user/models/user-data/user-data.entity.ts:785` | `UserData.getCompletedStepWith` |
| — | — | find | `—` | `subdomains/generic/user/models/user-data/user-data.entity.ts:789` | `UserData.getNonFailedStepWith` |
| — | — | find | `—` | `subdomains/generic/user/models/user-data/user-data.enum.ts:75` | — |
| — | — | find | `—` | `subdomains/generic/user/models/user-data/user-data.service.ts:867` | `UserDataService.checkMail` |
| — | — | find | `—` | `subdomains/generic/user/models/user-data/user-data.service.ts:1312` | `UserDataService.mergeUserData` |
| — | — | find | `—` | `subdomains/generic/user/models/user-data/user-data.service.ts:1324` | `UserDataService.mergeUserData` |
| — | — | find | `—` | `subdomains/generic/user/models/user-data/user-data.service.ts:1332` | `UserDataService.mergeUserData` |
| — | — | find | `—` | `subdomains/generic/user/models/user-data/user-data.service.ts:1344` | `UserDataService.mergeUserData` |
| — | — | find | `—` | `subdomains/generic/user/models/user-data/user-data.service.ts:1547` | `UserDataService.mergeUserData` |
| — | — | find | `—` | `subdomains/generic/user/models/user-data/user-data.service.ts:1725` | `UserDataService.updateBankTxTime` |
| — | — | query-builder (zaehlend) | `UserData` | `subdomains/generic/user/models/user-data/user-data.service.ts:1766` | `UserDataService.countByDateRange` |
| — | — | find | `—` | `subdomains/generic/user/models/user/dto/user-dto.mapper.ts:27` | — |
| — | — | find | `—` | `subdomains/generic/user/models/user/user.repository.ts:70` | `UserRepository.getNextRef` |
| — | — | find | `—` | `subdomains/generic/user/models/user/user.service.ts:336` | `UserService.createUser` |
| — | — | find | `—` | `subdomains/generic/user/models/user/user.service.ts:490` | `UserService.updateAddress` |
| — | — | find | `—` | `subdomains/generic/user/models/user/user.service.ts:506` | `UserService.deactivateUser` |
| — | — | find | `—` | `subdomains/supporting/balance/services/balance-pdf.service.ts:105` | `BalancePdfService.getBalancesForAddress` |
| — | — | find | `—` | `subdomains/supporting/bank-tx/bank-tx/entities/bank-tx.entity.ts:323` | `BankTx.bankDataName` |
| — | — | find | `—` | `subdomains/supporting/bank-tx/bank-tx/entities/bank-tx.entity.ts:335` | `BankTx.getSenderAccount` |
| — | — | find | `—` | `subdomains/supporting/bank-tx/bank-tx/services/bank-tx.service.ts:172` | `BankTxService.enrichYapealTransactions` |
| — | — | find | `—` | `subdomains/supporting/bank-tx/bank-tx/services/bank-tx.service.ts:708` | `BankTxService.findMatchingBuy` |
| — | — | find | `—` | `subdomains/supporting/bank/bank/bank.service.ts:62` | `BankService.getBankInternal` |
| — | — | find | `—` | `subdomains/supporting/bank/bank/bank.service.ts:142` | `BankService.getMatchingBank` |
| — | — | find | `—` | `subdomains/supporting/bank/bank/bank.service.ts:143` | `BankService.getMatchingBank` |
| — | — | find | `—` | `subdomains/supporting/bank/bank/bank.service.ts:216` | `BankService.getReceiveIbanStatus` |
| — | — | find | `—` | `subdomains/supporting/bank/virtual-iban/virtual-iban-frick-issuance-reconciliation.service.ts:150` | `VirtualIbanFrickIssuanceReconciliationService.runPhase1StuckIntents` |
| — | — | find | `—` | `subdomains/supporting/bank/virtual-iban/virtual-iban-frick-issuance-reconciliation.service.ts:471` | `VirtualIbanFrickIssuanceReconciliationService.loadAbandonedReferences` |
| — | — | find | `—` | `subdomains/supporting/bank/virtual-iban/virtual-iban.service.ts:118` | `VirtualIbanService.getAccountHolder` |
| — | — | find | `—` | `subdomains/supporting/bank/virtual-iban/virtual-iban.service.ts:295` | `VirtualIbanService.String` |
| — | — | find | `—` | `subdomains/supporting/bank/virtual-iban/virtual-iban.service.ts:385` | `VirtualIbanService.lockUserLevelIssuanceForMerge` |
| — | — | find | `—` | `subdomains/supporting/bank/virtual-iban/virtual-iban.service.ts:709` | `VirtualIbanService.async` |
| — | — | raw-sql | `—` | `subdomains/supporting/bank/virtual-iban/virtual-iban.service.ts:769` | `VirtualIbanService.hasOrderedOwnershipPath` |
| — | — | find | `—` | `subdomains/supporting/bank/virtual-iban/virtual-iban.service.ts:1030` | `VirtualIbanService.resolveVirtualIbanId` |
| — | — | find | `—` | `subdomains/supporting/bank/virtual-iban/virtual-iban.service.ts:1124` | `VirtualIbanService.getFrickIntentForUpdate` |
| — | — | find | `—` | `subdomains/supporting/bank/virtual-iban/virtual-iban.service.ts:1139` | `VirtualIbanService.getFrickIntentByIdForUpdate` |
| — | — | find | `—` | `subdomains/supporting/bank/virtual-iban/virtual-iban.service.ts:1157` | `VirtualIbanService.persistUserLevelIfMissing` |
| — | — | find | `—` | `subdomains/supporting/bank/virtual-iban/virtual-iban.service.ts:1246` | `VirtualIbanService.findActiveForUserCurrencyAndBank` |
| — | — | find | `—` | `subdomains/supporting/bank/virtual-iban/virtual-iban.service.ts:1312` | `VirtualIbanService.getVirtualIbansForAccount` |
| — | — | find | `—` | `subdomains/supporting/bank/virtual-iban/virtual-iban.service.ts:1320` | `VirtualIbanService.getFrickVirtualIbansForAccount` |
| — | — | find | `—` | `subdomains/supporting/bank/virtual-iban/virtual-iban.service.ts:1339` | `VirtualIbanService.deactivateVirtualIbanLocked` |
| — | — | find | `—` | `subdomains/supporting/bank/virtual-iban/virtual-iban.service.ts:1379` | `VirtualIbanService.deactivateVirtualIbanLocked` |
| — | — | find | `—` | `subdomains/supporting/bank/virtual-iban/virtual-iban.service.ts:1446` | `VirtualIbanService.resolveIssuanceIntentsForMergeLocked` |
| — | — | find | `—` | `subdomains/supporting/bank/virtual-iban/virtual-iban.service.ts:1451` | `VirtualIbanService.resolveIssuanceIntentsForMergeLocked` |
| — | — | find | `—` | `subdomains/supporting/bank/virtual-iban/virtual-iban.service.ts:1501` | `VirtualIbanService.resolveMergedVirtualIbanPairLocked` |
| — | — | find | `—` | `subdomains/supporting/bank/virtual-iban/virtual-iban.service.ts:1554` | `VirtualIbanService.resolveMergedVirtualIbanPairLocked` |
| — | — | find | `—` | `subdomains/supporting/bank/virtual-iban/virtual-iban.service.ts:1557` | `VirtualIbanService.resolveMergedVirtualIbanPairLocked` |
| — | — | find | `—` | `subdomains/supporting/bank/virtual-iban/virtual-iban.service.ts:1565` | `VirtualIbanService.resolveMergedVirtualIbanPairLocked` |
| — | — | find | `—` | `subdomains/supporting/bank/virtual-iban/virtual-iban.service.ts:1591` | `VirtualIbanService.resolveMergedVirtualIbanPairLocked` |
| — | — | find | `—` | `subdomains/supporting/bank/virtual-iban/virtual-iban.service.ts:1638` | `VirtualIbanService.mergeUserLevelVirtualIbans` |
| — | — | find | `—` | `subdomains/supporting/bank/virtual-iban/virtual-iban.service.ts:1669` | `VirtualIbanService.mergeUserLevelVirtualIbans` |
| — | — | find | `—` | `subdomains/supporting/bank/virtual-iban/virtual-iban.service.ts:1715` | `VirtualIbanService.getProvider` |
| — | — | find | `—` | `subdomains/supporting/dex/strategies/supplementary/impl/bitcoin-testnet4.strategy.ts:35` | `BitcoinTestnet4Strategy.findTransaction` |
| — | — | find | `—` | `subdomains/supporting/dex/strategies/supplementary/impl/bitcoin.strategy.ts:35` | `BitcoinStrategy.findTransaction` |
| — | — | find | `—` | `subdomains/supporting/dex/strategies/supplementary/impl/cardano.strategy.ts:36` | `CardanoStrategy.findTransaction` |
| — | — | find | `—` | `subdomains/supporting/dex/strategies/supplementary/impl/firo.strategy.ts:35` | `FiroStrategy.findTransaction` |
| — | — | find | `—` | `subdomains/supporting/dex/strategies/supplementary/impl/icp.strategy.ts:41` | `IcpStrategy.findTransaction` |
| — | — | find | `—` | `subdomains/supporting/dex/strategies/supplementary/impl/monero.strategy.ts:35` | `MoneroStrategy.findTransaction` |
| — | — | find | `—` | `subdomains/supporting/dex/strategies/supplementary/impl/solana.strategy.ts:37` | `SolanaStrategy.findTransaction` |
| — | — | find | `—` | `subdomains/supporting/dex/strategies/supplementary/impl/solana.strategy.ts:37` | `SolanaStrategy.findTransaction` |
| — | — | find | `—` | `subdomains/supporting/dex/strategies/supplementary/impl/tron.strategy.ts:37` | `TronStrategy.findTransaction` |
| — | — | find | `—` | `subdomains/supporting/dex/strategies/supplementary/impl/zano.strategy.ts:37` | `ZanoStrategy.findTransaction` |
| — | — | find | `—` | `subdomains/supporting/fiat-output/fiat-output-job.service.ts:300` | `FiatOutputJobService.setReadyDate` |
| — | — | find | `—` | `subdomains/supporting/fiat-output/fiat-output.service.ts:55` | `FiatOutputService.selectPayoutBank` |
| — | — | find | `—` | `subdomains/supporting/fiat-output/fiat-output.service.ts:207` | `FiatOutputService.update` |
| — | — | find | `—` | `subdomains/supporting/log/log-job.service.ts:618` | `LogJobService.getAssetLog` |
| — | — | find | `—` | `subdomains/supporting/log/log-job.service.ts:625` | `LogJobService.getAssetLog` |
| — | — | find | `—` | `subdomains/supporting/log/log-job.service.ts:997` | `LogJobService.getAssetLog` |
| — | — | find | `—` | `subdomains/supporting/log/log-job.service.ts:1607` | `LogJobService.findSenderReceiverPair` |
| — | — | raw-sql | `Log` | `subdomains/supporting/log/log.repository.ts:341` | `LogRepository.getFinancialLogAssetPrices` |
| — | — | raw-sql | `Log` | `subdomains/supporting/log/log.repository.ts:511` | `LogRepository.getFinancialLogSummariesFull` |
| — | — | raw-sql | `Log` | `subdomains/supporting/log/log.repository.ts:664` | `LogRepository.getFinancialLogSummariesChartOnly` |
| — | — | query-builder (zaehlend) | `Log` | `subdomains/supporting/log/log.repository.ts:688` | `LogRepository.assertEmptyResultIsEndOfData` |
| — | — | find | `—` | `subdomains/supporting/notification/services/notification.service.ts:128` | `NotificationService.resolveMailWallet` |
| — | — | find | `—` | `subdomains/supporting/payin/services/payin-notification.service.ts:32` | `PayInNotificationService.returnedCryptoInput` |
| — | — | find | `—` | `subdomains/supporting/payin/services/payin.service.ts:148` | `PayInService.getCryptoInputsByTransactionIds` |
| — | — | query-builder (alias only) | `—` | `subdomains/supporting/payin/services/payin.service.ts:156` | `PayInService.getCryptoInputByKeys` |
| — | — | find | `—` | `subdomains/supporting/payin/services/payin.service.ts:179` | `PayInService.getNewPayIns` |
| — | — | find | `—` | `subdomains/supporting/payin/services/payin.service.ts:192` | `PayInService.getAllUserTransactions` |
| — | — | find | `—` | `subdomains/supporting/payin/services/payin.service.ts:201` | `PayInService.getPendingPayIns` |
| — | — | find | `—` | `subdomains/supporting/payin/services/payin.service.ts:226` | `PayInService.acknowledgePayIn` |
| — | — | find | `—` | `subdomains/supporting/payin/services/payin.service.ts:261` | `PayInService.ignorePayIn` |
| — | — | find | `—` | `subdomains/supporting/payin/services/payin.service.ts:269` | `PayInService.retryUncertainSend` |
| — | — | find | `—` | `subdomains/supporting/payin/services/payin.service.ts:323` | `PayInService.updateFailedPayments` |
| — | — | find | `—` | `subdomains/supporting/payin/services/payin.service.ts:351` | `PayInService.forwardPayIns` |
| — | — | find | `—` | `subdomains/supporting/payin/services/payin.service.ts:397` | `PayInService.getUnconfirmedNextBlockPayIns` |
| — | — | find | `—` | `subdomains/supporting/payin/services/payin.service.ts:434` | `PayInService.checkOutputConfirmations` |
| — | — | find | `—` | `subdomains/supporting/payin/services/payin.service.ts:457` | `PayInService.checkReturnConfirmations` |
| — | — | find | `—` | `subdomains/supporting/payin/services/payin.service.ts:480` | `PayInService.returnPayIns` |
| — | — | find | `—` | `subdomains/supporting/payin/services/payin.service.ts:509` | `PayInService.processStrandedSendingPayIns` |
| — | — | find | `—` | `subdomains/supporting/payin/services/payin.service.ts:553` | `PayInService.checkInputConfirmations` |
| — | — | find | `—` | `subdomains/supporting/payin/strategies/register/impl/base/alchemy.strategy.ts:33` | `AlchemyStrategy.pollAddress` |
| — | — | find | `—` | `subdomains/supporting/payin/strategies/register/impl/base/citrea.strategy.ts:81` | `CitreaBaseStrategy.getLastCheckedBlockHeight` |
| — | — | find | `—` | `subdomains/supporting/payin/strategies/register/impl/base/citrea.strategy.ts:120` | `CitreaBaseStrategy.mapCoinTransactionsToEntries` |
| — | — | find | `—` | `subdomains/supporting/payin/strategies/register/impl/base/evm.strategy.ts:38` | `EvmStrategy.getTransactionAsset` |
| — | — | find | `—` | `subdomains/supporting/payin/strategies/register/impl/binance-pay.strategy.ts:60` | `BinancePayStrategy.mapBinanceTransaction` |
| — | — | find | `—` | `subdomains/supporting/payin/strategies/register/impl/cardano.strategy.ts:97` | `CardanoStrategy.getLastCheckedBlockHeight` |
| — | — | find | `—` | `subdomains/supporting/payin/strategies/register/impl/cardano.strategy.ts:146` | `CardanoStrategy.mapToPayInEntries` |
| — | — | find | `—` | `subdomains/supporting/payin/strategies/register/impl/kucoin-pay.strategy.ts:60` | `KucoinPayStrategy.mapKucoinTransaction` |
| — | — | find | `—` | `subdomains/supporting/payin/strategies/register/impl/monero.strategy.ts:55` | `MoneroStrategy.getLastCheckedBlockHeight` |
| — | — | find | `—` | `subdomains/supporting/payin/strategies/register/impl/solana.strategy.ts:80` | `SolanaStrategy.getPayInAddresses` |
| — | — | find | `—` | `subdomains/supporting/payin/strategies/register/impl/solana.strategy.ts:119` | `SolanaStrategy.getTransactionCoin` |
| — | — | find | `—` | `subdomains/supporting/payin/strategies/register/impl/tron.strategy.ts:80` | `TronStrategy.getPayInAddresses` |
| — | — | find | `—` | `subdomains/supporting/payin/strategies/register/impl/tron.strategy.ts:112` | `TronStrategy.getTransactionCoin` |
| — | — | find | `—` | `subdomains/supporting/payin/strategies/register/impl/tron.strategy.ts:117` | `TronStrategy.getTransactionAsset` |
| — | — | find | `—` | `subdomains/supporting/payin/strategies/register/impl/zano.strategy.ts:57` | `ZanoStrategy.getLastCheckedBlockHeight` |
| — | — | find | `—` | `subdomains/supporting/payin/strategies/register/impl/zano.strategy.ts:105` | `ZanoStrategy.doMapToPayInEntries` |
| — | — | find | `—` | `subdomains/supporting/payment/repositories/transaction-specification.repository.ts:49` | `TransactionSpecificationRepository.findSpec` |
| — | — | find | `—` | `subdomains/supporting/payment/services/fee.service.ts:233` | `FeeService.getFeeBySpecialCode` |
| — | — | find | `—` | `subdomains/supporting/payment/services/fee.service.ts:338` | `FeeService.getFee` |
| — | — | find | `—` | `subdomains/supporting/payment/services/swiss-qr.service.ts:391` | `SwissQRService.formatChDate` |
| — | — | find | `—` | `subdomains/supporting/payment/services/swiss-qr.service.ts:409` | `SwissQRService.formatChDate` |
| — | — | find | `—` | `subdomains/supporting/payment/services/transaction-request.service.ts:295` | `TransactionRequestService.findAndComplete` |
| — | — | find | `—` | `subdomains/supporting/payment/services/transaction-request.service.ts:297` | `TransactionRequestService.findAndComplete` |
| — | — | find | `—` | `subdomains/supporting/payment/services/transaction.service.ts:341` | `TransactionService.getAllTransactionsForUserData` |
| — | — | find | `—` | `subdomains/supporting/pricing/services/integration/coin-gecko.service.ts:155` | `CoinGeckoService.getCurrency` |
| — | — | find | `—` | `subdomains/supporting/pricing/services/integration/pricing-deuro.service.ts:60` | `PricingDeuroService.getPrice` |
| — | — | find | `—` | `subdomains/supporting/realunit/realunit-job.service.ts:132` | `RealUnitJobService.findUnconsumedSettlement` |
| — | — | find | `—` | `subdomains/supporting/realunit/realunit.service.ts:339` | `RealUnitService.getHistoryEventByTxHash` |
| — | — | find | `—` | `subdomains/supporting/realunit/realunit.service.ts:1442` | `RealUnitService.toUserDataDtoFromUserData` |
| — | — | find | `—` | `subdomains/supporting/realunit/realunit.service.ts:1606` | `RealUnitService.forwardRegistration` |
| — | — | find | `—` | `subdomains/supporting/realunit/realunit.service.ts:2927` | `RealUnitService.applyRegistrationConfirmation` |
| — | — | find | `—` | `subdomains/supporting/support-issue/services/support-escalation.service.ts:166` | `SupportEscalationService.bindGroupChat` |
| — | — | find | `—` | `subdomains/supporting/support-issue/services/support-issue.service.ts:92` | `SupportIssueService.getSupportIssueClerkForAccount` |
| — | — | find | `SupportMessage` | `subdomains/supporting/support-issue/services/support-issue.service.ts:633` | `SupportIssueService.getIssueFile` |
| — | — | find | `SupportMessage` | `subdomains/supporting/support-issue/services/support-issue.service.ts:648` | `SupportIssueService.getUserIssues` |
