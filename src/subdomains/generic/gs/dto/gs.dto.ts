import { LogQueryDto, LogQueryTemplate } from './log-query.dto';

export const GsRestrictedMarker = '[RESTRICTED]';

// db endpoint
export const GsRestrictedColumns: Record<string, string[]> = {
  asset: ['ikna'],
};

/**
 * Prefix of the verbose audit message emitted by `gs.service.executeLogQuery`
 * (`[GsService] Log query by ...`). The ALL_TRACES template excludes lines
 * with this prefix to prevent recursive self-match for high-frequency
 * callers. Keep service and template in sync via this constant.
 *
 * Note: the leading `[GsService] ` is prepended by `DfxLogger` from the
 * `GsService` class name, not from this constant. Renaming the service
 * class would break the KQL filter silently — no test covers that path.
 */
export const LogQueryAuditPrefix = 'Log query by ';

// Debug endpoint
export const DebugMaxResults = 10000;

// --- Structured /gs/debug allowlist ---
//
// The /gs/debug endpoint accepts a JSON request describing the query (table + select + where
// + group/order/limit) and emits SQL via TypeORM with parameter binding. No raw SQL is ever
// accepted, parsed, or interpolated — identifiers come exclusively from this allowlist and
// values flow through bound parameters.
//
// Update on every migration: adding / renaming / removing a column on a table that appears
// below requires editing this allowlist. Adding a new debuggable table requires a new entry.
// Anything not listed is unreachable from /gs/debug.
//
// Conservative inclusion rules — exclude these categories of columns even when present on
// the entity:
//   - PII: names, addresses, phone, mail, birthday, nationality/country FKs on user_data,
//     organization PII, IBANs, BICs, account numbers.
//   - Secrets: apiKey, apiKeyCT, apiUrl, totpSecret, signature, kycHash, uid, pdfUrl.
//   - Free-form text: comment, label, internalAmlNote, txInfo, raw, data, message (except
//     log.message which is the whole point of the endpoint).
//   - Card data, IP addresses, recipient mails on transaction-like tables.
//
// Include: IDs (own + FK), timestamps, status / enum discriminators, numeric amounts,
// boolean flags, blockchain / asset names, on-chain hashes and addresses (public-by-nature),
// FK IDs for traversal (recommenderId, userDataId, etc.).
export interface DebugTableSpec {
  // Columns the request may reference in select / where / order by / group by.
  columns: string[];
  // Subset of `columns` where the structured `jsonbPath` selector is allowed. The endpoint
  // emits `(col)::jsonb -> 'a' -> 'b' ->> 'c'` for these; segment names are validated by regex.
  jsonbColumns?: string[];
}

export const DebugAllowedColumns: Record<string, DebugTableSpec> = {
  account_merge: {
    columns: ['id', 'created', 'updated', 'code', 'expiration', 'isCompleted', 'masterId', 'processingStartedAt', 'reason', 'slaveId'],
  },
  asset: {
    columns: ['id', 'created', 'updated', 'amlRuleFrom', 'amlRuleTo', 'approxPriceChf', 'approxPriceEur', 'approxPriceUsd', 'blockchain', 'buyable', 'cardBuyable', 'cardSellable', 'category', 'chainId', 'comingSoon', 'decimals', 'description', 'dexName', 'financialType', 'ikna', 'instantBuyable', 'instantSellable', 'name', 'paymentEnabled', 'personalIbanEnabled', 'priceRuleId', 'refEnabled', 'refundEnabled', 'sellable', 'sortOrder', 'type', 'uniqueName'],
  },
  asset_price: {
    columns: ['id', 'created', 'updated', 'assetId'],
  },
  bank: {
    columns: ['id', 'created', 'updated'],
  },
  bank_account: {
    columns: ['id', 'created', 'updated'],
  },
  bank_data: {
    // No iban / name / label — those leak banking PII.
    columns: ['id', 'created', 'updated', 'active', 'approved', 'default', 'manualApproved', 'preferredCurrencyId', 'status', 'type', 'userDataId'],
  },
  bank_tx: {
    columns: ['id', 'created', 'updated', 'accountServiceRef', 'accountingAmountAfterFee', 'accountingAmountAfterFeeChf', 'accountingAmountBeforeFee', 'accountingAmountBeforeFeeChf', 'accountingFeeAmount', 'accountingFeePercent', 'amount', 'bankName', 'batchId', 'bookingDate', 'chargeAmount', 'chargeAmountChf', 'chargeCurrency', 'clearingSystemId', 'creditDebitIndicator', 'currency', 'domainCode', 'endToEndId', 'exchangeRate', 'exchangeSourceCurrency', 'exchangeTargetCurrency', 'familyCode', 'highRisk', 'instructedAmount', 'instructedCurrency', 'instructionId', 'memberId', 'subfamilyCode', 'txAmount', 'txCount', 'txCurrency', 'txId', 'type', 'valueDate'],
  },
  bank_tx_batch: {
    columns: ['id', 'created', 'updated'],
  },
  bank_tx_repeat: {
    columns: ['id', 'created', 'updated', 'userId'],
  },
  bank_tx_return: {
    columns: ['id', 'created', 'updated', 'userDataId'],
  },
  blockchain_fee: {
    columns: ['id', 'created', 'updated'],
  },
  buy: {
    // No iban.
    columns: ['id', 'created', 'updated', 'active', 'annualVolume', 'assetId', 'bankUsage', 'depositId', 'monthlyVolume', 'userId', 'volume'],
  },
  buy_crypto: {
    columns: ['id', 'created', 'updated', 'absoluteFeeAmount', 'amlCheck', 'amlReason', 'amountInChf', 'amountInEur', 'annualVolume', 'bankDataId', 'bankFeeAmount', 'bankFixedFeeAmount', 'bankPercentFeeAmount', 'batchId', 'blockchainFee', 'buyId', 'chargebackAllowedBy', 'chargebackAllowedDate', 'chargebackAllowedDateUser', 'chargebackAmount', 'chargebackAsset', 'chargebackCryptoTxId', 'chargebackDate', 'chargebackReferenceAmount', 'cryptoRouteId', 'highRisk', 'inputAmount', 'inputAsset', 'inputReferenceAmount', 'inputReferenceAmountMinusFee', 'inputReferenceAsset', 'isComplete', 'liquidityPipelineId', 'mailSendDate', 'minFeeAmount', 'minFeeAmountFiat', 'monthlyVolume', 'networkStartAmount', 'networkStartAsset', 'networkStartFeeAmount', 'networkStartTxId', 'outputAmount', 'outputAssetId', 'outputDate', 'outputReferenceAmount', 'outputReferenceAssetId', 'partnerFeeAmount', 'paymentLinkFee', 'percentFee', 'percentFeeAmount', 'priceDefinitionAllowedDate', 'quoteMarketRatio', 'refFactor', 'refProvision', 'status', 'totalFeeAmount', 'totalFeeAmountChf', 'txId', 'usedPartnerRef', 'usedRef', 'volume'],
  },
  buy_crypto_batch: {
    columns: ['id', 'created', 'updated', 'blockchain', 'outputAmount', 'outputAssetId', 'outputReferenceAmount', 'outputReferenceAssetId', 'status'],
  },
  buy_crypto_fee: {
    columns: ['id', 'created', 'updated', 'actualPayoutFeeAmount', 'actualPayoutFeePercent', 'actualPurchaseFeeAmount', 'actualPurchaseFeePercent', 'allowedTotalFeeAmount', 'estimatePayoutFeeAmount', 'estimatePayoutFeePercent', 'estimatePurchaseFeeAmount', 'estimatePurchaseFeePercent', 'feeReferenceAssetId'],
  },
  buy_fiat: {
    columns: ['id', 'created', 'updated', 'absoluteFeeAmount', 'amlCheck', 'amlReason', 'amountInChf', 'amountInEur', 'bankBatchId', 'bankDataId', 'bankFeeAmount', 'bankFixedFeeAmount', 'bankPercentFeeAmount', 'bankTxId', 'blockchainFee', 'chargebackAddress', 'chargebackAllowedBy', 'chargebackAllowedDate', 'chargebackAllowedDateUser', 'chargebackAmount', 'chargebackAsset', 'chargebackDate', 'chargebackReferenceAmount', 'fiatOutputId', 'highRisk', 'inputAmount', 'inputAsset', 'inputReferenceAmount', 'inputReferenceAmountMinusFee', 'inputReferenceAsset', 'instantSepa', 'isComplete', 'mail1SendDate', 'mail2SendDate', 'mail3SendDate', 'mailReturnSendDate', 'minFeeAmount', 'minFeeAmountFiat', 'outputAmount', 'outputAssetId', 'outputDate', 'outputReferenceAmount', 'outputReferenceAssetId', 'partnerFeeAmount', 'paymentLinkFee', 'percentFee', 'percentFeeAmount', 'priceDefinitionAllowedDate', 'quoteMarketRatio', 'refFactor', 'refProvision', 'sellId', 'status', 'totalFeeAmount', 'totalFeeAmountChf', 'usedPartnerRef', 'usedRef'],
  },
  checkout_tx: {
    columns: ['id', 'created', 'updated'],
  },
  country: {
    columns: ['id', 'created', 'updated', 'amlRule', 'bankEnable', 'bankTransactionVerificationEnable', 'cardBuyable', 'checkoutEnable', 'cryptoEnable', 'dfxEnable', 'dfxOrganizationEnable', 'enabledKycDocuments', 'fatfEnable', 'ipEnable', 'lockEnable', 'manualReviewRequired', 'manualReviewRequiredOrganization', 'nationalityEnable', 'nationalityStepEnable', 'symbol', 'symbol3', 'yapealEnable'],
  },
  crypto_input: {
    columns: ['id', 'created', 'updated', 'assetId', 'paymentLinkPaymentId', 'paymentQuoteId', 'routeId'],
  },
  crypto_staking: {
    columns: ['id', 'created', 'updated', 'inputAmount', 'inputAmountInChf', 'inputAmountInEur', 'inputAsset', 'inputDate', 'inputMailSendDate', 'isReinvest', 'outTxId', 'outTxId2', 'outputAmount', 'outputAmountInChf', 'outputAmountInEur', 'outputAsset', 'outputDate', 'outputMailSendDate', 'paybackDepositId', 'payoutType', 'readyToPayout', 'stakingRouteId'],
  },
  custody_account: {
    columns: ['id', 'created', 'updated', 'ownerId', 'requiredSignatures', 'status'],
  },
  custody_account_access: {
    columns: ['id', 'created', 'updated', 'accessLevel', 'accountId', 'userDataId'],
  },
  custody_balance: {
    columns: ['id', 'created', 'updated', 'accountId', 'assetId', 'balance', 'userId'],
  },
  custody_order: {
    columns: ['id', 'created', 'updated', 'accountId', 'amountInChf', 'buyId', 'initiatedById', 'inputAmount', 'inputAssetId', 'outputAmount', 'outputAssetId', 'sellId', 'status', 'swapId', 'type', 'userId'],
  },
  custody_order_step: {
    columns: ['id', 'created', 'updated', 'command', 'context', 'correlationId', 'index', 'orderId', 'status'],
  },
  custody_provider: {
    // No mail (internal contact mail).
    columns: ['id', 'created', 'updated', 'name'],
  },
  deposit: {
    columns: ['id', 'created', 'updated', 'accountIndex', 'address', 'blockchains'],
  },
  deposit_route: {
    // No iban.
    columns: ['id', 'created', 'updated', 'active', 'type', 'volume'],
  },
  exchange_tx: {
    columns: ['id', 'created', 'updated'],
  },
  faucet_request: {
    columns: ['id', 'created', 'updated', 'amount', 'assetId', 'status', 'txId', 'userDataId', 'userId'],
  },
  fee: {
    columns: ['id', 'created', 'updated', 'bankId', 'walletId'],
  },
  fiat: {
    columns: ['id', 'created', 'updated', 'amlRuleFrom', 'amlRuleTo', 'approxPriceChf', 'buyable', 'cardBuyable', 'cardSellable', 'ibanCountryConfig', 'instantBuyable', 'instantSellable', 'name', 'priceRuleId', 'refundEnabled', 'sellable'],
  },
  fiat_output: {
    // No iban / accountNumber / bic / aba / name / address / city / country.
    columns: ['id', 'created', 'updated', 'amount', 'bankId', 'batchAmount', 'batchId', 'charge', 'creditInstitution', 'currency', 'endToEndId', 'info', 'instrId', 'isApprovedDate', 'isComplete', 'isConfirmedDate', 'isInstant', 'isReadyDate', 'isTransmittedDate', 'olkyOrderId', 'originEntityId', 'outputDate', 'pmtInfId', 'reportCreated', 'type', 'valutaDate', 'yapealMsgId'],
  },
  ip_log: {
    // No ip / country / address — IP-tracking PII.
    columns: ['id', 'created', 'updated', 'result', 'userDataId', 'userId', 'walletType'],
  },
  kyc_file: {
    // No name / uid (uid is a secret identifier).
    columns: ['id', 'created', 'updated', 'kycStepId', 'protected', 'subType', 'type', 'userDataId', 'valid'],
  },
  kyc_file_log: {
    columns: ['id', 'created', 'updated', 'eventDate', 'type'],
  },
  kyc_log: {
    // No comment / ipAddress / result / pdfUrl.
    columns: ['id', 'created', 'updated', 'eventDate', 'fileId', 'type', 'userDataId'],
  },
  kyc_step: {
    // No result (free-form text).
    columns: ['id', 'created', 'updated', 'name', 'reminderSentDate', 'sequenceNumber', 'sessionId', 'status', 'transactionId', 'type', 'userDataId'],
  },
  language: {
    columns: ['id', 'created', 'updated', 'enable', 'foreignName', 'name', 'symbol'],
  },
  limit_request: {
    columns: ['id', 'created', 'updated'],
  },
  limit_request_log: {
    columns: ['id', 'created', 'updated', 'limitRequestId'],
  },
  liquidity_balance: {
    columns: ['id', 'created', 'updated', 'amount', 'assetId', 'availableAmount', 'isDfxOwned'],
  },
  liquidity_management_action: {
    columns: ['id', 'created', 'updated', 'command', 'onFailId', 'onSuccessId', 'system', 'tag'],
  },
  liquidity_management_order: {
    columns: ['id', 'created', 'updated', 'actionId', 'correlationId', 'eagerId', 'errorMessage', 'inputAmount', 'inputAsset', 'maxAmount', 'minAmount', 'outputAmount', 'outputAsset', 'previousCorrelationIds', 'previousOrderId', 'status'],
  },
  liquidity_management_pipeline: {
    columns: ['id', 'created', 'updated', 'currentActionId', 'maxAmount', 'minAmount', 'ordersProcessed', 'previousActionId', 'status', 'type', 'uniqueId'],
  },
  liquidity_management_rule: {
    columns: ['id', 'created', 'updated', 'context', 'deficitStartActionId', 'delayActivation', 'limit', 'maximal', 'minimal', 'optimal', 'reactivationTime', 'redundancyStartActionId', 'sendNotifications', 'status', 'targetFiatId'],
  },
  liquidity_order: {
    columns: ['id', 'created', 'updated', 'feeAssetId', 'referenceAssetId', 'swapAssetId', 'targetAssetId'],
  },
  log: {
    columns: ['id', 'created', 'updated', 'category', 'message', 'severity', 'subsystem', 'system', 'valid'],
    jsonbColumns: ['message'],
  },
  mail_change_log: {
    columns: ['id', 'created', 'updated', 'eventDate', 'type'],
  },
  manual_log: {
    columns: ['id', 'created', 'updated', 'eventDate', 'type'],
  },
  merge_log: {
    columns: ['id', 'created', 'updated', 'eventDate', 'type'],
  },
  mros: {
    columns: ['id', 'created', 'updated', 'userDataId'],
  },
  name_check_log: {
    columns: ['id', 'created', 'updated', 'bankDataId', 'eventDate', 'riskEvaluationDate', 'riskStatus', 'type'],
  },
  notification: {
    // No data (free-form JSON).
    columns: ['id', 'created', 'updated', 'userDataId'],
  },
  olky_recipient: {
    columns: ['id', 'created', 'updated'],
  },
  organization: {
    // No name / street / location / zip / signatory* / accountOpenerAuthorization /
    // legalEntity / countryId — all org-PII.
    columns: ['id', 'created', 'updated', 'accountOpenerId'],
  },
  payment_activation: {
    columns: ['id', 'created', 'updated', 'amount', 'assetId', 'expiryDate', 'method', 'paymentId', 'quoteId', 'standard', 'status'],
  },
  payment_link: {
    // No comment / label / regionManager / storeManager / storeOwner / webhookUrl.
    columns: ['id', 'created', 'updated', 'externalId', 'mode', 'publicStatus', 'routeId', 'status', 'uniqueId'],
  },
  payment_link_payment: {
    columns: ['id', 'created', 'updated', 'amount', 'currencyId', 'deviceCommand', 'deviceId', 'externalId', 'expiryDate', 'isConfirmed', 'linkId', 'mode', 'status', 'txCount', 'uniqueId'],
  },
  payment_merchant: {
    columns: ['id', 'created', 'updated', 'externalId', 'status', 'userId'],
  },
  payment_quote: {
    // No tx (raw tx data may contain addresses).
    columns: ['id', 'created', 'updated', 'expiryDate', 'paymentId', 'standard', 'status', 'txBlockchain', 'txId', 'uniqueId'],
  },
  payout_order: {
    columns: ['id', 'created', 'updated', 'assetId', 'payoutFeeAssetId', 'preparationFeeAssetId'],
  },
  price_rule: {
    columns: ['id', 'created', 'updated', 'referenceId'],
  },
  recall: {
    columns: ['id', 'created', 'updated', 'bankTxId', 'checkoutTxId', 'userId'],
  },
  recommendation: {
    // recommenderId / recommendedId are the FK linkage db-debug.sh's referral walk needs.
    // recommendedMail is excluded as PII.
    columns: ['id', 'created', 'updated', 'code', 'confirmationDate', 'expirationDate', 'isConfirmed', 'method', 'recommendedId', 'recommenderId', 'type'],
  },
  ref: {
    // No ip — was in old blocklist.
    columns: ['id', 'created', 'updated', 'origin', 'ref'],
  },
  ref_reward: {
    // No recipientMail — was in old blocklist.
    columns: ['id', 'created', 'updated', 'amountInChf', 'amountInEur', 'inputAmount', 'inputAsset', 'inputReferenceAmount', 'inputReferenceAsset', 'liquidityPipelineId', 'mailSendDate', 'outputAmount', 'outputAsset', 'outputDate', 'outputReferenceAmount', 'outputReferenceAsset', 'status', 'targetAddress', 'targetBlockchain', 'txId', 'userId'],
  },
  reward: {
    // No recipientMail.
    columns: ['id', 'created', 'updated', 'amountInChf', 'amountInEur', 'inputAmount', 'inputAsset', 'inputReferenceAmount', 'inputReferenceAsset', 'mailSendDate', 'outputAmount', 'outputAsset', 'outputAssetId', 'outputDate', 'outputReferenceAmount', 'outputReferenceAsset', 'txId'],
  },
  risk_status_log: {
    columns: ['id', 'created', 'updated', 'eventDate', 'type'],
  },
  route: {
    columns: ['id', 'created', 'updated'],
  },
  sanction: {
    columns: ['id', 'created', 'updated', 'address', 'currency'],
  },
  sell: {
    // No iban.
    columns: ['id', 'created', 'updated', 'active', 'annualVolume', 'bankDataId', 'fiatId', 'monthlyVolume', 'type', 'volume'],
  },
  setting: {
    columns: ['id', 'created', 'updated', 'key'],
  },
  sift_error_log: {
    // No requestPayload.
    columns: ['id', 'created', 'updated', 'userId'],
  },
  special_external_account: {
    columns: ['id', 'created', 'updated'],
  },
  staking: {
    columns: ['id', 'created', 'updated'],
  },
  staking_ref_reward: {
    // No recipientMail.
    columns: ['id', 'created', 'updated', 'amountInChf', 'amountInEur', 'inputAmount', 'inputAsset', 'inputReferenceAmount', 'inputReferenceAsset', 'mailSendDate', 'outputAmount', 'outputAsset', 'outputDate', 'outputReferenceAmount', 'outputReferenceAsset', 'stakingId', 'stakingRefType', 'txId', 'userId'],
  },
  staking_reward: {
    // No recipientMail.
    columns: ['id', 'created', 'updated', 'amountInChf', 'amountInEur', 'fee', 'inputAmount', 'inputAsset', 'inputDate', 'inputReferenceAmount', 'inputReferenceAsset', 'internalId', 'mailSendDate', 'outputAmount', 'outputAsset', 'outputDate', 'outputReferenceAmount', 'outputReferenceAsset', 'payoutType', 'stakingId', 'txId'],
  },
  step_log: {
    columns: ['id', 'created', 'updated', 'eventDate', 'status', 'type'],
  },
  support_issue: {
    // No name / information / uid.
    columns: ['id', 'created', 'updated', 'transactionId', 'transactionRequestId', 'userDataId'],
  },
  support_issue_log: {
    columns: ['id', 'created', 'updated', 'supportIssueId'],
  },
  support_issue_template: {
    // No authorMail / contentDe / contentEn — free-form / contact info.
    columns: ['id', 'created', 'updated', 'authorId'],
  },
  support_log: {
    columns: ['id', 'created', 'updated', 'userDataId'],
  },
  support_message: {
    // No message / fileUrl.
    columns: ['id', 'created', 'updated', 'issueId'],
  },
  support_note: {
    // No content / subject / authorMail.
    columns: ['id', 'created', 'updated', 'authorId', 'department'],
  },
  swap: {
    columns: ['id', 'created', 'updated', 'active', 'annualVolume', 'assetId', 'monthlyVolume', 'targetDepositId', 'type', 'volume'],
  },
  system_state_snapshot: {
    columns: ['id', 'created', 'updated'],
  },
  tfa_log: {
    columns: ['id', 'created', 'updated', 'eventDate', 'type'],
  },
  trading_order: {
    columns: ['id', 'created', 'updated', 'amountExpected', 'amountIn', 'amountOut', 'assetInId', 'assetOutId', 'errorMessage', 'price1', 'price2', 'price3', 'priceImpact', 'profitChf', 'status', 'swapFeeAmount', 'swapFeeAmountChf', 'tradingRuleId', 'txFeeAmount', 'txFeeAmountChf', 'txId'],
  },
  trading_rule: {
    columns: ['id', 'created', 'updated', 'leftAsset1', 'leftAsset2', 'leftAsset3', 'leftAssetId', 'lowerLimit', 'lowerTarget', 'poolFee', 'reactivationTime', 'rightAsset1', 'rightAsset2', 'rightAsset3', 'rightAssetId', 'source1', 'source2', 'source3', 'status', 'upperLimit', 'upperTarget'],
  },
  transaction: {
    // No recipientMail / uid.
    columns: ['id', 'created', 'updated', 'amlCheck', 'amlType', 'amountInChf', 'eventDate', 'externalId', 'feeAmountInChf', 'highRisk', 'mailSendDate', 'outputDate', 'sourceType', 'type', 'userDataId', 'userId'],
  },
  transaction_request: {
    columns: ['id', 'created', 'updated', 'userId'],
  },
  transaction_risk_assessment: {
    // No reason / methods / summary / result / pdf.
    columns: ['id', 'created', 'updated', 'transactionId'],
  },
  transaction_specification: {
    columns: ['id', 'created', 'updated'],
  },
  user: {
    // No ip / ipCountry / apiKeyCT / signature / label / comment — old blocklist.
    columns: ['id', 'created', 'updated', 'address', 'addressType', 'annualBuyVolume', 'annualCryptoVolume', 'annualSellVolume', 'apiFilterCT', 'approved', 'buyVolume', 'custodyAccountId', 'custodyAddressIndex', 'custodyAddressType', 'custodyProviderId', 'deactivationDate', 'monthlyBuyVolume', 'monthlyCryptoVolume', 'monthlySellVolume', 'origin', 'paidRefCredit', 'partnerRefCredit', 'partnerRefVolume', 'primaryUserId', 'refAssetId', 'refCredit', 'refFeePercent', 'refPayoutFrequency', 'refVolume', 'role', 'sellVolume', 'status', 'travelRulePdfDate', 'usedRef', 'userDataId', 'walletId', 'walletType'],
  },
  user_data: {
    // No PII columns. countryId / nationalityId / organizationId / verifiedCountryId /
    // accountOpenerId / organizationCountryId all blocked (link to PII tables).
    columns: ['id', 'created', 'updated', 'accountType', 'amlAccountType', 'amlListAddedDate', 'amlListExpiredDate', 'amlListReactivatedDate', 'amlListStatus', 'annualBuyVolume', 'annualCryptoVolume', 'annualSellVolume', 'bankTransactionVerification', 'buyVolume', 'cryptoVolume', 'currencyId', 'deactivationDate', 'depositLimit', 'hasBankTx', 'hasIpRisk', 'highRisk', 'identificationType', 'kycClients', 'kycFileId', 'kycLevel', 'kycStatus', 'kycType', 'languageId', 'lastNameCheckDate', 'letterSendDate', 'manualReviewRequired', 'moderator', 'monthlyBuyVolume', 'monthlyCryptoVolume', 'monthlySellVolume', 'olkypayAllowed', 'paymentLinksAllowed', 'pep', 'phoneCallAccepted', 'phoneCallCheckDate', 'phoneCallExternalAccountCheckDate', 'phoneCallIpCheckDate', 'phoneCallIpCountryCheckDate', 'phoneCallStatus', 'phoneCallTimes', 'postAmlCheck', 'recallAgreementAccepted', 'riskStatus', 'sellVolume', 'status', 'totalCustodyBalanceChfAuditPeriod', 'totalVolumeChfAuditPeriod', 'tradeApprovalDate', 'walletId'],
  },
  user_data_relation: {
    columns: ['id', 'created', 'updated', 'accountId', 'relatedAccountId', 'relation', 'signatory'],
  },
  virtual_iban: {
    // No label.
    columns: ['id', 'created', 'updated', 'bankId', 'buyId', 'currencyId', 'userDataId'],
  },
  wallet: {
    // No apiKey / apiUrl — old blocklist.
    columns: ['id', 'created', 'updated', 'amlRules', 'autoTradeApproval', 'buySpecificIbanEnabled', 'customKyc', 'displayFraudWarning', 'displayName', 'exceptAmlRules', 'identMethod', 'isKycClient', 'name', 'ownerId', 'usesDummyAddresses'],
  },
  wallet_app: {
    columns: ['id', 'created', 'updated', 'active', 'appStoreUrl', 'assets', 'blockchains', 'deepLink', 'hasActionDeepLink', 'iconUrl', 'name', 'playStoreUrl', 'recommended', 'semiCompatible', 'websiteUrl'],
  },
  webhook: {
    // No data.
    columns: ['id', 'created', 'updated', 'identifier', 'isComplete', 'lastTryDate', 'type', 'userDataId', 'userId', 'walletId'],
  },
};

export const DebugLogQueryTemplates: Record<
  LogQueryTemplate,
  { kql: string; requiredParams: (keyof LogQueryDto)[]; defaultLimit: number }
> = {
  [LogQueryTemplate.TRACES_BY_OPERATION]: {
    kql: `traces
| where operation_Id == "{operationId}"
| where timestamp > ago({hours}h)
| project timestamp, severityLevel, message, customDimensions
| order by timestamp desc`,
    requiredParams: ['operationId'],
    defaultLimit: 500,
  },
  [LogQueryTemplate.TRACES_BY_MESSAGE]: {
    kql: `traces
| where timestamp > ago({hours}h)
| where message contains "{messageFilter}"
| project timestamp, severityLevel, message, operation_Id
| order by timestamp desc`,
    requiredParams: ['messageFilter'],
    defaultLimit: 200,
  },
  [LogQueryTemplate.EXCEPTIONS_RECENT]: {
    kql: `exceptions
| where timestamp > ago({hours}h)
| project timestamp, problemId, outerMessage, innermostMessage, operation_Id
| order by timestamp desc`,
    requiredParams: [],
    defaultLimit: 500,
  },
  [LogQueryTemplate.REQUEST_FAILURES]: {
    kql: `requests
| where timestamp > ago({hours}h)
| where success == false
| project timestamp, resultCode, duration, operation_Name, operation_Id
| order by timestamp desc`,
    requiredParams: [],
    defaultLimit: 500,
  },
  [LogQueryTemplate.DEPENDENCIES_SLOW]: {
    kql: `dependencies
| where timestamp > ago({hours}h)
| where duration > {durationMs}
| project timestamp, target, type, duration, success, operation_Id
| order by duration desc`,
    requiredParams: ['durationMs'],
    defaultLimit: 200,
  },
  [LogQueryTemplate.CUSTOM_EVENTS]: {
    kql: `customEvents
| where timestamp > ago({hours}h)
| where name == "{eventName}"
| project timestamp, name, customDimensions, operation_Id
| order by timestamp desc`,
    requiredParams: ['eventName'],
    defaultLimit: 500,
  },
  [LogQueryTemplate.ALL_TRACES]: {
    // Returns all trace entries in the given window. Self-emitted audit lines
    // from /gs/debug/logs (start with "[GsService] " + LogQueryAuditPrefix)
    // are filtered out at the source so they don't crowd the result for
    // high-frequency dashboard callers. The "[GsService] " prefix is added by
    // DfxLogger's class-context; LogQueryAuditPrefix is the message prefix
    // emitted by gs.service.executeLogQuery — both sides reference the same
    // constant to keep service and template in sync.
    kql: `traces
| where timestamp > ago({hours}h)
| where not(message startswith "[GsService] ${LogQueryAuditPrefix}")
| project timestamp, severityLevel, message, operation_Id
| order by timestamp desc`,
    requiredParams: [],
    defaultLimit: 500,
  },
};

// Support endpoint
export enum SupportTable {
  USER_DATA = 'userData',
  USER = 'user',
  BUY = 'buy',
  SELL = 'sell',
  SWAP = 'swap',
  BUY_CRYPTO = 'buyCrypto',
  BUY_FIAT = 'buyFiat',
  BANK_TX = 'bankTx',
  FIAT_OUTPUT = 'fiatOutput',
  TRANSACTION = 'transaction',
  BANK_DATA = 'bankData',
  VIRTUAL_IBAN = 'virtualIban',
}
