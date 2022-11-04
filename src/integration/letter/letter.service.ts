import { Injectable } from '@nestjs/common';
import { HttpService } from '../../shared/services/http.service';
import { Config } from 'src/config/config';
import { Util } from '../../shared/utils/util';
import { SendLetterDto } from 'src/subdomains/generic/admin/dto/send-letter.dto';

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

  async sendLetter(sendLetterDTO: SendLetterDto): Promise<boolean> {
    return await this.http
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
      .then((r) => r.status == 200);
  }

  async getBalance(): Promise<number> {
    return await this.http
      .post<BalanceResponse>(`${Config.letter.url}/getBalance`, { auth: Config.letter.auth })
      .then((r) => +r.balance.value);
  }
}
