import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { HttpService } from 'src/shared/services/http.service';
import { KycLevel } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { CreateAccount, CreateOrder, EventType, SiftBase } from '../dto/sift.dto';

@Injectable()
export class SiftService {
  private readonly url = 'https://api.sift.com/v205/events';
  private readonly logger = new DfxLogger(SiftService);

  constructor(private readonly http: HttpService) {}

  async createAccount(user: User): Promise<void> {
    const data: CreateAccount = {
      $user_id: user.id.toString(),
      $referrer_user_id: user.ref,
      $ip: user.ip,
      $time: user.created.getTime(),
      $brand_name: user.wallet.name,
      $site_country: 'CH',
      blockchain_address: user.address,
      kyc_level: KycLevel.LEVEL_0,
    };

    return this.send(EventType.CREATE_ACCOUNT, data);
  }

  async updateAccount(data: CreateAccount): Promise<void> {
    return this.send(EventType.UPDATE_ACCOUNT, data);
  }

  async login(user: User, ip: string): Promise<void> {
    const data: SiftBase = {
      $user_id: user.id.toString(),
      $ip: ip,
      $time: Date.now(),
    };

    return this.send(EventType.LOGIN, data);
  }

  async createOrder(data: CreateOrder): Promise<void> {
    return this.send(EventType.CREATE_ORDER, data);
  }

  private async send(type: EventType, data: SiftBase): Promise<void> {
    if (!Config.sift.apiKey) return;

    data.$type = type;
    data.$api_key = Config.sift.apiKey;

    try {
      await this.http.post(this.url, data);
    } catch (error) {
      this.logger.error(`Error sending Sift event ${type} for user ${data.$user_id}:`, error);
    }
  }
}
