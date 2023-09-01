import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { HttpService } from 'src/shared/services/http.service';
import { URL } from 'url';
import { LightningHelper } from '../lightning-helper';

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

// TODO: remove
@ApiTags('Alby')
@Controller('alby')
export class AlbyController {
  private readonly logger = new DfxLogger(AlbyController);

  private readonly albyUrl = 'https://getalby.com';
  private readonly albyApiUrl = 'https://api.getalby.com';

  private readonly returnUris = new Map<string, string>();

  constructor(private readonly http: HttpService) {}

  @Get()
  @ApiExcludeEndpoint()
  login(@Query('redirect_uri') redirectUri: string, @Res() res: Response) {
    // store the return URI
    const id = Math.random().toString(36).slice(2, 7);
    this.returnUris.set(id, redirectUri);

    const url = `${this.albyUrl}/oauth?client_id=${
      Config.alby.clientId
    }&response_type=code&redirect_uri=${this.redirectUri(id)}&scope=account:read`;

    res.redirect(307, url);
  }

  @Get('redirect/:id')
  @ApiExcludeEndpoint()
  async redirect(@Param('id') id: string, @Query('code') code: string, @Res() res: Response) {
    const returnUri = this.returnUris.get(id) ?? this.fallbackUrl;
    this.returnUris.delete(id);

    if (!code) return res.redirect(307, returnUri);

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
      const { lightning_address } = await this.http.get<AlbyUserResponse>(`${this.albyApiUrl}/user/me`, {
        headers: { Authorization: `Bearer ${access_token}` },
      });

      // construct LNURL
      const lnurl = LightningHelper.addressToLnurlp(lightning_address);

      const url = new URL(returnUri);
      url.searchParams.set('address', lnurl);

      res.redirect(307, url.toString());
    } catch (e) {
      this.logger.error('Failed to get LNURL from Alby:', e);

      return res.redirect(307, returnUri);
    }
  }

  // --- HELPER METHODS --- //
  private redirectUri(id: string): string {
    return `${Config.url}/alby/redirect/${id}`;
  }

  private get fallbackUrl(): string {
    return `${Config.payment.url}/error`;
  }
}
