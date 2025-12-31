import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { HttpService } from 'src/shared/services/http.service';

interface AppInsightsQueryResponse {
  tables: {
    name: string;
    columns: { name: string; type: string }[];
    rows: any[][];
  }[];
}

@Injectable()
export class AppInsightsQueryService {
  private readonly baseUrl = 'https://api.applicationinsights.io/v1';

  private accessToken: string | null = null;

  constructor(private readonly http: HttpService) {}

  async query(kql: string, timespan?: string): Promise<AppInsightsQueryResponse> {
    const appId = Config.azure.appInsights.appId;
    if (!appId) {
      throw new Error('App Insights App ID not configured');
    }

    const body: { query: string; timespan?: string } = { query: kql };
    if (timespan) body.timespan = timespan;

    return this.request<AppInsightsQueryResponse>(`apps/${appId}/query`, body);
  }

  private async request<T>(url: string, body: object, nthTry = 3): Promise<T> {
    try {
      if (!this.accessToken) {
        this.accessToken = await this.getAccessToken();
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
        this.accessToken = await this.getAccessToken();
        return this.request(url, body, nthTry - 1);
      }
      throw e;
    }
  }

  private async getAccessToken(): Promise<string> {
    const { access_token } = await this.http.post<{ access_token: string }>(
      `https://login.microsoftonline.com/${Config.azure.tenantId}/oauth2/token`,
      new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: Config.azure.clientId,
        client_secret: Config.azure.clientSecret,
        resource: 'https://api.applicationinsights.io',
      }),
    );
    return access_token;
  }
}
