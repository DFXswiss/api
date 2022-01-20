import { Injectable } from '@nestjs/common';
import { LogService } from 'src/user/models/log/log.service';
import { LogDirection, LogType } from 'src/user/models/log/log.entity';
import { ConversionService } from 'src/shared/services/conversion.service';
import { BuyService } from 'src/user/models/buy/buy.service';
import { SellService } from 'src/user/models/sell/sell.service';
import { SettingService } from 'src/shared/setting/setting.service';

@Injectable()
export class StatisticService {
  constructor(
    private buyService: BuyService,
    private sellService: SellService,
    private logService: LogService,
    private conversionService: ConversionService,
    private settingService: SettingService,
  ) {}

  async getStatus(): Promise<any> {
    return {
      deposit: await this.settingService.get('deposit'),
      withdraw: await this.settingService.get('withdraw'),
    };
  }

  async getBuyRouteCount(): Promise<number> {
    return this.buyService.count();
  }

  async getSellRouteCount(): Promise<number> {
    return this.sellService.count();
  }

  async getRouteCount(): Promise<any> {
    return {
      buy: await this.getBuyRouteCount(),
      sell: await this.getSellRouteCount(),
    };
  }

  async getAll(): Promise<any> {
    return {
      dfxStatistic: {
        routes: await this.getRouteCount(),
        volume: {
          DFI: {
            buy: await this.logService.getAssetVolume(LogType.VOLUME, LogDirection.fiat2asset),
            sell: await this.logService.getAssetVolume(LogType.VOLUME, LogDirection.asset2fiat),
          },
          EUR: {
            buy: await this.conversionService.convertFiatCurrency(
              await this.logService.getChfVolume(LogType.VOLUME, LogDirection.fiat2asset),
              'chf',
              'eur',
            ),
            sell: await this.conversionService.convertFiatCurrency(
              await this.logService.getChfVolume(LogType.VOLUME, LogDirection.asset2fiat),
              'chf',
              'eur',
            ),
          },
          CHF: {
            buy: await this.logService.getChfVolume(LogType.VOLUME, LogDirection.fiat2asset),
            sell: await this.logService.getChfVolume(LogType.VOLUME, LogDirection.asset2fiat),
          },
        },
        status: await this.getStatus(),
      },
    };
  }
}
