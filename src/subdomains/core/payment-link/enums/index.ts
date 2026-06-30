import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';

export enum PaymentLinkStatus {
  ACTIVE = 'Active',
  INACTIVE = 'Inactive',
  UNASSIGNED = 'Unassigned',
}

export enum PaymentLinkPaymentStatus {
  PENDING = 'Pending',
  COMPLETED = 'Completed',
  CANCELLED = 'Cancelled',
  EXPIRED = 'Expired',
}

export enum PaymentQuoteStatus {
  ACTUAL = 'Actual',
  CANCELLED = 'Cancelled',
  EXPIRED = 'Expired',

  TX_RECEIVED = 'TxReceived',
  TX_CHECKBOT = 'TxCheckbot',
  TX_MEMPOOL = 'TxMempool',
  TX_BLOCKCHAIN = 'TxBlockchain',
  TX_COMPLETED = 'TxCompleted',
  TX_FAILED = 'TxFailed',
}

export const PaymentQuoteTxStates = [
  PaymentQuoteStatus.TX_RECEIVED,
  PaymentQuoteStatus.TX_CHECKBOT,
  PaymentQuoteStatus.TX_MEMPOOL,
  PaymentQuoteStatus.TX_BLOCKCHAIN,
  PaymentQuoteStatus.TX_COMPLETED,
];

export const PaymentQuoteFinalStates = [
  PaymentQuoteStatus.CANCELLED,
  PaymentQuoteStatus.EXPIRED,
  PaymentQuoteStatus.TX_CHECKBOT,
  PaymentQuoteStatus.TX_MEMPOOL,
  PaymentQuoteStatus.TX_BLOCKCHAIN,
  PaymentQuoteStatus.TX_COMPLETED,
  PaymentQuoteStatus.TX_FAILED,
];

export enum PaymentActivationStatus {
  OPEN = 'Open',
  CLOSED = 'Closed',
}

export enum PaymentLinkPaymentMode {
  SINGLE = 'Single',
  MULTIPLE = 'Multiple',
}

export enum PaymentStandard {
  OPEN_CRYPTO_PAY = 'OpenCryptoPay',
  LIGHTNING_BOLT11 = 'LightningBolt11',
  PAY_TO_ADDRESS = 'PayToAddress',
}

export enum C2BPaymentProvider {
  BINANCE_PAY = Blockchain.BINANCE_PAY,
  KUCOIN_PAY = Blockchain.KUCOIN_PAY,
}

export enum C2BPaymentStatus {
  WAITING = 'WAITING',
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
}

export enum StickerType {
  CLASSIC = 'Classic',
  BITCOIN_FOCUS = 'BitcoinFocus',
}

export enum PaymentLinkMode {
  SINGLE = 'Single',
  MULTIPLE = 'Multiple',
  PUBLIC = 'Public',
}

export enum StickerQrMode {
  CUSTOMER = 'Customer',
  POS = 'Pos',
}

export enum PaymentMerchantStatus {
  CREATED = 'Created',
  PENDING = 'Pending',
  PROCESSED = 'Processed',
}

// Blockchains where the payer broadcasts the tx themselves and submits the resulting txId.
// The API marks the quote `TX_MEMPOOL` as soon as the txId is submitted, without waiting
// for on-chain confirmation. This is by design — accepting mempool transactions is the
// core feature of this payment flow (block-time waits are too slow for point-of-sale).
//
// Opt-in on the merchant side via `PaymentLinkConfig.minCompletionStatus = TX_MEMPOOL`
// (the default). Merchants who need stronger guarantees can set `TX_BLOCKCHAIN` to require
// on-chain confirmation before the payment auto-completes.
//
// Risk profile: accepting pre-confirmation enables tx-replacement attacks (the payer can
// broadcast a conflicting tx before a block confirms). The feature is scoped to physical
// point-of-sale: the fraudster has to be on the merchant's premises to walk off with
// goods, which makes the attack high-effort and locally traceable. For remote/high-value
// payments merchants should require `TX_BLOCKCHAIN`.
//
// We deliberately do not call the chain's node to verify the txId here, because none of
// the providers we use today expose mempool transactions consistently (own Monero/Zano
// daemons do; Tatum-backed Tron/Cardano do not), and a node-side check that returns
// "not found" for legitimately-broadcast-but-not-yet-propagated txs would break the
// feature. The only validation done is structural (txId format) — see `doTxIdPayment`.
export const UnverifiedTxIdBlockchains = [Blockchain.MONERO, Blockchain.ZANO, Blockchain.TRON, Blockchain.CARDANO];

// Blockchains where user broadcasts tx and sends txId, API verifies tx confirmation
export const VerifiedTxIdBlockchains = [Blockchain.SOLANA, Blockchain.INTERNET_COMPUTER];

export const TxIdBlockchains = [...UnverifiedTxIdBlockchains, ...VerifiedTxIdBlockchains];
