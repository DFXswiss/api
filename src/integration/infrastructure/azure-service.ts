import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Method } from 'axios';
import { Config } from 'src/config/config';
import { HttpError, HttpService } from 'src/shared/services/http.service';

@Injectable()
export class AzureService {
  private readonly baseUrl = `https://management.azure.com`;
  private readonly apiVersion = '2022-03-01';

  private accessToken = 'access-token-will-be-updated';

  constructor(private readonly http: HttpService) {}

  public async restartWebApp(name: string, slot?: string) {
    const appName = `app-dfx-${name}-${Config.environment}${slot ? `/slots/${slot}` : ''}`;
    const resourceId = this.resourceId('Microsoft.Web/sites', appName);
    return await this.callApi(`${resourceId}/restart`, 'POST');
  }

  // --- HELPER METHODS --- //
  private resourceId(provider: string, name: string): string {
    return `subscriptions/${Config.azure.subscriptionId}/resourceGroups/rg-dfx-api-${Config.environment}/providers/${provider}/${name}`;
  }

  private async callApi<T>(url: string, method: Method = 'GET', data?: any): Promise<T> {
    return this.request<T>(url, method, data).catch((e: HttpError) => {
      throw new ServiceUnavailableException(e);
    });
  }

  private async request<T>(url: string, method: Method, data?: any, nthTry = 3, getNewAccessToken = false): Promise<T> {
    try {
      if (getNewAccessToken) this.accessToken = await this.getAccessToken();

      return await this.http.request<T>({
        url: `${this.baseUrl}/${url}?api-version=${this.apiVersion}`,
        method: method,
        data: method !== 'GET' ? data : undefined,
        params: method === 'GET' ? data : undefined,
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      });
    } catch (e) {
      if (nthTry > 1 && e.response?.status == 401) {
        return this.request(url, method, data, nthTry - 1, true);
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
        resource: 'https://management.azure.com',
      }),
    );
    return access_token;
  }
}
