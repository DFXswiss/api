import { Injectable } from '@nestjs/common';
import { HttpService } from './http.service';
import { Config } from 'src/config/config';
import { SendLetterDto } from 'src/admin/dto/send-letter.dto';
import md5 = require('md5');
interface Letter {
  auth: {
    username: string;
    apikey: string;
  };
  letter?: LetterContent;
}

interface LetterContent {
  letter: {
    base64_file?: string;
    base64_checksum?: string;
    address?: string;
    dispatchdate?: string;
    specification: {
      color: number;
      mode: string;
      ship: string;
      c4?: string;
    };
  };
}

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

  async uploadLetter(sendLetterDto: SendLetterDto): Promise<boolean> {
    const rewards = await this.http.post<LetterResponse>(`${Config.letter.url}setJob`, {
      auth: { username: Config.letter.userName, apikey: Config.letter.apiKey },
      letter: {
        base64_file: sendLetterDto.data.buffer.toString('base64'),
        base64_checksum: md5(sendLetterDto.data.buffer.toString('base64')),
        specification: {
          page: 1,
          color: '4',
          mode: 'simplex',
          ship: 'national',
        },
      },
    });
    return rewards. status == 200;
  }
}
