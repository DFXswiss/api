import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Config } from 'src/config/config';
import { HttpService } from '../../../../../shared/services/http.service';
import { DilisenseApiData } from '../../dto/input/dilisense-data.dto';

@Injectable()
export class DilisenseService {
  private readonly baseUrl = 'https://api.dilisense.com/v1';

  constructor(private readonly http: HttpService) {}

  async getRiskData(
    name: string,
    isBusiness: boolean,
    dob?: Date,
  ): Promise<{ data: DilisenseApiData; pdfData: string }> {
    const params = new URLSearchParams({ names: name });
    dob && params.set('dob', dob.toLocaleDateString('en-GB'));

    const urlEndpoint = isBusiness ? 'checkEntity' : 'checkIndividual';
    const pdfEndpoint = isBusiness ? 'generateEntityReport' : 'generateIndividualReport';

    const url = `${this.baseUrl}/${urlEndpoint}?${params.toString()}`;
    const pdfUrl = `${this.baseUrl}/${pdfEndpoint}?${params.toString()}`;

    try {
      return {
        data: await this.http.get<DilisenseApiData>(url, {
          tryCount: 3,
          headers: {
            Accept: 'application/json',
            'x-api-key': Config.dilisense.key,
          },
        }),
        pdfData: await this.http.get<string>(pdfUrl, {
          tryCount: 3,
          headers: {
            Accept: 'application/json',
            'x-api-key': Config.dilisense.key,
          },
        }),
      };
    } catch (e) {
      throw new ServiceUnavailableException('Error in dilisense riskData request', e);
    }
  }
}
