import { LogQueryDto, LogQueryTemplate } from './log-query.dto';

export const GsRestrictedMarker = '[RESTRICTED]';

// db endpoint
export const GsRestrictedColumns: Record<string, string[]> = {
  asset: ['ikna'],
};

/**
 * Prefixes of the verbose audit messages emitted by `gs.service.executeLogQuery`
 * (`[GsService] Log query by ...`) and `gs.service.executeDebugQuery`
 * (`[GsService] Debug-query by ...`). The trace-returning log-query templates
 * filter both prefixes so a DEBUG user can't enumerate other DEBUG users'
 * audit history via `TRACES_BY_MESSAGE`/`TRACES_BY_OPERATION`/`ALL_TRACES`.
 * Keep service and templates in sync via these constants.
 *
 * Note: the leading `[GsService] ` is prepended by `DfxLogger` from the
 * `GsService` class name, not from this constant. Renaming the service
 * class would break the KQL filter silently — no test covers that path.
 */
export const LogQueryAuditPrefix = 'Log query by ';
export const DebugQueryAuditPrefix = 'Debug-query by ';

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
    columns: [
      'id',
      'created',
      'updated',
      'code',
      'expiration',
      'isCompleted',
      'masterId',
      'processingStartedAt',
      'reason',
      'slaveId',
    ],
  },
  asset: {
    columns: [
      'id',
      'created',
      'updated',
      'amlRuleFrom',
      'amlRuleTo',
      'approxPriceChf',
      'approxPriceEur',
      'approxPriceUsd',
      'blockchain',
      'buyable',
      'cardBuyable',
      'cardSellable',
      'category',
      'chainId',
      'comingSoon',
      'decimals',
      'description',
      'dexName',
      'financialType',
      'ikna',
      'instantBuyable',
      'instantSellable',
      'name',
      'paymentEnabled',
      'personalIbanEnabled',
      'priceRuleId',
      'refEnabled',
      'refundEnabled',
      'sellable',
      'sellCommand',
      'sortOrder',
      'type',
      'uniqueName',
    ],
  },
  asset_price: {
    columns: ['id', 'created', 'updated', 'assetId', 'priceChf', 'priceEur', 'priceUsd'],
  },
  bank: {
    // DFX's own bank-of-record entries (Maerki Baumann, Olkypay, …). The `iban` here is the
    // company's bank account number used to receive customer transfers — not a customer IBAN.
    columns: [
      'id',
      'created',
      'updated',
      'amlEnabled',
      'bic',
      'currency',
      'iban',
      'name',
      'receive',
      'sctInst',
      'send',
    ],
  },
  bank_account: {
    columns: ['id', 'created', 'updated'],
  },
  bank_data: {
    // No iban / name / label — those leak banking PII.
    columns: [
      'id',
      'created',
      'updated',
      'active',
      'approved',
      'default',
      'manualApproved',
      'preferredCurrencyId',
      'status',
      'type',
      'userDataId',
    ],
  },
  bank_tx: {
    columns: [
      'id',
      'created',
      'updated',
      'accountServiceRef',
      'accountingAmountAfterFee',
      'accountingAmountAfterFeeChf',
      'accountingAmountBeforeFee',
      'accountingAmountBeforeFeeChf',
      'accountingFeeAmount',
      'accountingFeePercent',
      'amount',
      'bankName',
      'batchId',
      'bookingDate',
      'chargeAmount',
      'chargeAmountChf',
      'chargeCurrency',
      'clearingSystemId',
      'creditDebitIndicator',
      'currency',
      'domainCode',
      'endToEndId',
      'exchangeRate',
      'exchangeSourceCurrency',
      'exchangeTargetCurrency',
      'familyCode',
      'highRisk',
      'instructedAmount',
      'instructedCurrency',
      'instructionId',
      'memberId',
      'subFamilyCode',
      'txAmount',
      'txCount',
      'txCurrency',
      'txId',
      'type',
      'valueDate',
    ],
  },
  bank_tx_batch: {
    columns: ['id', 'created', 'updated'],
  },
  bank_tx_repeat: {
    // No `info` (free-form), no `chargebackIban` / `chargebackRemittanceInfo` (PII).
    columns: [
      'id',
      'created',
      'updated',
      'amountInChf',
      'amountInEur',
      'amountInUsd',
      'chargebackAllowedBy',
      'chargebackAllowedDate',
      'chargebackAllowedDateUser',
      'chargebackAmount',
      'chargebackDate',
      'userId',
    ],
  },
  bank_tx_return: {
    // No `info` (free-form), no `chargebackIban` / `chargebackRemittanceInfo` /
    // `chargebackCreditorData` / `recipientMail` (PII).
    columns: [
      'id',
      'created',
      'updated',
      'amountInChf',
      'amountInEur',
      'amountInUsd',
      'chargebackAllowedBy',
      'chargebackAllowedDate',
      'chargebackAllowedDateUser',
      'chargebackAmount',
      'chargebackAsset',
      'chargebackDate',
      'chargebackReferenceAmount',
      'inputAmount',
      'inputAsset',
      'mailSendDate',
      'userDataId',
    ],
  },
  blockchain_fee: {
    columns: ['id', 'created', 'updated', 'amount'],
  },
  buy: {
    // No iban.
    columns: [
      'id',
      'created',
      'updated',
      'active',
      'annualVolume',
      'assetId',
      'bankUsage',
      'depositId',
      'monthlyVolume',
      'userId',
      'volume',
    ],
  },
  buy_crypto: {
    columns: [
      'id',
      'created',
      'updated',
      'absoluteFeeAmount',
      'amlCheck',
      'amlReason',
      'amountInChf',
      'amountInEur',
      'annualVolume',
      'bankDataId',
      'bankFeeAmount',
      'bankFixedFeeAmount',
      'bankPercentFeeAmount',
      'batchId',
      'blockchainFee',
      'buyId',
      'chargebackAllowedBy',
      'chargebackAllowedDate',
      'chargebackAllowedDateUser',
      'chargebackAmount',
      'chargebackAsset',
      'chargebackCryptoTxId',
      'chargebackDate',
      'chargebackReferenceAmount',
      'cryptoRouteId',
      'highRisk',
      'inputAmount',
      'inputAsset',
      'inputReferenceAmount',
      'inputReferenceAmountMinusFee',
      'inputReferenceAsset',
      'isComplete',
      'liquidityPipelineId',
      'mailSendDate',
      'minFeeAmount',
      'minFeeAmountFiat',
      'monthlyVolume',
      'networkStartAmount',
      'networkStartAsset',
      'networkStartFeeAmount',
      'networkStartTxId',
      'outputAmount',
      'outputAssetId',
      'outputDate',
      'outputReferenceAmount',
      'outputReferenceAssetId',
      'partnerFeeAmount',
      'paymentLinkFee',
      'percentFee',
      'percentFeeAmount',
      'priceDefinitionAllowedDate',
      'quoteMarketRatio',
      'refFactor',
      'refProvision',
      'status',
      'totalFeeAmount',
      'totalFeeAmountChf',
      'txId',
      'usedPartnerRef',
      'usedRef',
      'volume',
    ],
  },
  buy_crypto_batch: {
    columns: [
      'id',
      'created',
      'updated',
      'blockchain',
      'outputAmount',
      'outputAssetId',
      'outputReferenceAmount',
      'outputReferenceAssetId',
      'status',
    ],
  },
  buy_crypto_fee: {
    columns: [
      'id',
      'created',
      'updated',
      'actualPayoutFeeAmount',
      'actualPayoutFeePercent',
      'actualPurchaseFeeAmount',
      'actualPurchaseFeePercent',
      'allowedTotalFeeAmount',
      'estimatePayoutFeeAmount',
      'estimatePayoutFeePercent',
      'estimatePurchaseFeeAmount',
      'estimatePurchaseFeePercent',
      'feeReferenceAssetId',
    ],
  },
  buy_fiat: {
    columns: [
      'id',
      'created',
      'updated',
      'absoluteFeeAmount',
      'amlCheck',
      'amlReason',
      'amountInChf',
      'amountInEur',
      'bankBatchId',
      'bankDataId',
      'bankFeeAmount',
      'bankFixedFeeAmount',
      'bankPercentFeeAmount',
      'bankTxId',
      'blockchainFee',
      'chargebackAddress',
      'chargebackAllowedBy',
      'chargebackAllowedDate',
      'chargebackAllowedDateUser',
      'chargebackAmount',
      'chargebackAsset',
      'chargebackDate',
      'chargebackReferenceAmount',
      'fiatOutputId',
      'highRisk',
      'inputAmount',
      'inputAsset',
      'inputReferenceAmount',
      'inputReferenceAmountMinusFee',
      'inputReferenceAsset',
      'instantSepa',
      'isComplete',
      'mail1SendDate',
      'mail2SendDate',
      'mail3SendDate',
      'mailReturnSendDate',
      'minFeeAmount',
      'minFeeAmountFiat',
      'outputAmount',
      'outputAssetId',
      'outputDate',
      'outputReferenceAmount',
      'outputReferenceAssetId',
      'partnerFeeAmount',
      'paymentLinkFee',
      'percentFee',
      'percentFeeAmount',
      'priceDefinitionAllowedDate',
      'quoteMarketRatio',
      'refFactor',
      'refProvision',
      'sellId',
      'status',
      'totalFeeAmount',
      'totalFeeAmountChf',
      'usedPartnerRef',
      'usedRef',
    ],
  },
  checkout_tx: {
    // No card content (cardName / cardBin / cardLast4 / cardFingerPrint / cardIssuer /
    // cardIssuerCountry) and no ip. Payment flow + risk metadata is safe; `reference` and
    // `description` are merchant-supplied short strings already visible to support staff.
    columns: [
      'id',
      'created',
      'updated',
      'amount',
      'approved',
      'authStatusReason',
      'currency',
      'description',
      'expiresOn',
      'paymentId',
      'reference',
      'requestedOn',
      'risk',
      'riskScore',
      'status',
      'type',
    ],
  },
  country: {
    columns: [
      'id',
      'created',
      'updated',
      'amlRule',
      'bankEnable',
      'bankTransactionVerificationEnable',
      'checkoutEnable',
      'cryptoEnable',
      'dfxEnable',
      'dfxOrganizationEnable',
      'enabledKycDocuments',
      'fatfEnable',
      'foreignName',
      'ipEnable',
      'lockEnable',
      'manualReviewRequired',
      'manualReviewRequiredOrganization',
      'name',
      'nationalityEnable',
      'nationalityStepEnable',
      'symbol',
      'symbol3',
      'yapealEnable',
    ],
  },
  crypto_input: {
    // Pay-in pipeline state. On-chain identifiers (inTxId/outTxId/returnTxId/prepareTxId,
    // addressAddress, blockHeight) are public chain data. `senderAddresses` (text, may be
    // multiple) and `recipientMail` stay out — same redaction rule as elsewhere.
    columns: [
      'id',
      'created',
      'updated',
      'action',
      'addressAddress',
      'addressBlockchain',
      'amount',
      'assetId',
      'blockHeight',
      'chargebackAmount',
      'destinationAddressAddress',
      'destinationAddressBlockchain',
      'forwardFeeAmount',
      'forwardFeeAmountChf',
      'inTxId',
      'isConfirmed',
      'mailReturnSendDate',
      'outTxId',
      'paymentLinkPaymentId',
      'paymentQuoteId',
      'prepareTxId',
      'purpose',
      'returnTxId',
      'routeId',
      'status',
      'txSequence',
      'txType',
    ],
  },
  crypto_staking: {
    columns: [
      'id',
      'created',
      'updated',
      'inTxId',
      'inputAmount',
      'inputAmountInChf',
      'inputAmountInEur',
      'inputAsset',
      'inputDate',
      'inputMailSendDate',
      'isReinvest',
      'outTxId',
      'outTxId2',
      'outputAmount',
      'outputAmountInChf',
      'outputAmountInEur',
      'outputAsset',
      'outputDate',
      'outputMailSendDate',
      'paybackDepositId',
      'payoutType',
      'readyToPayout',
      'stakingRouteId',
    ],
  },
  custody_account: {
    columns: ['id', 'created', 'updated', 'description', 'ownerId', 'requiredSignatures', 'status', 'title'],
  },
  custody_account_access: {
    columns: ['id', 'created', 'updated', 'accessLevel', 'accountId', 'userDataId'],
  },
  custody_balance: {
    columns: ['id', 'created', 'updated', 'accountId', 'assetId', 'balance', 'userId'],
  },
  custody_order: {
    columns: [
      'id',
      'created',
      'updated',
      'accountId',
      'amountInChf',
      'buyId',
      'initiatedById',
      'inputAmount',
      'inputAssetId',
      'outputAmount',
      'outputAssetId',
      'sellId',
      'status',
      'swapId',
      'type',
      'userId',
    ],
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
    // Exchange-side trade/withdrawal records. All fields are operational metadata sent to /
    // received from the exchange API (Kraken, Binance, …). `address` is on-chain.
    columns: [
      'id',
      'created',
      'updated',
      'address',
      'amount',
      'amountChf',
      'asset',
      'cost',
      'currency',
      'exchange',
      'externalCreated',
      'externalId',
      'externalUpdated',
      'feeAmount',
      'feeAmountChf',
      'feeCurrency',
      'leverage',
      'margin',
      'method',
      'order',
      'orderType',
      'pair',
      'price',
      'side',
      'status',
      'symbol',
      'tradeId',
      'txId',
      'type',
      'vol',
    ],
  },
  faucet_request: {
    columns: ['id', 'created', 'updated', 'amount', 'assetId', 'status', 'txId', 'userDataId', 'userId'],
  },
  fee: {
    // Pricing-tier definitions. `excludedUserDatas` excluded — lists specific user IDs that
    // get special treatment, which would let a debug user enumerate VIPs.
    columns: [
      'id',
      'created',
      'updated',
      'accountType',
      'active',
      'annualUserTxVolumes',
      'assets',
      'bankId',
      'blockchainFactor',
      'excludedAssets',
      'expiryDate',
      'fiats',
      'financialTypes',
      'fixed',
      'label',
      'maxAnnualUserTxVolume',
      'maxTxUsages',
      'maxTxVolume',
      'maxUsages',
      'minTxVolume',
      'paymentMethodsIn',
      'paymentMethodsOut',
      'payoutRefBonus',
      'rate',
      'specialCode',
      'txUsages',
      'type',
      'usages',
      'walletId',
    ],
  },
  fiat: {
    // `ibanCountryConfig` excluded — admin-set JSON config, not on safe-string list. Add
    // back if a debug investigation needs it.
    columns: [
      'id',
      'created',
      'updated',
      'amlRuleFrom',
      'amlRuleTo',
      'approxPriceChf',
      'buyable',
      'cardBuyable',
      'cardSellable',
      'instantBuyable',
      'instantSellable',
      'name',
      'priceRuleId',
      'refundEnabled',
      'sellable',
    ],
  },
  fiat_output: {
    // No iban / accountNumber / bic / aba / name / address / city / country. Also
    // excluded: `creditInstitution` (free-text bank name) and `info` (free-text operational
    // notes) — neither is on the known-safe identifier list.
    columns: [
      'id',
      'created',
      'updated',
      'amount',
      'bankId',
      'batchAmount',
      'batchId',
      'charge',
      'currency',
      'endToEndId',
      'instrId',
      'isApprovedDate',
      'isComplete',
      'isConfirmedDate',
      'isInstant',
      'isReadyDate',
      'isTransmittedDate',
      'olkyOrderId',
      'originEntityId',
      'outputDate',
      'pmtInfId',
      'reportCreated',
      'type',
      'valutaDate',
      'yapealMsgId',
    ],
  },
  ip_log: {
    // No ip / country / address — IP-tracking PII. No `url` — captured value is `req.url`
    // with its full query string, which embeds OAuth `?code=…` tokens (e.g.
    // `/v1/auth/alby/redirect/{id}?code=…`) and other short-lived secrets.
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
    columns: [
      'id',
      'created',
      'updated',
      'name',
      'reminderSentDate',
      'sequenceNumber',
      'sessionId',
      'status',
      'transactionId',
      'type',
      'userDataId',
    ],
  },
  language: {
    columns: ['id', 'created', 'updated', 'enable', 'foreignName', 'name', 'symbol'],
  },
  limit_request: {
    // Workflow / decision metadata only. No `fundOriginText` (free-form) and no `recipientMail`.
    columns: [
      'id',
      'created',
      'updated',
      'acceptedLimit',
      'clerk',
      'decision',
      'edited',
      'fundOrigin',
      'investmentDate',
      'limit',
      'mailSendDate',
    ],
  },
  limit_request_log: {
    columns: ['id', 'created', 'updated', 'limitRequestId'],
  },
  liquidity_balance: {
    columns: ['id', 'created', 'updated', 'amount', 'assetId', 'availableAmount', 'isDfxOwned'],
  },
  liquidity_management_action: {
    columns: ['id', 'created', 'updated', 'command', 'onFailId', 'onSuccessId', 'params', 'system', 'tag'],
  },
  liquidity_management_order: {
    // `errorMessage` removed — `text` column stores exception strings that may include
    // operational context. `eagerId` removed — was a misparse of `@ManyToOne({ eager: true })`;
    // the real FK is `pipelineId`.
    columns: [
      'id',
      'created',
      'updated',
      'actionId',
      'correlationId',
      'inputAmount',
      'inputAsset',
      'maxAmount',
      'minAmount',
      'outputAmount',
      'outputAsset',
      'pipelineId',
      'previousCorrelationIds',
      'previousOrderId',
      'status',
    ],
  },
  liquidity_management_pipeline: {
    columns: [
      'id',
      'created',
      'updated',
      'currentActionId',
      'maxAmount',
      'minAmount',
      'ordersProcessed',
      'previousActionId',
      'status',
      'type',
      'uniqueId',
    ],
  },
  liquidity_management_rule: {
    columns: [
      'id',
      'created',
      'updated',
      'context',
      'deficitStartActionId',
      'delayActivation',
      'limit',
      'maximal',
      'minimal',
      'optimal',
      'reactivationTime',
      'redundancyStartActionId',
      'sendNotifications',
      'status',
      'targetFiatId',
    ],
  },
  liquidity_order: {
    columns: [
      'id',
      'created',
      'updated',
      'chain',
      'context',
      'correlationId',
      'estimatedTargetAmount',
      'feeAmount',
      'feeAssetId',
      'isComplete',
      'isReady',
      'purchasedAmount',
      'referenceAmount',
      'referenceAssetId',
      'strategy',
      'swapAmount',
      'swapAssetId',
      'targetAmount',
      'targetAssetId',
      'txId',
      'type',
    ],
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
    // No data (free-form JSON payload that may contain PII).
    // No error (may include internal stack traces / external API error bodies).
    columns: [
      'id',
      'created',
      'updated',
      'context',
      'correlationId',
      'debounce',
      'isComplete',
      'lastTryDate',
      'suppressRecurring',
      'type',
      'userDataId',
    ],
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
    // `paymentRequest` is the BOLT-11 invoice / on-chain transfer request — already public
    // via the POS QR code. `paymentHash` is the hash of the Lightning preimage — public.
    columns: [
      'id',
      'created',
      'updated',
      'amount',
      'assetId',
      'expiryDate',
      'method',
      'paymentHash',
      'paymentId',
      'paymentRequest',
      'quoteId',
      'standard',
      'status',
    ],
  },
  payment_link: {
    // No comment / label / regionManager / storeManager / storeOwner / webhookUrl.
    columns: ['id', 'created', 'updated', 'externalId', 'mode', 'publicStatus', 'routeId', 'status', 'uniqueId'],
  },
  payment_link_payment: {
    // `note` and `deviceCommand` excluded — both are free-form merchant-supplied text and
    // could carry receipt-flavoured PII (customer names, addresses) or arbitrary printer
    // payloads.
    columns: [
      'id',
      'created',
      'updated',
      'amount',
      'currencyId',
      'deviceId',
      'externalId',
      'expiryDate',
      'isConfirmed',
      'linkId',
      'mode',
      'status',
      'txCount',
      'uniqueId',
    ],
  },
  payment_merchant: {
    columns: ['id', 'created', 'updated', 'externalId', 'status', 'userId'],
  },
  payment_quote: {
    // No tx (raw tx data may contain addresses).
    columns: [
      'id',
      'created',
      'updated',
      'expiryDate',
      'paymentId',
      'standard',
      'status',
      'txBlockchain',
      'txId',
      'uniqueId',
    ],
  },
  payout_order: {
    // `lastError` excluded — 2048-char text from external API failure modes.
    columns: [
      'id',
      'created',
      'updated',
      'amount',
      'assetId',
      'chain',
      'context',
      'correlationId',
      'destinationAddress',
      'lastAttemptDate',
      'payoutFeeAmount',
      'payoutFeeAmountChf',
      'payoutFeeAssetId',
      'payoutTxId',
      'preparationFeeAmount',
      'preparationFeeAmountChf',
      'preparationFeeAssetId',
      'retryCount',
      'status',
      'transferTxId',
    ],
  },
  price_rule: {
    // Pricing-source configuration. All operational identifiers/limits, no PII.
    columns: [
      'id',
      'created',
      'updated',
      'assetDisplayName',
      'check1Asset',
      'check1Limit',
      'check1Reference',
      'check1Source',
      'check2Asset',
      'check2Limit',
      'check2Reference',
      'check2Source',
      'currentPrice',
      'priceAsset',
      'priceReference',
      'priceSource',
      'referenceDisplayName',
      'referenceId',
    ],
  },
  recall: {
    // `comment` / `reason` excluded — free-form clerk notes.
    columns: ['id', 'created', 'updated', 'bankTxId', 'checkoutTxId', 'fee', 'sequence', 'userId'],
  },
  recommendation: {
    // recommenderId / recommendedId are the FK linkage db-debug.sh's referral walk needs.
    // recommendedMail is excluded as PII.
    columns: [
      'id',
      'created',
      'updated',
      'code',
      'confirmationDate',
      'expirationDate',
      'isConfirmed',
      'method',
      'recommendedId',
      'recommenderId',
      'type',
    ],
  },
  ref: {
    // No ip — was in old blocklist.
    columns: ['id', 'created', 'updated', 'origin', 'ref'],
  },
  ref_reward: {
    // No recipientMail — was in old blocklist.
    columns: [
      'id',
      'created',
      'updated',
      'amountInChf',
      'amountInEur',
      'inputAmount',
      'inputAsset',
      'inputReferenceAmount',
      'inputReferenceAsset',
      'liquidityPipelineId',
      'mailSendDate',
      'outputAmount',
      'outputAsset',
      'outputDate',
      'outputReferenceAmount',
      'outputReferenceAsset',
      'status',
      'targetAddress',
      'targetBlockchain',
      'txId',
      'userId',
    ],
  },
  reward: {
    // No recipientMail.
    columns: [
      'id',
      'created',
      'updated',
      'amountInChf',
      'amountInEur',
      'inputAmount',
      'inputAsset',
      'inputReferenceAmount',
      'inputReferenceAsset',
      'mailSendDate',
      'outputAmount',
      'outputAsset',
      'outputAssetId',
      'outputDate',
      'outputReferenceAmount',
      'outputReferenceAsset',
      'txId',
    ],
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
    columns: [
      'id',
      'created',
      'updated',
      'active',
      'annualVolume',
      'bankDataId',
      'fiatId',
      'monthlyVolume',
      'type',
      'volume',
    ],
  },
  setting: {
    // `key` is included so a debug investigation can locate a specific setting row by name.
    // `value` is excluded — settings can hold credentials, exchange API config, etc.
    // Listing key names alone discloses the config schema, but that schema is also visible
    // in the codebase; values are the secret part and stay redacted.
    columns: ['id', 'created', 'updated', 'key'],
  },
  sift_error_log: {
    // No `requestPayload` (full Sift request body — may contain card / KYC fields).
    columns: [
      'id',
      'created',
      'updated',
      'duration',
      'errorMessage',
      'eventType',
      'httpStatusCode',
      'isTimeout',
      'userId',
    ],
  },
  special_external_account: {
    columns: ['id', 'created', 'updated'],
  },
  staking: {
    columns: ['id', 'created', 'updated'],
  },
  staking_ref_reward: {
    // No recipientMail.
    columns: [
      'id',
      'created',
      'updated',
      'amountInChf',
      'amountInEur',
      'inputAmount',
      'inputAsset',
      'inputReferenceAmount',
      'inputReferenceAsset',
      'mailSendDate',
      'outputAmount',
      'outputAsset',
      'outputDate',
      'outputReferenceAmount',
      'outputReferenceAsset',
      'stakingId',
      'stakingRefType',
      'txId',
      'userId',
    ],
  },
  staking_reward: {
    // No recipientMail.
    columns: [
      'id',
      'created',
      'updated',
      'amountInChf',
      'amountInEur',
      'fee',
      'inputAmount',
      'inputAsset',
      'inputDate',
      'inputReferenceAmount',
      'inputReferenceAsset',
      'internalId',
      'mailSendDate',
      'outputAmount',
      'outputAsset',
      'outputDate',
      'outputReferenceAmount',
      'outputReferenceAsset',
      'payoutType',
      'stakingId',
      'txId',
    ],
  },
  step_log: {
    columns: ['id', 'created', 'updated', 'eventDate', 'status', 'type'],
  },
  support_issue: {
    // No `name` (customer-supplied title), no `information` (free-form), no `uid` (secret id).
    // Workflow metadata is safe.
    columns: [
      'id',
      'created',
      'updated',
      'clerk',
      'department',
      'reason',
      'state',
      'transactionId',
      'transactionRequestId',
      'type',
      'userDataId',
    ],
  },
  support_issue_log: {
    columns: ['id', 'created', 'updated', 'supportIssueId'],
  },
  support_issue_template: {
    // No authorMail / contentDe / contentEn — free-form / contact info.
    columns: ['id', 'created', 'updated', 'authorId'],
  },
  support_log: {
    // `message` / `comment` excluded — free-form clerk notes.
    columns: ['id', 'created', 'updated', 'clerk', 'eventDate', 'type', 'userDataId'],
  },
  support_message: {
    // No `message` / `fileUrl` (customer content). `author` ('Customer' / 'AutoResponder' /
    // staff name) is needed to interpret message direction.
    columns: ['id', 'created', 'updated', 'author', 'issueId'],
  },
  support_note: {
    // No content / subject / authorMail.
    columns: ['id', 'created', 'updated', 'authorId', 'department', 'userDataId'],
  },
  swap: {
    columns: [
      'id',
      'created',
      'updated',
      'active',
      'annualVolume',
      'assetId',
      'monthlyVolume',
      'targetDepositId',
      'type',
      'volume',
    ],
  },
  system_state_snapshot: {
    // `data` is a JSON dump of subsystem metrics — internal observability values only.
    columns: ['id', 'created', 'updated', 'data'],
  },
  tfa_log: {
    columns: ['id', 'created', 'updated', 'eventDate', 'type'],
  },
  trading_order: {
    // `errorMessage` removed — unbounded text from exception messages can carry operational
    // context. Status alone is enough for debug; reach for App Insights traces for details.
    columns: [
      'id',
      'created',
      'updated',
      'amountExpected',
      'amountIn',
      'amountOut',
      'assetInId',
      'assetOutId',
      'price1',
      'price2',
      'price3',
      'priceImpact',
      'profitChf',
      'status',
      'swapFeeAmount',
      'swapFeeAmountChf',
      'tradingRuleId',
      'txFeeAmount',
      'txFeeAmountChf',
      'txId',
    ],
  },
  trading_rule: {
    columns: [
      'id',
      'created',
      'updated',
      'leftAsset1',
      'leftAsset2',
      'leftAsset3',
      'leftAssetId',
      'lowerLimit',
      'lowerTarget',
      'poolFee',
      'reactivationTime',
      'rightAsset1',
      'rightAsset2',
      'rightAsset3',
      'rightAssetId',
      'source1',
      'source2',
      'source3',
      'status',
      'upperLimit',
      'upperTarget',
    ],
  },
  transaction: {
    // No recipientMail / uid.
    columns: [
      'id',
      'created',
      'updated',
      'amlCheck',
      'amlType',
      'amountInChf',
      'eventDate',
      'externalId',
      'feeAmountInChf',
      'highRisk',
      'mailSendDate',
      'outputDate',
      'sourceType',
      'type',
      'userDataId',
      'userId',
    ],
  },
  transaction_request: {
    columns: [
      'id',
      'created',
      'updated',
      'amount',
      'dfxFee',
      'error',
      'estimatedAmount',
      'exchangeRate',
      'externalTransactionId',
      'isValid',
      'networkFee',
      'paymentLink',
      'paymentRequest',
      'rate',
      'routeId',
      'sourceId',
      'sourcePaymentMethod',
      'status',
      'targetId',
      'targetPaymentMethod',
      'totalFee',
      'type',
      'uid',
      'userId',
    ],
  },
  transaction_risk_assessment: {
    // No `reason` / `methods` / `summary` / `result` / `pdf` — assessment body (free-form,
    // may include PII / case details). Metadata fields are safe.
    columns: ['id', 'created', 'updated', 'author', 'date', 'status', 'transactionId', 'type'],
  },
  transaction_specification: {
    columns: ['id', 'created', 'updated', 'asset', 'direction', 'minConfirmations', 'minFee', 'minVolume', 'system'],
  },
  user: {
    // No ip / ipCountry / apiKeyCT / signature / label / comment — old blocklist.
    // Also excluded: `apiFilterCT` — sibling of the blocked `apiKeyCT`, operational config
    // tied to the partner-API integration.
    columns: [
      'id',
      'created',
      'updated',
      'address',
      'addressType',
      'annualBuyVolume',
      'annualCryptoVolume',
      'annualSellVolume',
      'approved',
      'buyVolume',
      'custodyAccountId',
      'custodyAddressIndex',
      'custodyAddressType',
      'custodyProviderId',
      'deactivationDate',
      'monthlyBuyVolume',
      'monthlyCryptoVolume',
      'monthlySellVolume',
      'origin',
      'paidRefCredit',
      'partnerRefCredit',
      'partnerRefVolume',
      'primaryUserId',
      'refAssetId',
      'refCredit',
      'refFeePercent',
      'refPayoutFrequency',
      'refVolume',
      'role',
      'sellVolume',
      'status',
      'travelRulePdfDate',
      'usedRef',
      'userDataId',
      'walletId',
      'walletType',
    ],
  },
  user_data: {
    // No PII columns. countryId / nationalityId / organizationId / verifiedCountryId /
    // accountOpenerId / organizationCountryId all blocked (link to PII tables).
    columns: [
      'id',
      'created',
      'updated',
      'accountType',
      'amlAccountType',
      'amlListAddedDate',
      'amlListExpiredDate',
      'amlListReactivatedDate',
      'amlListStatus',
      'annualBuyVolume',
      'annualCryptoVolume',
      'annualSellVolume',
      'bankTransactionVerification',
      'buyVolume',
      'cryptoVolume',
      'currencyId',
      'deactivationDate',
      'depositLimit',
      'hasBankTx',
      'hasIpRisk',
      'highRisk',
      'identificationType',
      'kycClients',
      'kycFileId',
      'kycLevel',
      'kycStatus',
      'kycType',
      'languageId',
      'lastNameCheckDate',
      'letterSendDate',
      'manualReviewRequired',
      'moderator',
      'monthlyBuyVolume',
      'monthlyCryptoVolume',
      'monthlySellVolume',
      'olkypayAllowed',
      'paymentLinksAllowed',
      'pep',
      'phoneCallAccepted',
      'phoneCallCheckDate',
      'phoneCallExternalAccountCheckDate',
      'phoneCallIpCheckDate',
      'phoneCallIpCountryCheckDate',
      'phoneCallStatus',
      'phoneCallTimes',
      'postAmlCheck',
      'recallAgreementAccepted',
      'riskStatus',
      'sellVolume',
      'status',
      'totalCustodyBalanceChfAuditPeriod',
      'totalVolumeChfAuditPeriod',
      'tradeApprovalDate',
      'walletId',
    ],
  },
  user_data_relation: {
    columns: ['id', 'created', 'updated', 'accountId', 'relatedAccountId', 'relation', 'signatory'],
  },
  virtual_iban: {
    // No `iban` / `bban` / `label` (PII / free-form). Lifecycle + external bank id are safe.
    columns: [
      'id',
      'created',
      'updated',
      'activatedAt',
      'active',
      'bankId',
      'buyId',
      'currencyId',
      'deactivatedAt',
      'reservedUntil',
      'status',
      'userDataId',
      'yapealAccountUid',
    ],
  },
  wallet: {
    // No apiKey / apiUrl — old blocklist.
    columns: [
      'id',
      'created',
      'updated',
      'amlRules',
      'autoTradeApproval',
      'buySpecificIbanEnabled',
      'customKyc',
      'displayFraudWarning',
      'displayName',
      'exceptAmlRules',
      'identMethod',
      'isKycClient',
      'name',
      'ownerId',
      'usesDummyAddresses',
    ],
  },
  wallet_app: {
    columns: [
      'id',
      'created',
      'updated',
      'active',
      'appStoreUrl',
      'assets',
      'blockchains',
      'deepLink',
      'hasActionDeepLink',
      'iconUrl',
      'name',
      'playStoreUrl',
      'recommended',
      'semiCompatible',
      'websiteUrl',
    ],
  },
  webhook: {
    // No `data` (free-form merchant payload, may carry PII).
    // No `error` (text column with the merchant endpoint's response body — may echo back the
    // payload). `reason` is length-256 short status — safe.
    columns: [
      'id',
      'created',
      'updated',
      'identifier',
      'isComplete',
      'lastTryDate',
      'reason',
      'type',
      'userDataId',
      'userId',
      'walletId',
    ],
  },
};

export const DebugLogQueryTemplates: Record<
  LogQueryTemplate,
  { kql: string; requiredParams: (keyof LogQueryDto)[]; defaultLimit: number }
> = {
  [LogQueryTemplate.TRACES_BY_OPERATION]: {
    // Self-audit lines from /gs/debug and /gs/debug/logs are filtered out so a DEBUG user
    // can't read another DEBUG user's audit history by guessing or sweeping operationIds.
    kql: `traces
| where operation_Id == "{operationId}"
| where timestamp > ago({hours}h)
| where not(message startswith "[GsService] ${LogQueryAuditPrefix}")
| where not(message startswith "[GsService] ${DebugQueryAuditPrefix}")
| project timestamp, severityLevel, message, customDimensions
| order by timestamp desc`,
    requiredParams: ['operationId'],
    defaultLimit: 500,
  },
  [LogQueryTemplate.TRACES_BY_MESSAGE]: {
    // Self-audit lines filtered for the same reason as TRACES_BY_OPERATION above. Critical
    // here because the caller supplies a free-form substring filter — without this, a DEBUG
    // user can read another DEBUG user's full audit-line history by passing the audit prefix
    // as messageFilter.
    kql: `traces
| where timestamp > ago({hours}h)
| where message contains "{messageFilter}"
| where not(message startswith "[GsService] ${LogQueryAuditPrefix}")
| where not(message startswith "[GsService] ${DebugQueryAuditPrefix}")
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
    // Returns all trace entries in the given window. Self-emitted audit lines from
    // /gs/debug ("Debug-query by ...") and /gs/debug/logs ("Log query by ...") are filtered
    // out at the source so a DEBUG user can't read another DEBUG user's audit history, and
    // so high-frequency dashboard callers don't recursively self-match. The "[GsService] "
    // prefix is added by DfxLogger's class-context; the audit-prefix constants are shared
    // with the emitters in gs.service.ts.
    kql: `traces
| where timestamp > ago({hours}h)
| where not(message startswith "[GsService] ${LogQueryAuditPrefix}")
| where not(message startswith "[GsService] ${DebugQueryAuditPrefix}")
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
