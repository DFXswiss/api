import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
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
  private readonly baseUrl = 'https://api.applicationinsights.io/v1';

  constructor(private readonly http: HttpService) {}

  async query(kql: string, timespan?: string): Promise<AppInsightsQueryResponse> {
    const { appId, apiKey } = Config.azure.appInsights;

    if (!appId || !apiKey) {
      throw new Error('App insights config missing');
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
