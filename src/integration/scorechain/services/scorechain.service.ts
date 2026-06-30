import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { AxiosResponse } from 'axios';
import { proofOfAuthenticityVerifier } from 'scorechain-sdk';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { HttpRequestConfig, HttpService } from 'src/shared/services/http.service';
import { ScorechainPublicKey, ScoringAnalysisRequest, ScoringAnalysisResponse } from '../dto/scorechain.dto';

export interface SignedResponse<T> {
  data: T;
  signatureValid: boolean;
}

@Injectable()
export class ScorechainService {
  private readonly logger = new DfxLogger(ScorechainService);
  private readonly baseUrl = 'https://api.scorechain.com/v1';

  private cachedPublicKey?: string;

  constructor(private readonly http: HttpService) {}

  // --- RISK SCORING (synchronous gate) --- //

  async scoringAnalysis(request: ScoringAnalysisRequest): Promise<SignedResponse<ScoringAnalysisResponse>> {
    return this.post<ScoringAnalysisResponse>('/scoringAnalysis', request);
  }

  // --- MISC --- //

  async getStatus(): Promise<boolean> {
    try {
      await this.rawGet('/status');
      return true;
    } catch {
      return false;
    }
  }

  // Public key for proof-of-authenticity. A pinned key (SCORECHAIN_PUBLIC_KEY) is authoritative and
  // should be set in production: without it we fall back to fetching /publicKeys over TLS without
  // being able to verify the key itself (chicken/egg → trust-on-first-use), which a TLS-MITM could
  // spoof. Warn so the unpinned mode is visible in the logs rather than silently trusted.
  async getPublicKey(): Promise<string | undefined> {
    if (Config.scorechain.publicKey) return Config.scorechain.publicKey;
    if (this.cachedPublicKey) return this.cachedPublicKey;

    this.logger.warn(
      'SCORECHAIN_PUBLIC_KEY is not pinned — using unverified /publicKeys (trust-on-first-use). Pin the key in production.',
    );
    const res = await this.rawGet<ScorechainPublicKey[]>('/publicKeys');
    this.cachedPublicKey = res.data?.[0]?.key;
    return this.cachedPublicKey;
  }

  // Proof of authenticity — delegates to the Scorechain SDK verifier
  // (RSA-SHA256 over JSON.stringify({ data, timestamp }), hex signature). Fail-closed:
  // any missing input, missing key or verification failure returns false.
  async isValidSignature(data: unknown, signature?: string, serverTime?: string): Promise<boolean> {
    if (data == null || !signature || !serverTime) return false;

    const publicKey = await this.getPublicKey();
    if (!publicKey) return false;

    try {
      // SDK verifies RSA-SHA256 over JSON.stringify({ data, timestamp }); throws on failure.
      proofOfAuthenticityVerifier(data as Record<string, unknown>, signature, publicKey, serverTime);
      return true;
    } catch (e) {
      this.logger.warn(`Scorechain signature verification failed: ${e.message}`);
      return false;
    }
  }

  // --- HELPERS --- //

  private async post<T>(url: string, body: unknown, config?: HttpRequestConfig): Promise<SignedResponse<T>> {
    return this.toSignedResponse<T>(await this.rawPost<T>(url, body, config));
  }

  private async rawGet<T>(url: string, config?: HttpRequestConfig): Promise<AxiosResponse<T>> {
    try {
      return await this.http.getRaw<T>(`${this.baseUrl}${url}`, this.authConfig(config));
    } catch (e) {
      throw new ServiceUnavailableException(`Scorechain GET ${url} failed: ${e.message}`);
    }
  }

  private async rawPost<T>(url: string, body: unknown, config?: HttpRequestConfig): Promise<AxiosResponse<T>> {
    try {
      return await this.http.postRaw<T>(`${this.baseUrl}${url}`, body, this.authConfig(config));
    } catch (e) {
      throw new ServiceUnavailableException(`Scorechain POST ${url} failed: ${e.message}`);
    }
  }

  private authConfig(config?: HttpRequestConfig): HttpRequestConfig {
    return { ...config, headers: { 'X-API-KEY': Config.scorechain.apiKey, ...config?.headers } };
  }

  private async toSignedResponse<T>(response: AxiosResponse<T>): Promise<SignedResponse<T>> {
    const signatureValid = await this.isValidSignature(
      response.data,
      response.headers['x-signature'],
      response.headers['x-server-time'],
    );
    return { data: response.data, signatureValid };
  }
}
