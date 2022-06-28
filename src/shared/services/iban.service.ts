import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { HttpService } from './http.service';

export interface IbanDetailsDto {
  value_open: number;
  account_check: string;
  account_number: string;
  account_validation: string;
  account_validation_method: string;
  all_bic_candidates: [
    {
      bic: string;
      city: string;
      sampleurl: string;
      wwwcount: number;
      zip: string;
    },
  ];
  b2b: string;
  balance: number;
  bank: string;
  bank_address: string;
  bank_and_branch_code: string;
  bank_city: string;
  bank_code: string;
  bank_code_check: string;
  bank_postal_code: string;
  bank_state: string;
  bank_street: string;
  bank_url: string;
  bic_candidates: [
    {
      bic: string;
      city: string;
      sampleurl: string;
      wwwcount: number;
      zip: string;
    },
  ];
  branch: string;
  branch_code: string;
  checks: [string];
  cor1: string;
  country: string;
  data_age: string;
  formatcomment: string;
  iban: string;
  iban_candidate: string;
  iban_checksum_check: string;
  iban_last_reported: string;
  iban_listed: string;
  iban_reported_to_exist: number;
  iban_url: string;
  iban_www_occurrences: number;
  IBANformat: string;
  in_scl_directory: string;
  length_check: string;
  result: string;
  return_code: number;
  scc: string;
  sct: string;
  sct_inst: string;
  sct_inst_readiness_date: string;
  sdd: string;
  url_category: string;
  url_min_depth: string;
  url_rank: string;
  www_prominence: string;
  www_seen_from: string;
  www_seen_until: string;
}

@Injectable()
export class IbanService {
  private readonly baseUrl = 'https://rest.sepatools.eu/validate_iban';
  private ibanApiBalance: number;

  constructor(private readonly http: HttpService) {}

  async getIbanInfos(iban: string): Promise<IbanDetailsDto> {
    const url = `${this.baseUrl}/${iban}`;

    try {
      const result = await this.http.get<IbanDetailsDto>(url, {
        auth: { username: process.env.IBAN_USER, password: process.env.IBAN_PASSWORD },
      });

      this.ibanApiBalance = result.balance;

      return result;
    } catch (error) {
      throw new ServiceUnavailableException(`Failed to get IBAN infos for ${iban}:`, error);
    }
  }

  public getBalance(): number {
    return this.ibanApiBalance;
  }
}
