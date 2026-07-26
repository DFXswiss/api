import { DebugWhereOp } from 'src/subdomains/generic/gs/dto/debug-query.dto';

export const GsRestrictedMarker = '[RESTRICTED]';

// db endpoint
export const GsRestrictedColumns: Record<string, string[]> = {
  asset: ['ikna'],
  // PII / free-form on the amlCheck audit trail: `amlResponsible` can name a real compliance officer
  // and `comment` is the internal joined-AmlError / manual-note text. Both stay masked on `/gs/db`
  // for every role below SUPER_ADMIN. `amlResponsible` is additionally reachable on `/gs/debug` —
  // see `DebugRestrictedOverlapExceptions`; `comment` is not, and the startup invariant below still
  // rejects it (and any other future overlap that is not listed as an explicit exception).
  transaction_aml_check: ['amlResponsible', 'comment'],
};

// Prefix of the verbose audit message emitted by `gs.service.executeDebugQuery`
// (`[GsService] Debug-query by ...`). The leading `[GsService] ` is prepended by
// `DfxLogger` from the `GsService` class name, not from this constant.
export const DebugQueryAuditPrefix = 'Debug-query by ';

// Debug endpoint
export const DebugMaxResults = 10000;

// --- Structured /gs/debug allowlist ---
//
// The /gs/debug endpoint accepts a JSON request describing the query (table + select + where
// + group/order/limit) and emits hand-built SQL with bound parameters via `dataSource.query`.
// No raw SQL is ever accepted, parsed, or interpolated — identifiers come exclusively from
// this allowlist and values flow through bound parameters.
//
// Update on every migration: adding / renaming / removing a column on a table that appears
// below requires editing this allowlist. Adding a new debuggable table requires a new entry.
// Anything not listed is unreachable from /gs/debug.
//
// Conservative inclusion rules — exclude these categories of columns even when present on
// the entity:
//   - PII (from selectable / result columns): names, addresses, phone, mail, birthday,
//     nationality/country FKs on user_data, organization PII, IBANs, BICs, account numbers.
//     Explicitly reviewed **filter-only** exceptions may appear in `filterOnlyColumns` only
//     (currently `user_data.mail`) — WHERE `=` lookup, never returned in the result set.
//   - Secrets: apiKey, apiKeyCT, apiUrl, totpSecret, signature, kycHash, uid, pdfUrl.
//   - Free-form text: label, internalAmlNote, txInfo, raw, data, message (except log.message
//     which is the whole point of the endpoint). `comment` is a deliberate exception: it is
//     exposed ONLY on buy_crypto / buy_fiat, where it stores the ';'-joined AmlError code list
//     (e.g. 'ScorechainHighRisk') needed for AML/Scorechain forensics on this admin-only DEBUG
//     endpoint. It can also carry admin-entered notes, so it stays excluded on every other table.
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
  // Columns usable ONLY as a WHERE-leaf column. Never selectable, never orderable, never
  // groupable, never usable with a `jsonbPath`. Restricted to the equality operator
  // (`DebugFilterOnlyAllowedOps`). At most one filter-only predicate is allowed per query
  // (anywhere in the WHERE tree) so multi-candidate batching cannot be reintroduced via
  // OR/AND of several `=` leaves. Intended for looking a record up by a value the caller
  // already knows, without the endpoint ever disclosing that value. MUST be disjoint from
  // `columns` and `jsonbColumns` (enforced by `assertDebugAllowlistInvariants`).
  // Expected to be **text** columns: equality is emitted case-insensitively as
  // `LOWER(col) = LOWER($n)` so the lookup matches the application's own case-insensitive
  // address identity (`getUsersByMail` via `LOWER(mail)`) and tolerates the caller typing
  // a different case than stored. A non-text filter-only column (e.g. integer) would fail
  // at query time (`function lower(integer) does not exist`). No runtime type check — keep
  // entries text-only when extending this list. For `user_data.mail`, `LOWER(mail)` is
  // backed by a functional index (non-unique while case-collision duplicates remain); that
  // is not a general guarantee for every future filter-only column.
  filterOnlyColumns?: string[];
}

// Operators a filter-only column may appear with in a WHERE leaf. Ordering/range/pattern
// operators (`<`, `<=`, `>`, `>=`, `!=`, `LIKE`, `ILIKE`, `IS NULL`, `IS NOT NULL`) would turn
// the endpoint into an oracle — a caller could binary-search or pattern-match a secret value
// character by character and reconstruct it without ever selecting it. `=` requires knowing
// the exact value up front, which is the intended use case. Multi-candidate batching is
// prevented by the one-filter-only-predicate-per-query rule in the emitter (not by excluding
// `IN` alone — OR of several `=` leaves would otherwise re-enable the same batching). `IN`
// remains disallowed because a multi-value list has no legitimate filter-only use.
export const DebugFilterOnlyAllowedOps: DebugWhereOp[] = [DebugWhereOp.EQ];

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
  aktionariat_registration: {
    // RealUnit Aktionariat share-register registrations (one row per wallet). Exposes the
    // registration lifecycle and the email-confirmation latch for support forensics. No PII:
    // `email` is excluded (mail), `signature` / `signedPayload` / `kycData` are excluded
    // (secrets / free-form JSON carrying personal data).
    columns: [
      'id',
      'created',
      'updated',
      'active',
      'confirmedDate',
      'forwardedToAktionariatDate',
      'registrationDate',
      'requiresEmailConfirmation',
      'status',
      'userId',
      'walletAddress',
    ],
  },
  asset: {
    // No `ikna` — it's the sole entry in `GsRestrictedColumns`, which `/gs/db` masks to
    // `[RESTRICTED]` for everyone except SUPER_ADMIN. The structured `/gs/debug` endpoint
    // doesn't apply that masking, so allowlisting it would bypass the deliberate
    // SUPER_ADMIN-only restriction. The startup assertion below enforces that
    // `DebugAllowedColumns` and `GsRestrictedColumns` never overlap.
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
      'assetId',
      'bic',
      'currency',
      'iban',
      'name',
      'receive',
      'sctInst',
      'send',
      'sendPriority',
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
    // No `memberId` — it's the counterparty clearing-system member ID set by the SEPA
    // parser from the debtor/creditor agent. Same routing-data class as the excluded
    // `bic` / `aba`.
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
    // No annualVolume / monthlyVolume / volume — those columns live on the `buy` entity, not
    // buy_crypto. Listing them here made /gs/debug emit SQL that errors ("Query execution
    // failed") because the physical columns don't exist on this table.
    columns: [
      'id',
      'created',
      'updated',
      'absoluteFeeAmount',
      'amlCheck',
      'amlReason',
      'amountInChf',
      'amountInEur',
      'bankDataId',
      'bankFeeAmount',
      'bankFixedFeeAmount',
      'bankPercentFeeAmount',
      'bankTxId',
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
      'checkoutTxId',
      'comment', // AML error-code list (incl. 'ScorechainHighRisk') — see header note
      'cryptoInputId',
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
      'transactionId',
      'txId',
      'usedPartnerRef',
      'usedRef',
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
    // No `status` — buy_fiat has no physical `status` column (unlike buy_crypto). Its
    // transaction state is computed in the history mapper (getTransactionStateDetails), never
    // stored, so listing `status` here made /gs/debug emit SQL that errors ("Query execution
    // failed") against a non-existent column. The stored, queryable status is `amlCheck`.
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
      'comment', // AML error-code list (incl. 'ScorechainHighRisk') — see header note
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
    // No `title` (varchar 256) / `description` (text) — both are user-supplied free-form
    // text written unsanitized from the create DTO. Same risk class as the excluded
    // `support_issue.name` and `payment_link.label`.
    columns: ['id', 'created', 'updated', 'ownerId', 'requiredSignatures', 'status'],
  },
  custody_account_access: {
    columns: ['id', 'created', 'updated', 'accessLevel', 'accountId', 'userDataId', 'active', 'deactivatedAt'],
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
      'completedAt',
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
    // Physical single table for the Sell/Swap/Staking route STI hierarchy (@ChildEntity of
    // DepositRoute, discriminated by `type`). There are no physical `sell`/`swap`/`staking` tables —
    // query a subtype here with a `type` filter (Swap discriminator is 'Crypto'). Subtype columns:
    // bankDataId/fiatId are Sell, assetId/targetDepositId are Swap. No iban.
    columns: [
      'id',
      'created',
      'updated',
      'active',
      'annualVolume',
      'assetId',
      'bankDataId',
      'fiatId',
      'monthlyVolume',
      'targetDepositId',
      'type',
      'volume',
    ],
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
      'scryptDepositNotifiedDate',
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
  kyc_log: {
    // No comment / ipAddress / result / pdfUrl.
    // This is the single physical table; the various `@ChildEntity` classes
    // (`kyc_file_log`, `mail_change_log`, `manual_log`, `merge_log`, `name_check_log`,
    // `risk_status_log`, `step_log`, `tfa_log`) all share this table and are
    // discriminated by `type`. Filter with `where: {column: 'type', op: '=', value: 'X'}`
    // to isolate one subtype.
    columns: ['id', 'created', 'updated', 'eventDate', 'fileId', 'type', 'userDataId'],
  },
  kyc_step: {
    // No `result` / `comment` (free-form text). No `sessionId` — it's the live
    // ident-provider bearer token returned by `initiateIdent()`, valid for 30 days
    // (`identFailAfterDays`), and used verbatim as the ident-launch URL. Same secrets
    // class as `apiKeyCT` / `totpSecret`.
    columns: [
      'id',
      'created',
      'updated',
      'name',
      'reminderSentDate',
      'sequenceNumber',
      'status',
      'transactionId',
      'type',
      'userDataId',
    ],
  },
  language: {
    columns: ['id', 'created', 'updated', 'enable', 'foreignName', 'name', 'symbol'],
  },
  ledger_account: {
    // Double-entry ledger chart-of-accounts (monitoring-only). Account names are deterministic system
    // labels (e.g. 'Frick/EUR', 'LIABILITY/...'); the only non-fixed part is the counterparty
    // institution name embedded in untracked-bank SUSPENSE account names, sourced from bank.name or
    // bank_tx.bankName — both already exposed on the /gs/debug allowlist. No customer PII / secrets.
    columns: ['id', 'created', 'updated', 'active', 'assetId', 'currency', 'name', 'type'],
  },
  ledger_leg: {
    // Individual debit/credit legs of a ledger transaction. Numeric amounts + FK ids for traversal
    // (txId -> ledger_tx, accountId -> ledger_account); no PII / secrets / free-form text.
    columns: [
      'id',
      'created',
      'updated',
      'accountId',
      'amount',
      'amountBaseUnits',
      'amountChf',
      'amountChfCents',
      'needsMark',
      'priceChf',
      'txId',
    ],
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
  // `mros` is deliberately NOT listed. Each row is a regulatory report filed with the FIU
  // (Money laundering Reporting Office), and the SUBJECT of such a report is legally
  // confidential. Even the bare `userDataId` FK is sensitive — it discloses
  // report-subject membership and lets it be correlated through other allowlisted tables.
  // This table should only be reachable by compliance, never by a DEBUG caller. The
  // structured endpoint has no per-table masking, so the safe answer is to leave it
  // unreachable — `executeDebugQuery`'s `Object.hasOwn` table guard rejects with a 400.
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
      'releasedPayoutTxIds',
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
      'outputAssetId',
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
  route: {
    columns: ['id', 'created', 'updated'],
  },
  sanction: {
    columns: ['id', 'created', 'updated', 'address', 'currency'],
  },
  // Scorechain on-chain AML screening results. Keyed by the screened blockchain object
  // (`objectId` = on-chain tx id / address, public-by-nature) + `blockchain`, not by a tx FK —
  // correlate to a buy_crypto / buy_fiat via its inTxId / output address. Lower `riskScore` =
  // higher risk (1 = Critical … 100 = None). `riskIndicators` (the provider's per-analysis risk
  // breakdown = the "why" behind the score) and `rawResponse` (full provider payload) are the
  // free-form JSON columns; exposed here for AML/Scorechain forensics on this admin-only DEBUG
  // endpoint (Scorechain screens on-chain objects — an address / tx — not customer PII).
  scorechain_screening: {
    columns: [
      'id',
      'created',
      'updated',
      'analysisType',
      'blockchain',
      'context',
      'objectId',
      'objectType',
      'rawResponse',
      'riskIndicators',
      'riskScore',
      'severity',
      'signatureValid',
      'triggerType',
    ],
  },
  setting: {
    // `value` is now readable via /gs/debug (data-owner-approved 2026-07-22); genuine
    // secrets/credentials live in the Vault, not this table. The column can still hold
    // internal IP/address/clerk lists, and exposing those to the Debug admin role is an
    // accepted decision.
    columns: ['id', 'created', 'updated', 'key', 'value'],
    jsonbColumns: ['value'],
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
      'outputAssetId',
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
      'outputAssetId',
      'outputDate',
      'outputReferenceAmount',
      'outputReferenceAsset',
      'payoutType',
      'stakingId',
      'txId',
    ],
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
  support_issue_template: {
    // No authorMail / contentDe / contentEn — free-form / contact info.
    columns: ['id', 'created', 'updated', 'authorId'],
  },
  support_log: {
    // `message` / `comment` excluded — free-form clerk notes.
    // This is the single physical table; `@ChildEntity` classes (`support_issue_log`,
    // `limit_request_log`) share this table and are discriminated by `type`.
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
  system_state_snapshot: {
    // `data` is a JSON dump of subsystem metrics — internal observability values only.
    columns: ['id', 'created', 'updated', 'data'],
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
    // No `uid` — it's the random capability/lookup token returned to clients as the public
    // `/tx/<uid>` status URL, resolved by the unauthenticated `GET /transaction/single`
    // (no auth, no ownership check) to return the transaction DTO. Allowlisting `uid` here
    // would let a DEBUG caller enumerate working lookup handles for arbitrary users'
    // transactions. Matches the sibling `transaction` allowlist exclusion.
    columns: [
      'id',
      'created',
      'updated',
      'amount',
      'bankId',
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
      'settlementTxId',
      'sourceId',
      'sourcePaymentMethod',
      'status',
      'targetId',
      'targetPaymentMethod',
      'totalFee',
      'type',
      'userId',
      'virtualIbanId',
    ],
  },
  transaction_aml_check: {
    // `amlResponsible` IS allowlisted here as a deliberate, documented exception — without it the
    // audit trail answers "when was this amlCheck changed and by which code path", but never "who
    // approved it", which is the question AML forensics actually needs. It is registered in
    // `DebugRestrictedOverlapExceptions` so the startup invariant accepts the overlap knowingly.
    // Still NO `comment` (free-form internal AmlError names / manual note): it is in
    // `GsRestrictedColumns` without an exception, so the invariant keeps rejecting it.
    columns: [
      'id',
      'created',
      'updated',
      'entityType',
      'entityId',
      'source',
      'previousAmlCheck',
      'amlCheck',
      'previousAmlReason',
      'amlReason',
      'amlResponsible',
      'priceDefinitionAllowedDate',
      'highRisk',
      'transactionId',
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
    // No PII in selectable / result columns. countryId / nationalityId / organizationId /
    // verifiedCountryId / accountOpenerId / organizationCountryId all blocked (link to PII
    // tables). Explicit filter-only exception: `mail` (not in `columns`) — support needs to
    // resolve a customer's `userData.id` from a mail address they already have, without the
    // endpoint ever returning the address. See `filterOnlyColumns` below.
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
      'letterSentDate',
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
    filterOnlyColumns: ['mail'],
  },
  user_data_relation: {
    columns: ['id', 'created', 'updated', 'accountId', 'relatedAccountId', 'relation', 'signatory'],
  },
  virtual_iban: {
    // No `iban` / `bban` / `label` (PII / free-form). No `providerAccountRef` either:
    // that column is provider-dependent — opaque for Yapeal (`accountUid`), but identical
    // to the customer IBAN for Frick (`providerAccountRef: activated.vban`) — so it is not
    // blanket-safe to expose. Lifecycle + FK ids are safe.
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
    ],
  },
  virtual_iban_issuance_event: {
    // No `previousError` / `nextError` (free-form / PII markers). Lifecycle + numeric
    // reference ids + status transitions are safe (`previousVirtualIbanId` /
    // `nextVirtualIbanId` are plain VirtualIban.id scalars, not raw IBANs).
    columns: [
      'id',
      'created',
      'updated',
      'intentId',
      'userDataId',
      'currencyId',
      'bankId',
      'previousStatus',
      'nextStatus',
      'previousVirtualIbanId',
      'nextVirtualIbanId',
    ],
  },
  virtual_iban_issuance_intent: {
    // No `externalIban` / `error` / `requestReference` (PII / free-form / technical
    // capability-lookup token). Lifecycle + FK ids + status are safe.
    columns: [
      'id',
      'created',
      'updated',
      'userDataId',
      'currencyId',
      'bankId',
      'status',
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

// Columns that are deliberately **selectable** on `/gs/debug` even though `/gs/db` masks them
// for every role below SUPER_ADMIN. Each entry is an explicit, reviewed decision to accept that a
// DEBUG-role caller sees the real value in the result set — NOT a general relaxation:
// `/gs/db` masking is unchanged, and every selectable overlap that is not listed here still aborts
// module load below. This map approves **`columns` (selectable) access only**. Filter-only
// (`filterOnlyColumns`) overlaps use `DebugFilterOnlyRestrictedExceptions` instead — the two
// capacities do not share exceptions, so moving a column between `columns` and `filterOnlyColumns`
// fails module load until the approval is moved too (a visible, reviewable step that prevents a
// filter-only exception from silently authorising full disclosure).
//
// Add an entry ONLY when all of the following hold, and record the reasoning in the comment:
//   - the value is needed to answer an operational/forensic question the endpoint exists for,
//   - the `/gs/debug` role gate (`UserRole.DEBUG`) is an acceptable audience for it,
//   - every call is attributable — `executeDebugQuery` audit-logs caller and query.
export const DebugRestrictedOverlapExceptions: Record<string, string[]> = {
  // `transaction_aml_check.amlResponsible` names the compliance staff member (or 'API') behind an
  // amlCheck transition. Without it the trail shows the transition and its `AmlSourceType`, but the
  // accountable actor is unreachable on /gs/debug, so "who approved this transaction" could not be
  // answered from the audit trail at all. Exposed to the DEBUG role by operator decision; access
  // stays attributable through the endpoint's audit log. `comment` on the same table is NOT
  // excepted — it is free-form internal note text and remains rejected.
  transaction_aml_check: ['amlResponsible'],
};

// Columns that are deliberately reachable as **filter-only** (`filterOnlyColumns`) on `/gs/debug`
// even though `/gs/db` masks them for every role below SUPER_ADMIN. Same review bar as
// `DebugRestrictedOverlapExceptions`, but this map approves equality-only WHERE lookup — never
// selection. Keep the two maps disjoint: an entry in both for the same pair is an error (approval
// must be unambiguous about capacity). Empty today: no current filter-only column is restricted
// (`user_data.mail` is filter-only but not in `GsRestrictedColumns`). Add an entry only when a
// restricted column is intentionally allowlisted for equality lookup, with the reasoning in a
// comment next to the entry.
export const DebugFilterOnlyRestrictedExceptions: Record<string, string[]> = {};

/**
 * Invariant: `GsRestrictedColumns` is the per-role masking list that `/gs/db` applies (only
 * SUPER_ADMIN sees the real value). The structured `/gs/debug` endpoint does NOT apply any
 * such masking, so allowlisting any column also listed there would bypass the role
 * restriction. Throw so a future addition can't slip in silently — unless the exact
 * `(table, column)` pair is registered in the capacity-matching exceptions map, which makes
 * the bypass an explicit, documented decision instead of an accident.
 *
 * Capacity is part of the approval: a restricted column in `columns` needs an entry in the
 * selectable map (`DebugRestrictedOverlapExceptions`); a restricted column in
 * `filterOnlyColumns` needs an entry in the filter-only map
 * (`DebugFilterOnlyRestrictedExceptions`). The two maps do not share exceptions — moving a
 * column between capacities fails module load until the approval is moved too, so a
 * filter-only exception cannot silently upgrade into full disclosure.
 *
 * The counter-checks keep both exceptions maps honest: a selectable exception is stale unless
 * the column is in `columns`; a filter-only exception is stale unless the column is in
 * `filterOnlyColumns`; an entry present in both maps for the same pair is an error (approval
 * must be unambiguous); and every entry must still be in `GsRestrictedColumns`.
 *
 * Kept as a pure function over its four inputs so the guard itself is testable with synthetic
 * fixtures — asserting the real constants only proves today's data is consistent, not that the
 * exception matches per column and capacity rather than per table.
 */
export function assertDebugAllowlistInvariants(
  restrictedColumns: Record<string, string[]>,
  allowedColumns: Record<string, DebugTableSpec>,
  selectableExceptions: Record<string, string[]>,
  filterOnlyExceptions: Record<string, string[]>,
): void {
  for (const [table, restricted] of Object.entries(restrictedColumns)) {
    if (!Object.hasOwn(allowedColumns, table)) continue;
    const spec = allowedColumns[table];
    const selectableExcepted = Object.hasOwn(selectableExceptions, table) ? selectableExceptions[table] : [];
    const filterOnlyExcepted = Object.hasOwn(filterOnlyExceptions, table) ? filterOnlyExceptions[table] : [];
    for (const col of restricted) {
      if (spec.columns.includes(col) && !selectableExcepted.includes(col))
        throw new Error(
          `DebugAllowedColumns['${table}'] contains '${col}' which is in GsRestrictedColumns; ` +
            `the /gs/debug endpoint does not apply role masking. Remove it from DebugAllowedColumns ` +
            `or register it in DebugRestrictedOverlapExceptions with a documented reason.`,
        );
      // Same restriction for filter-only columns: a restricted column must not become a
      // WHERE key unless the pair is an explicit, documented filter-only exception.
      if (spec.filterOnlyColumns?.includes(col) && !filterOnlyExcepted.includes(col))
        throw new Error(
          `DebugAllowedColumns['${table}'].filterOnlyColumns contains '${col}' which is in GsRestrictedColumns; ` +
            `the /gs/debug endpoint does not apply role masking. Remove it from filterOnlyColumns ` +
            `or register it in DebugFilterOnlyRestrictedExceptions with a documented reason.`,
        );
    }
  }

  for (const [table, excepted] of Object.entries(selectableExceptions)) {
    for (const col of excepted) {
      if (!(Object.hasOwn(restrictedColumns, table) && restrictedColumns[table].includes(col)))
        throw new Error(
          `DebugRestrictedOverlapExceptions['${table}'] lists '${col}', which is not in ` +
            `GsRestrictedColumns['${table}']; the exception is stale — remove it.`,
        );
      // Selectable exceptions approve `columns` access only — presence in filterOnlyColumns
      // does not keep this entry live.
      if (!(Object.hasOwn(allowedColumns, table) && allowedColumns[table].columns.includes(col)))
        throw new Error(
          `DebugRestrictedOverlapExceptions['${table}'] lists '${col}', which is not in ` +
            `DebugAllowedColumns['${table}'].columns; the exception is stale — remove it.`,
        );
      if (Object.hasOwn(filterOnlyExceptions, table) && filterOnlyExceptions[table].includes(col))
        throw new Error(
          `('${table}', '${col}') is registered in both DebugRestrictedOverlapExceptions and ` +
            `DebugFilterOnlyRestrictedExceptions; approval must be unambiguous about capacity — ` +
            `remove one of the entries.`,
        );
    }
  }

  for (const [table, excepted] of Object.entries(filterOnlyExceptions)) {
    for (const col of excepted) {
      if (!(Object.hasOwn(restrictedColumns, table) && restrictedColumns[table].includes(col)))
        throw new Error(
          `DebugFilterOnlyRestrictedExceptions['${table}'] lists '${col}', which is not in ` +
            `GsRestrictedColumns['${table}']; the exception is stale — remove it.`,
        );
      // Filter-only exceptions approve `filterOnlyColumns` access only.
      if (
        !(
          Object.hasOwn(allowedColumns, table) &&
          Object.hasOwn(allowedColumns[table], 'filterOnlyColumns') &&
          allowedColumns[table].filterOnlyColumns &&
          allowedColumns[table].filterOnlyColumns.includes(col)
        )
      )
        throw new Error(
          `DebugFilterOnlyRestrictedExceptions['${table}'] lists '${col}', which is not in ` +
            `DebugAllowedColumns['${table}'].filterOnlyColumns; the exception is stale — remove it.`,
        );
      if (Object.hasOwn(selectableExceptions, table) && selectableExceptions[table].includes(col))
        throw new Error(
          `('${table}', '${col}') is registered in both DebugRestrictedOverlapExceptions and ` +
            `DebugFilterOnlyRestrictedExceptions; approval must be unambiguous about capacity — ` +
            `remove one of the entries.`,
        );
    }
  }

  // filterOnlyColumns must stay strictly narrower than `columns` / `jsonbColumns` and free of
  // duplicates. Overlap with `columns` would silently make the value selectable; overlap with
  // `jsonbColumns` would open path access; duplicates are almost certainly a config mistake.
  for (const [table, spec] of Object.entries(allowedColumns)) {
    if (!Object.hasOwn(spec, 'filterOnlyColumns') || !spec.filterOnlyColumns) continue;
    const seen = new Set<string>();
    for (const col of spec.filterOnlyColumns) {
      if (seen.has(col))
        throw new Error(`DebugAllowedColumns['${table}'].filterOnlyColumns has duplicate entry '${col}'`);
      seen.add(col);
      if (spec.columns.includes(col))
        throw new Error(
          `DebugAllowedColumns['${table}'].filterOnlyColumns contains '${col}' which is also in columns; ` +
            `a filter-only column must never be selectable.`,
        );
      if (spec.jsonbColumns?.includes(col))
        throw new Error(
          `DebugAllowedColumns['${table}'].filterOnlyColumns contains '${col}' which is also in jsonbColumns; ` +
            `a filter-only column must never support jsonb path access.`,
        );
    }
  }
}

assertDebugAllowlistInvariants(
  GsRestrictedColumns,
  DebugAllowedColumns,
  DebugRestrictedOverlapExceptions,
  DebugFilterOnlyRestrictedExceptions,
);

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
