import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { AxiosResponse } from 'axios';
import * as crypto from 'crypto';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { HttpRequestConfig, HttpService } from 'src/shared/services/http.service';
import {
  PendingTransactionResponse,
  RegisterDepositRequest,
  RegisterWithdrawalRequest,
  ScorechainAlert,
  ScorechainPublicKeyResponse,
  ScoringAnalysisRequest,
  ScoringAnalysisResponse,
} from '../dto/scorechain.dto';

export interface SignedResponse<T> {
  data: T;
  signatureValid: boolean;
}

@Injectable()
export class ScorechainService {
  private readonly logger = new DfxLogger(ScorechainService);
  private readonly baseUrl = 'https://api.scorechain.com';

  constructor(private readonly http: HttpService) {}

  // --- RISK SCORING (synchronous) --- //

  async scoringAnalysis(request: ScoringAnalysisRequest): Promise<SignedResponse<ScoringAnalysisResponse>> {
    return this.post<ScoringAnalysisResponse>('/scoringAnalysis', request);
  }

  // --- TMS (asynchronous) --- //

  async registerDeposit(request: RegisterDepositRequest): Promise<SignedResponse<PendingTransactionResponse>> {
    return this.post<PendingTransactionResponse>('/registerDeposit', request);
  }

  async registerWithdrawal(request: RegisterWithdrawalRequest): Promise<SignedResponse<PendingTransactionResponse>> {
    return this.post<PendingTransactionResponse>('/registerWithdrawal', request);
  }

  async getScenarioChecks(identifier: string): Promise<SignedResponse<ScorechainAlert[]>> {
    return this.get<ScorechainAlert[]>('/scenarios/checks', { params: { identifier } });
  }

  // --- MISC --- //

  async getPublicKeys(): Promise<string[]> {
    const { data } = await this.get<ScorechainPublicKeyResponse>('/publicKeys');
    return data?.publicKeys ?? [];
  }

  async getStatus(): Promise<boolean> {
    try {
      await this.get('/status');
      return true;
    } catch {
      return false;
    }
  }

  // --- HELPERS --- //

  private async get<T>(url: string, config?: HttpRequestConfig): Promise<SignedResponse<T>> {
    try {
      const response = await this.http.getRaw<string>(`${this.baseUrl}${url}`, this.rawConfig(config));
      return this.toSignedResponse<T>(response);
    } catch (e) {
      throw new ServiceUnavailableException(`Scorechain GET ${url} failed: ${e.message}`);
    }
  }

  private async post<T>(url: string, data: unknown, config?: HttpRequestConfig): Promise<SignedResponse<T>> {
    try {
      const response = await this.http.postRaw<string>(`${this.baseUrl}${url}`, data, this.rawConfig(config));
      return this.toSignedResponse<T>(response);
    } catch (e) {
      throw new ServiceUnavailableException(`Scorechain POST ${url} failed: ${e.message}`);
    }
  }

  // Keep the raw response body (string) so the signature can be verified over the exact bytes.
  private rawConfig(config?: HttpRequestConfig): HttpRequestConfig {
    return {
      ...config,
      headers: { 'X-API-KEY': Config.scorechain.apiKey, ...config?.headers },
      transformResponse: [(d) => d],
    };
  }

  private toSignedResponse<T>(response: AxiosResponse<string>): SignedResponse<T> {
    const raw = response.data ?? '';
    const signatureValid = this.verifySignature(raw, response.headers);
    const data = (raw ? JSON.parse(raw) : undefined) as T;
    return { data, signatureValid };
  }

  // Proof of authenticity: RSA-SHA256, signature in the X-Signature header, key from /publicKeys.
  // NOTE: the exact canonical signing input (response body only vs. X-Server-Time + body) must be
  // confirmed against the Scorechain SDK before this is relied upon in production (spec §12, Q3).
  private verifySignature(rawBody: string, headers: Record<string, unknown>): boolean {
    const signature = headers?.['x-signature'] as string | undefined;
    const publicKey = Config.scorechain.publicKey;
    if (!signature || !publicKey || !rawBody) return false;

    try {
      const verifier = crypto.createVerify('RSA-SHA256');
      verifier.update(rawBody);
      verifier.end();
      return verifier.verify(publicKey, signature, 'base64');
    } catch (e) {
      this.logger.warn(`Scorechain signature verification error: ${e.message}`);
      return false;
    }
  }
}
