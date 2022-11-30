import { Controller, Get, Query, Res, Redirect } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { Details, UserAgent } from 'express-useragent';
import { RealIP } from 'nestjs-real-ip';
import { HttpService } from './shared/services/http.service';
import { SettingService } from './shared/models/setting/setting.service';
import { AdDto, AdSettings, AdvertisementDto } from './shared/dto/advertisement.dto';
import { Util } from './shared/utils/util';
import { AnnouncementDto } from './shared/dto/announcement.dto';
import { FlagDto } from './shared/dto/flag.dto';
import { RefService } from './subdomains/core/referral/process/ref.service';

@Controller('')
export class AppController {
  private readonly lightWalletUrl = 'https://wallet.defichain.com/api/v0';
  private readonly homepageUrl = 'https://dfx.swiss';

  constructor(
    private readonly http: HttpService,
    private readonly refService: RefService,
    private readonly settingService: SettingService,
  ) {}

  @Get()
  @Redirect('swagger')
  @ApiExcludeEndpoint()
  async home(): Promise<any> {
    // nothing to do (redirect to Swagger UI)
  }

  @Get('app')
  @ApiExcludeEndpoint()
  async createRef(
    @RealIP() ip: string,
    @Query('code') ref: string,
    @Query('orig') origin: string,
    @Res() res: Response,
  ): Promise<void> {
    if (ref || origin) await this.refService.addOrUpdate(ip, ref, origin);
    res.redirect(307, this.homepageUrl);
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
    return Promise.all([this.settingService.getObj<FlagDto[]>('flags', []), this.getLightWalletFlags()]).then((r) =>
      r.reduce((prev, curr) => prev.concat(curr), []),
    );
  }

  @Get('app/advertisements')
  @ApiExcludeEndpoint()
  async getAds(@Query() { id, date, lang }: AdvertisementDto): Promise<AdDto> {
    const adSettings = await this.settingService.getObj<AdSettings>('advertisements');

    let nextAd = this.getSpecialAd(id, adSettings);
    if (!nextAd) {
      // standard ad
      const nextAdIndex = (adSettings.ads.findIndex((ad) => ad.id === id) + 1) % adSettings.ads.length;
      nextAd = adSettings.ads[nextAdIndex];

      if (Util.daysDiff(date, new Date()) < adSettings.displayInterval || !nextAd) return undefined;
    }

    return {
      id: nextAd.id,
      url: nextAd.url.replace('{{lang}}', this.getAdLanguage(lang)),
      displayTime: adSettings.displayTime,
    };
  }

  // --- HELPER METHODS --- //
  private async getLightWalletAnnouncements(): Promise<AnnouncementDto[]> {
    const allowedAnnouncements = await this.settingService.getObj<string[]>('allowedAnnouncements', []);
    return this.http
      .get<AnnouncementDto[]>(`${this.lightWalletUrl}/announcements`, { tryCount: 3 })
      .then((r) => r.filter((a) => allowedAnnouncements.includes(a.id)))
      .catch(() => []);
  }

  private async getLightWalletFlags(): Promise<FlagDto[]> {
    const ignoredFlags = (await this.settingService.getObj<string[]>('ignoredFlags', [])).map((f) => f.split(':'));
    return this.http
      .get<FlagDto[]>(`${this.lightWalletUrl}/settings/flags`, { tryCount: 3 })
      .then((r) =>
        r.filter((f) => ignoredFlags.find((i) => i.length === 2 && i[0] === f.id && i[1] === f.stage) == null),
      )
      .catch(() => []);
  }

  private getSpecialAd(id: string, settings: AdSettings): { id: string; url: string } {
    const isSpecialAd =
      settings.specialAd &&
      new Date().getTime() > new Date(settings.specialAd.from).getTime() &&
      new Date().getTime() < new Date(settings.specialAd.to).getTime() &&
      id !== settings.specialAd.id;

    return isSpecialAd ? settings.specialAd : undefined;
  }

  private getAdLanguage(lang?: string): string {
    switch (lang?.slice(0, 2)) {
      case 'de':
        return 'DE';
      case 'es':
        return 'ES';
      case 'fr':
        return 'FR';
      case 'it':
        return 'IT';
      default:
        return 'EN';
    }
  }
}
