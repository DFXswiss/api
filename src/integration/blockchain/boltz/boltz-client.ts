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

  MINERFEE_PAID = 'minerfee.paid',
}

// Reverse Swap success: invoice.settled (Boltz paid the Lightning invoice)
// Reverse Swap failure: swap.expired, transaction.failed, transaction.refunded
export const ReverseSwapSuccessStatuses = [BoltzSwapStatus.INVOICE_SETTLED];
export const ReverseSwapFailedStatuses = [
  BoltzSwapStatus.EXPIRED,
  BoltzSwapStatus.TRANSACTION_FAILED,
  BoltzSwapStatus.TRANSACTION_REFUNDED,
];

export interface BoltzReverseSwapResponse {
  id: string;
  invoice: string;
  swapTree: {
    claimLeaf: { output: string; version: number };
    refundLeaf: { output: string; version: number };
  };
  lockupAddress: string;
  onchainAmount: number;
  timeoutBlockHeight: number;
  refundPublicKey?: string;
  blindingKey?: string;
  refundAddress?: string;
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

  async createReverseSwap(claimAddress: string, invoiceAmount: number): Promise<BoltzReverseSwapResponse> {
    const url = `${this.config.apiUrl}/v2/swap/reverse`;

    // For EVM chains (cBTC on Citrea), Boltz handles the claim via smart contracts.
    // No preimageHash or claimPublicKey needed - Boltz generates these internally.
    const body = {
      from: 'BTC',
      to: 'cBTC',
      claimAddress,
      invoiceAmount,
    };

    this.logger.verbose(`Creating reverse swap: ${invoiceAmount} sats -> ${claimAddress}`);

    return this.http.post<BoltzReverseSwapResponse>(url, body, { tryCount: 3, retryDelay: 2000 });
  }

  async getSwapStatus(swapId: string): Promise<BoltzSwapStatusResponse> {
    const url = `${this.config.apiUrl}/v2/swap/${swapId}`;

    return this.http.get<BoltzSwapStatusResponse>(url, { tryCount: 3, retryDelay: 2000 });
  }
}
