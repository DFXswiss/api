import { HttpService } from 'src/shared/services/http.service';
import {
  BoltzChainSwapResponse,
  BoltzConfig,
  BoltzSwapStatusResponse,
  ChainPairsResponse,
  HelpMeClaimRequest,
  HelpMeClaimResponse,
} from './dto/boltz.dto';

export * from './dto/boltz.dto';

export class BoltzClient {
  constructor(
    private readonly http: HttpService,
    private readonly config: BoltzConfig,
  ) {}

  async getChainPairs(): Promise<ChainPairsResponse> {
    return this.get<ChainPairsResponse>('swap/v2/swap/chain/');
  }

  async getSwapStatus(swapId: string): Promise<BoltzSwapStatusResponse> {
    return this.get<BoltzSwapStatusResponse>(`swap/v2/swap/${swapId}`);
  }

  /**
   * Create a Chain Swap: BTC (onchain) -> cBTC (Citrea onchain)
   * For EVM destination chains, only claimAddress is needed (no claimPublicKey).
   * refundPublicKey is required for BTC sender side to enable refunds on swap failure.
   * preimageHash and pairHash are required by the Boltz API.
   */
  async createChainSwap(
    preimageHash: string,
    claimAddress: string,
    userLockAmount: number,
    pairHash: string,
    referralId: string,
    refundPublicKey: string,
  ): Promise<BoltzChainSwapResponse> {
    return this.post<BoltzChainSwapResponse>('swap/v2/swap/chain/', {
      from: 'BTC',
      to: 'cBTC',
      preimageHash,
      claimAddress,
      userLockAmount,
      pairHash,
      referralId,
      refundPublicKey,
    });
  }

  /**
   * Request Boltz to claim cBTC on behalf of the user (server-side claiming).
   * The preimage proves payment; Boltz uses it to release cBTC to the claim address.
   */
  async claimChainSwap(preimage: string, preimageHash: string): Promise<HelpMeClaimResponse> {
    const body: HelpMeClaimRequest = { preimage, preimageHash };

    return this.post<HelpMeClaimResponse>('claim/help-me-claim', body);
  }

  // --- HELPER METHODS --- //

  private url(path: string): string {
    return `${this.config.apiUrl}/${path}`;
  }

  private get<T>(path: string): Promise<T> {
    return this.http.get<T>(this.url(path), { tryCount: 3, retryDelay: 2000 });
  }

  private post<T>(path: string, body: unknown): Promise<T> {
    return this.http.post<T>(this.url(path), body, { tryCount: 3, retryDelay: 2000 });
  }
}
