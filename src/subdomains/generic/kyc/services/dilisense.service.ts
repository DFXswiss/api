import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Config } from 'src/config/config';
import { HttpService } from '../../../../shared/services/http.service';
import { DilisenseApiData } from '../dto/dilisense-data.dto';

@Injectable()
export class DilisenseService {
  private readonly baseUrl = 'https://api.dilisense.com/v1/checkIndividual';

  constructor(private readonly http: HttpService) {}

  async getRiskData(name: string, dob: Date): Promise<DilisenseApiData> {
    const url = `${this.baseUrl}?names=${name}&dob=${dob.toLocaleDateString('en-GB')}`;

    try {
      return await this.http.get<DilisenseApiData>(url, {
        tryCount: 3,
        headers: {
          Accept: 'application/json',
          'x-api-key': Config.dilisense.key,
        },
      });
    } catch (e) {
      throw new ServiceUnavailableException(e);
    }
  }
}
