import { Injectable } from '@nestjs/common';
import { HttpService } from './http.service';
import { Config } from 'src/config/config';
import { Util } from 'src/shared/util';

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

@Injectable()
export class LetterService {
  constructor(private readonly http: HttpService) {}

  async uploadLetter(data: any): Promise<boolean> {
    const sendLetter = await this.http.post<LetterResponse>(`${Config.letter.url}setJob`, {
      auth: { username: Config.letter.userName, apikey: Config.letter.apiKey },
      letter: {
        base64_file: data,
        base64_checksum: Util.createHash(data, 'md5'),
        specification: {
          page: 1,
          color: '4',
          mode: 'simplex',
          ship: 'national',
        },
      },
    });
    return sendLetter.status == 200;
  }
}
