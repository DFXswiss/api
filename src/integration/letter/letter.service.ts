import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { SendLetterDto } from 'src/subdomains/generic/admin/dto/send-letter.dto';
import { HttpService } from '../../shared/services/http.service';
import { Util } from '../../shared/utils/util';

interface LetterResponse {
  notice: {
    balance: string;
  };
  letter: {
    price: number;
    job_id: string;
    status: string;
    specification: {
      page: number;
      color: string;
      mode: string;
      ship: string;
    };
  };
  status: number;
  message: string;
}

interface BalanceResponse {
  message: string;
  status: string;
  balance: { value: string; currency: string };
}

@Injectable()
export class LetterService {
  constructor(private readonly http: HttpService) {}

  get isConfigured(): boolean {
    return !!(Config.letter.url && Config.letter.auth.username && Config.letter.auth.apikey);
  }

  /**
   * Hands one letter to the print/dispatch provider.
   *
   * `false` means the provider answered and refused the job - it is read by callers as proof that
   * nothing was sent, so it may only be returned for an answer that actually says so. A response whose
   * shape is not recognised is ambiguous: the job may well have been created, and reporting "not sent"
   * would invite a second, irreversible physical letter. Those throw instead, which callers treat as an
   * unknown outcome.
   */
  async sendLetter(sendLetterDTO: SendLetterDto): Promise<boolean> {
    return this.http
      .post<LetterResponse>(`${Config.letter.url}/setJob`, {
        auth: Config.letter.auth,
        letter: {
          base64_file: sendLetterDTO.data,
          base64_checksum: Util.createHash(sendLetterDTO.data, 'md5'),
          specification: {
            page: sendLetterDTO.page,
            color: sendLetterDTO.color,
            mode: sendLetterDTO.mode,
            ship: sendLetterDTO.ship,
          },
        },
      })
      .then((r) => {
        if (r?.status === 200) return true;
        if (typeof r?.status === 'number') return false;

        throw new Error(`Unexpected letter provider response: ${JSON.stringify(r)?.slice(0, 200)}`);
      });
  }

  async getBalance(): Promise<number> {
    return this.http
      .post<BalanceResponse>(
        `${Config.letter.url}/getBalance`,
        { auth: Config.letter.auth },
        { timeout: 10000, tryCount: 3, retryDelay: 1000 },
      )
      .then((r) => +r.balance.value);
  }
}
