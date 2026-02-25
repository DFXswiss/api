import { HttpService } from 'src/shared/services/http.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';

export interface BoltzConfig {
  apiUrl: string;
}

export enum BoltzSwapStatus {
  CREATED = 'swap.created',
  INVOICE_SET = 'invoice.set',
  INVOICE_PENDING = 'invoice.pending',
  INVOICE_PAID = 'invoice.paid',
  INVOICE_FAILEDTOPAY = 'invoice.failedToPay',
  TRANSACTION_MEMPOOL = 'transaction.mempool',
  TRANSACTION_CLAIMED = 'transaction.claimed',
  TRANSACTION_CONFIRMED = 'transaction.confirmed',
  TRANSACTION_REFUNDED = 'transaction.refunded',
  TRANSACTION_FAILED = 'transaction.failed',
  SWAP_EXPIRED = 'swap.expired',
}

export interface BoltzReverseSwapResponse {
  id: string;
  invoice: string;
  lockupAddress: string;
  onchainAmount: number;
  timeoutBlockHeight: number;
  redeemScript?: string;
}

export interface BoltzSwapStatusResponse {
  status: BoltzSwapStatus;
  failureReason?: string;
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

  async createReverseSwap(claimAddress: string, amount: number): Promise<BoltzReverseSwapResponse> {
    const url = `${this.config.apiUrl}/v2/swap/reverse`;

    const body = {
      from: 'BTC',
      to: 'cBTC',
      claimAddress,
      invoiceAmount: amount,
    };

    this.logger.verbose(`Creating reverse swap: ${amount} sats -> ${claimAddress}`);

    return this.http.post<BoltzReverseSwapResponse>(url, body, { tryCount: 3, retryDelay: 2000 });
  }

  async getSwapStatus(swapId: string): Promise<BoltzSwapStatusResponse> {
    const url = `${this.config.apiUrl}/v2/swap/${swapId}`;

    return this.http.get<BoltzSwapStatusResponse>(url, { tryCount: 3, retryDelay: 2000 });
  }
}
