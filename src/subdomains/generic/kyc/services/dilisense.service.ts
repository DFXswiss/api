import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Config } from 'src/config/config';
import { HttpService } from '../../../../shared/services/http.service';
import { DilisenseApiData } from '../dto/dilisense-data.dto';

@Injectable()
export class DilisenseService {
  private readonly baseUrl = 'https://api.dilisense.com/v1/checkIndividual';

  constructor(private readonly http: HttpService) {}

  async getRiskData(name: string, dob: Date): Promise<DilisenseApiData> {
    // TODO fix date String
    const url = `${this.baseUrl}?names=${name}&fuzzy_search=0&dob=${dob.toISOString}`;

    try {
      return this.http.get<DilisenseApiData>(url, Config.dilisense.config);
    } catch (e) {
      throw new ServiceUnavailableException(e);
    }
  }
}
