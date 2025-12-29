import { Controller, Get, Param, Query, Redirect, Req, Res, VERSION_NEUTRAL, Version } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { UserAgent } from 'express-useragent';
import { RealIP } from 'nestjs-real-ip';
import { Config } from './config/config';
import { AdDto, AdSettings, AdvertisementDto } from './shared/dto/advertisement.dto';
import { AnnouncementDto } from './shared/dto/announcement.dto';
import { FlagDto } from './shared/dto/flag.dto';
import { SettingService } from './shared/models/setting/setting.service';
import { Util } from './shared/utils/util';
import { RefService } from './subdomains/core/referral/process/ref.service';

enum App {
  BTC = 'btc',
  FRANKENCOIN = 'frankencoin',
  EXCHANGE = 'exchange',
  LIGHTNING = 'lightning',
  SERVICES = 'services',
}

enum Manufacturer {
  APPLE = 'Apple',
  GOOGLE = 'Google',
  UNKNOWN = 'Unknown',
}

@Controller('')
export class AppController {
  private readonly homepageUrl = 'https://dfx.swiss/';
  private readonly appleStoreUrl = 'https://apps.apple.com/app';
  private readonly googleStoreUrl = 'https://play.app.goo.gl/?link=https://play.google.com/store/apps/details';

  private readonly appUrls = {
    [App.BTC]: {
      [Manufacturer.APPLE]: `${this.appleStoreUrl}/id6466037617`,
      [Manufacturer.GOOGLE]: `${this.googleStoreUrl}?id=swiss.dfx.bitcoin`,
      [Manufacturer.UNKNOWN]: this.homepageUrl,
    },
    [App.FRANKENCOIN]: {
      [Manufacturer.APPLE]: `${this.appleStoreUrl}/id6480348701`,
      [Manufacturer.GOOGLE]: `${this.googleStoreUrl}?id=swiss.dfx.frankencoin_wallet`,
      [Manufacturer.UNKNOWN]: 'https://frankencoin.app/',
    },
    [App.EXCHANGE]: 'https://exchange.dfx.swiss/',
    [App.LIGHTNING]: 'https://lightning.dfx.swiss/',
    [App.SERVICES]: 'https://app.dfx.swiss/',
  };

  constructor(
    private readonly refService: RefService,
    private readonly settingService: SettingService,
  ) {}

  @Get()
  @Redirect('swagger')
  @ApiExcludeEndpoint()
  @Version(VERSION_NEUTRAL)
  async home(): Promise<any> {
    // nothing to do (redirect to Swagger UI)
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

      if (Util.daysDiff(date) < adSettings.displayInterval || !nextAd) return undefined;
    }

    return {
      id: nextAd.id,
      url: nextAd.url.replace('{{lang}}', this.getAdLanguage(lang)),
      displayTime: adSettings.displayTime,
    };
  }

  // --- REFERRAL --- //
  @Get('app')
  @ApiExcludeEndpoint()
  async createRefNew(
    @RealIP() ip: string,
    @Query('code') code: string,
    @Query('orig') origin: string,
    @Res() res: Response,
  ): Promise<void> {
    const ref = await this.getRef(code);
    if (ref || origin) await this.refService.addOrUpdate(ip, code, origin);
    res.redirect(307, this.homepageUrl);
  }

  @Get('app/:app')
  @ApiExcludeEndpoint()
  async redirectToStore(
    @RealIP() ip: string,
    @Param('app') app: App,
    @Query('code') code: string,
    @Query('orig') origin: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const ref = await this.getRef(code);
    if (ref || origin) await this.refService.addOrUpdate(ip, ref, origin);

    // redirect user depending on app and platform
    let url: string;
    if (app === App.EXCHANGE || app === App.LIGHTNING || app === App.SERVICES) {
      url = this.appUrls[app];
    } else {
      url = this.appUrls[app]?.[this.getDeviceManufacturer(req)];
    }

    res.redirect(303, url ?? this.homepageUrl);
  }

  private async getRef(code: string): Promise<string | undefined> {
    const keys = await this.settingService.getObj('ref-keys', {});

    return Config.formats.ref.test(code) ? code : keys[code];
  }

  // --- HELPER METHODS --- //
  private async getLightWalletAnnouncements(): Promise<AnnouncementDto[]> {
    return [];
  }

  private async getLightWalletFlags(): Promise<FlagDto[]> {
    return [];
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

  private getDeviceManufacturer(req: Request): Manufacturer {
    const agent = new UserAgent().parse(req.headers['user-agent'] ?? '');
    if (agent.isAndroid) {
      return Manufacturer.GOOGLE;
    } else if (agent.isiPhone || agent.isiPad || agent.isiPod || agent.isMac) {
      return Manufacturer.APPLE;
    } else {
      return Manufacturer.UNKNOWN;
    }
  }
}
