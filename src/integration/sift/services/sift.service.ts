import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { HttpService } from 'src/shared/services/http.service';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { CreateAccount, EventType } from '../dto/sift.dto';

@Injectable()
export class SiftService {
  private readonly url = 'https://api.sift.com/v205/events';
  private readonly logger = new DfxLogger(SiftService);

  constructor(private readonly http: HttpService) {}

  async createAccount(user: User): Promise<void> {
    try {
      const data: CreateAccount = {
        $type: EventType.CREATE_ACCOUNT,
        $api_key: Config.sift.apiKey,
        $user_id: user.id.toString(),
        $referrer_user_id: user.ref,
        $ip: user.ip,
        $time: Date.now(),
        blockchain_address: user.address,
      };
      await this.http.post(this.url, data);
    } catch (error) {
      this.logger.error('Error during account creation', error);
    }
  }
}
