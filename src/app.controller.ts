import { Controller, Get, Query, Req, Res, Redirect } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { Details, UserAgent } from 'express-useragent';
import { RealIP } from 'nestjs-real-ip';
import { HttpService } from './shared/services/http.service';
import { SettingService } from './shared/models/setting/setting.service';
import { RefService } from './user/models/referral/ref.service';
import { AnnouncementDto } from './dto/announcement.dto';
import { FlagDto } from './dto/flag.dto';

@Controller('')
export class AppController {
  private readonly appVersion = new Date().toISOString();
  private readonly lightWalletUrl = 'https://wallet.defichain.com/api/v0';
  private readonly homepageUrl = 'https://dfx.swiss';
  private readonly playStoreUrl = 'https://play.app.goo.gl/?link=https://play.google.com/store/apps/details?id=com.defichain.app.dfx';
  private readonly appleStoreUrl = 'https://apps.apple.com/app/id1582633093';

  constructor(
    private readonly refService: RefService,
    private readonly httpService: HttpService,
    private readonly settingService: SettingService,
  ) {}

  @Get()
  @Redirect('swagger')
  @ApiExcludeEndpoint()
  async home(): Promise<any> {
    // nothing to do (redirect to Swagger UI)
  }

  @Get('version')
  @ApiExcludeEndpoint()
  async getVersion(): Promise<string> {
    return this.appVersion;
  }

  @Get('app')
  @ApiExcludeEndpoint()
  async createRef(
    @RealIP() ip: string,
    @Query('code') ref: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (ref) await this.refService.addOrUpdate(ip, ref);

    // redirect user depending on platform
    let url = this.homepageUrl;
    const agent = this.getAgentDetails(req);
    if (agent.isAndroid) url = this.playStoreUrl;
    if (agent.isiPhone) url = this.appleStoreUrl;

    res.redirect(307, url);
  }

  private getAgentDetails(req: Request): Details {
    return new UserAgent().parse(req.headers['user-agent'] ?? '');
  }

  @Get('app/announcements')
  @ApiExcludeEndpoint()
  async getAnnouncements(): Promise<AnnouncementDto[]> {
    return Promise.all([
      this.settingService.getObj<AnnouncementDto[]>('announcements', []),
      this.getLightWalletAnnouncements(),
    ]).then((r) => r.reduce((prev, curr) => prev.concat(curr), []));
  }

  @Get('app/settings/flags')
  @ApiExcludeEndpoint()
  async getFlags(): Promise<FlagDto[]> {
    return Promise.all([
      this.settingService.getObj<FlagDto[]>('flags', []),
      this.getLightWalletFlags(),
    ]).then((r) => r.reduce((prev, curr) => prev.concat(curr), []));
  }

  // --- HELPER METHODS --- //
  private async getLightWalletAnnouncements(): Promise<AnnouncementDto[]> {
    const ignoredAnnouncements = await this.settingService.getObj<string[]>('ignoredAnnouncements', []);
    return this.httpService
      .get<AnnouncementDto[]>(`${this.lightWalletUrl}/announcementsasdf`)
      .then((r) => r.filter((a) => !ignoredAnnouncements.includes(a.id)))
      .catch(() => []);
  }

  private async getLightWalletFlags(): Promise<FlagDto[]> {
    const ignoredFlags = (await this.settingService.getObj<string[]>('ignoredFlags', [])).map((f) => f.split(':'));
    return this.httpService
      .get<FlagDto[]>(`${this.lightWalletUrl}/settings/flags`)
      .then((r) => r.filter((f) => ignoredFlags.find((i) => i.length === 2 && i[0] === f.id && i[1] === f.stage) == null))
      .catch(() => []);
  }
}
