export interface BoltzConfig {
  apiUrl: string;
}

// Boltz swap lifecycle events (from boltz-backend SwapUpdateEvent enum)
export enum BoltzSwapStatus {
  CREATED = 'swap.created',
  EXPIRED = 'swap.expired',

  INVOICE_SET = 'invoice.set',
  INVOICE_PENDING = 'invoice.pending',
  INVOICE_PAID = 'invoice.paid',
  INVOICE_SETTLED = 'invoice.settled',
  INVOICE_FAILEDTOPAY = 'invoice.failedToPay',
  INVOICE_EXPIRED = 'invoice.expired',

  TRANSACTION_MEMPOOL = 'transaction.mempool',
  TRANSACTION_CLAIM_PENDING = 'transaction.claim.pending',
  TRANSACTION_CLAIMED = 'transaction.claimed',
  TRANSACTION_CONFIRMED = 'transaction.confirmed',
  TRANSACTION_REFUNDED = 'transaction.refunded',
  TRANSACTION_FAILED = 'transaction.failed',
  TRANSACTION_LOCKUP_FAILED = 'transaction.lockupFailed',

  TRANSACTION_SERVER_MEMPOOL = 'transaction.server.mempool',
  TRANSACTION_SERVER_CONFIRMED = 'transaction.server.confirmed',

  MINERFEE_PAID = 'minerfee.paid',
}

// Chain Swap final events (BTC onchain -> cBTC onchain)
export const ChainSwapSuccessStatuses = [BoltzSwapStatus.TRANSACTION_CLAIMED];
export const ChainSwapFailedStatuses = [
  BoltzSwapStatus.EXPIRED,
  BoltzSwapStatus.TRANSACTION_FAILED,
  BoltzSwapStatus.TRANSACTION_LOCKUP_FAILED,
  BoltzSwapStatus.TRANSACTION_REFUNDED,
];

export interface ChainSwapDetails {
  swapTree: {
    claimLeaf: { output: string; version: number };
    refundLeaf: { output: string; version: number };
  };
  lockupAddress: string;
  serverPublicKey: string;
  timeoutBlockHeight: number;
  amount: number;
  blindingKey?: string;
  refundAddress?: string;
  claimAddress?: string;
  bip21?: string;
}

export interface BoltzChainSwapResponse {
  id: string;
  claimDetails: ChainSwapDetails;
  lockupDetails: ChainSwapDetails;
}

export interface BoltzSwapStatusResponse {
  status: BoltzSwapStatus;
  failureReason?: string;
  failureDetails?: string;
  zeroConfRejected?: boolean;
  transaction?: {
    id: string;
    hex?: string;
  };
}

export interface ChainPairInfo {
  hash: string;
  rate: number;
  limits: {
    maximal: number;
    minimal: number;
    maximalZeroConf: number;
  };
  fees: {
    percentage: number;
    minerFees: {
      server: number;
      user: {
        claim: number;
        lockup: number;
      };
    };
  };
}

// Response: Record<fromAsset, Record<toAsset, ChainPairInfo>>
export type ChainPairsResponse = Record<string, Record<string, ChainPairInfo>>;

export interface HelpMeClaimRequest {
  preimage: string;
  preimageHash: string;
}

export interface HelpMeClaimResponse {
  txHash: string;
}
