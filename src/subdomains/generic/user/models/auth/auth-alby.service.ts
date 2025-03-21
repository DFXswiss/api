import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Config } from 'src/config/config';
import { LightningHelper } from 'src/integration/lightning/lightning-helper';
import { IpLogService } from 'src/shared/models/ip-log/ip-log.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { HttpService } from 'src/shared/services/http.service';
import { Util } from 'src/shared/utils/util';
import { AlbySignupDto } from '../user/dto/alby.dto';
import { AuthService } from './auth.service';

interface AlbyAuthResponse {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
  token_type: string;
}

interface AlbyUserResponse {
  identifier: string;
  email: string;
  name: string;
  avatar: string;
  keysend_custom_key: string;
  keysend_custom_value: string;
  keysend_pubkey: string;
  lightning_address: string;
}

@Injectable()
export class AuthAlbyService {
  private readonly logger = new DfxLogger(AuthAlbyService);

  private readonly albyUrl = 'https://getalby.com';
  private readonly albyApiUrl = 'https://api.getalby.com';

  private readonly signUpData = new Map<string, AlbySignupDto>();

  constructor(
    private readonly http: HttpService,
    private readonly authService: AuthService,
    private readonly ipLogService: IpLogService,
  ) {}

  getOauthUrl(dto: AlbySignupDto): string {
    // store the sign up data
    const id = Util.randomId().toString(36);
    this.signUpData.set(id, dto);

    return `${this.albyUrl}/oauth?client_id=${Config.alby.clientId}&response_type=code&redirect_uri=${this.redirectUri(
      id,
    )}&scope=account:read`;
  }

  async signIn(id: string, code: string, userIp: string, requestUrl: string): Promise<string> {
    const dto = this.signUpData.get(id);
    this.signUpData.delete(id);

    const returnUri = dto?.redirectUri ?? this.fallbackUrl;

    try {
      // request access token
      const { access_token } = await this.http.post<AlbyAuthResponse>(
        `${this.albyApiUrl}/oauth/token`,
        {
          client_id: Config.alby.clientId,
          client_secret: Config.alby.clientSecret,
          code: code,
          grant_type: 'authorization_code',
          redirect_uri: this.redirectUri(id),
        },
        {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        },
      );

      // get the user info
      const { lightning_address, identifier } = await this.http.get<AlbyUserResponse>(`${this.albyApiUrl}/user/me`, {
        headers: { Authorization: `Bearer ${access_token}` },
      });

      // construct session and create IP log
      const session = { address: LightningHelper.addressToLnurlp(lightning_address), signature: identifier };

      const ipLog = await this.ipLogService.create(userIp, requestUrl, session.address);
      if (!ipLog.result) throw new ForbiddenException('The country of IP address is not allowed');

      const { accessToken } = await this.authService.signIn(session, userIp, true).catch((e) => {
        if (e instanceof NotFoundException) return this.authService.signUp({ ...dto, ...session }, userIp, true);

        throw e;
      });

      const url = new URL(returnUri);
      url.searchParams.set('session', accessToken);

      return url.toString();
    } catch (e) {
      this.logger.error('Failed to login to Alby:', e);

      return returnUri;
    }
  }

  // --- HELPER METHODS --- //
  private redirectUri(id: string): string {
    return `${Config.url()}/auth/alby/redirect/${id}`;
  }

  private get fallbackUrl(): string {
    return `${Config.frontend.services}/error`;
  }
}
