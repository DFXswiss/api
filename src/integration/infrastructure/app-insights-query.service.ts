import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { HttpService } from 'src/shared/services/http.service';
import { ContainerApp } from './enums/container-app.enum';

interface AppInsightsQueryResponse {
  tables: {
    name: string;
    columns: { name: string; type: string }[];
    rows: unknown[][];
  }[];
}

@Injectable()
export class AppInsightsQueryService {
  private readonly baseUrl = 'https://api.applicationinsights.io/v1';

  constructor(private readonly http: HttpService) {}

  async query(kql: string, timespan?: string, app?: ContainerApp): Promise<AppInsightsQueryResponse> {
    const { appId: defaultAppId, apiKey, apps } = Config.azure.appInsights;

    // Use specified app or default to dfxApi
    const appId = app ? apps[app] : defaultAppId;

    if (!appId || !apiKey) {
      throw new Error(app ? `App insights config missing for ${app}` : 'App insights config missing');
    }

    const body: { query: string; timespan?: string } = { query: kql };
    if (timespan) body.timespan = timespan;

    return this.http.request<AppInsightsQueryResponse>({
      url: `${this.baseUrl}/apps/${appId}/query`,
      method: 'POST',
      data: body,
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
      },
    });
  }
}
