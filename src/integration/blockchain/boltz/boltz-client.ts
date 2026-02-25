import { HttpService } from 'src/shared/services/http.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';

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
// Success: transaction.claimed
// Fail: swap.expired, transaction.failed, transaction.refunded
export const ChainSwapSuccessStatuses = [BoltzSwapStatus.TRANSACTION_CLAIMED];
export const ChainSwapFailedStatuses = [
  BoltzSwapStatus.EXPIRED,
  BoltzSwapStatus.TRANSACTION_FAILED,
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

export class BoltzClient {
  private readonly logger = new DfxLogger(BoltzClient);

  constructor(
    private readonly http: HttpService,
    private readonly config: BoltzConfig,
  ) {}

  /**
   * Create a Chain Swap: BTC (onchain) -> cBTC (Citrea onchain)
   * For EVM destination chains, only claimAddress is needed (no claimPublicKey).
   * preimageHash is required by the Boltz API.
   */
  async createChainSwap(
    preimageHash: string,
    claimAddress: string,
    userLockAmount: number,
  ): Promise<BoltzChainSwapResponse> {
    const url = `${this.config.apiUrl}/v2/swap/chain`;

    const body = {
      from: 'BTC',
      to: 'cBTC',
      preimageHash,
      claimAddress,
      userLockAmount,
    };

    this.logger.verbose(`Creating chain swap: ${userLockAmount} sats, BTC -> cBTC, claim=${claimAddress}`);

    return this.http.post<BoltzChainSwapResponse>(url, body, { tryCount: 3, retryDelay: 2000 });
  }

  async getSwapStatus(swapId: string): Promise<BoltzSwapStatusResponse> {
    const url = `${this.config.apiUrl}/v2/swap/${swapId}`;

    return this.http.get<BoltzSwapStatusResponse>(url, { tryCount: 3, retryDelay: 2000 });
  }
}
