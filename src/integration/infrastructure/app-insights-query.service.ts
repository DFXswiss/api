import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { HttpService } from 'src/shared/services/http.service';

interface AppInsightsQueryResponse {
  tables: {
    name: string;
    columns: { name: string; type: string }[];
    rows: unknown[][];
  }[];
}

@Injectable()
export class AppInsightsQueryService {
  private readonly logger = new DfxLogger(AppInsightsQueryService);

  private readonly baseUrl = 'https://api.applicationinsights.io/v1';
  private readonly TOKEN_REFRESH_BUFFER_MS = 60000;

  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(private readonly http: HttpService) {}

  async query(kql: string, timespan?: string): Promise<AppInsightsQueryResponse> {
    const appId = Config.azure.appInsights?.appId;
    if (!appId) {
      throw new Error('App Insights App ID not configured');
    }

    const body: { query: string; timespan?: string } = { query: kql };
    if (timespan) body.timespan = timespan;

    return this.request<AppInsightsQueryResponse>(`apps/${appId}/query`, body);
  }

  private async request<T>(url: string, body: object, nthTry = 3): Promise<T> {
    try {
      if (!this.accessToken || Date.now() >= this.tokenExpiresAt - this.TOKEN_REFRESH_BUFFER_MS) {
        await this.refreshAccessToken();
      }

      return await this.http.request<T>({
        url: `${this.baseUrl}/${url}`,
        method: 'POST',
        data: body,
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
      });
    } catch (e) {
      if (nthTry > 1 && e.response?.status === 401) {
        await this.refreshAccessToken();
        return this.request(url, body, nthTry - 1);
      }
      throw e;
    }
  }

  private async refreshAccessToken(): Promise<void> {
    try {
      const { access_token, expires_in } = await this.http.post<{ access_token: string; expires_in: number }>(
        `https://login.microsoftonline.com/${Config.azure.tenantId}/oauth2/token`,
        new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: Config.azure.clientId,
          client_secret: Config.azure.clientSecret,
          resource: 'https://api.applicationinsights.io',
        }),
      );

      this.accessToken = access_token;
      this.tokenExpiresAt = Date.now() + expires_in * 1000;
    } catch (e) {
      this.logger.error('Failed to refresh App Insights access token:', e);
      throw new Error('Failed to authenticate with App Insights');
    }
  }
}
