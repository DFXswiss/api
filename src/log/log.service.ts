import { Injectable } from '@nestjs/common';
import { LogRepository } from './log.repository';
import { CreateLogDto } from './dto/create-log.dto';
import { MailService } from 'src/services/mail.service';
import { CreateVolumeLogDto } from './dto/create-volume-log.dto';
import { HttpService } from 'src/services/http.service';
import { AssetRepository } from 'src/asset/asset.repository';
import { BuyPaymentRepository } from 'src/payment/payment-buy.repository';
import { FiatRepository } from 'src/fiat/fiat.repository';
import { SellPaymentRepository } from 'src/payment/payment-sell.repository';
import { LogDirection, LogType } from './log.entity';
import { UserRepository } from 'src/user/user.repository';
import { Fiat } from 'src/fiat/fiat.entity';
import { ConversionService } from 'src/services/conversion.service';
import { User } from 'src/user/user.entity';

@Injectable()
export class LogService {
  constructor(
    private logRepository: LogRepository,
    private mailService: MailService,
    private http: HttpService,
    private assetRepository: AssetRepository,
    private buyPaymentRepo: BuyPaymentRepository,
    private sellPaymentRepo: SellPaymentRepository,
    private fiatRepo: FiatRepository,
    private userRepo: UserRepository,
    private conversionService: ConversionService,
  ) {}
  private baseUrl = 'https://api.coingecko.com/api/v3/coins/defichain/market_chart?vs_currency=chf&days=1';

  async createLog(createLogDto: CreateLogDto): Promise<any> {
    return this.logRepository.createLog(createLogDto, this.mailService);
  }

  async createVolumeLog(createLogDto: CreateVolumeLogDto): Promise<any> {
    let assetObject = null;
    let fiatObject = null;
    let paymentObject = null;

    if (createLogDto.payment) {
      paymentObject = await this.buyPaymentRepo.getPaymentInternal(createLogDto.payment);

      if (!paymentObject) {
        paymentObject = await this.sellPaymentRepo.getPaymentInternal(createLogDto.payment);
      }
    } else {
      delete createLogDto.payment;
    }

    if (createLogDto.fiat) {
      fiatObject = await this.fiatRepo.getFiat(createLogDto.fiat);
    } else {
      delete createLogDto.fiat;
    }

    if (createLogDto.asset) {
      assetObject = await this.assetRepository.getAsset(createLogDto.asset);
    }

    if (assetObject.name != 'DFI') {
      assetObject = await this.assetRepository.getAsset('DFI');

      let result = await this.http.request({
        url: `${this.baseUrl}`,
        method: 'GET',
      });

      let resultArray = result['prices'];

      let sumPrice = 0;

      for (let a = 0; a < resultArray.length; a++) {
        sumPrice += Number.parseFloat(resultArray[a][1]);
      }

      const currentDfiPrice = sumPrice / resultArray.length;

      const volumeInDFI = createLogDto.fiatInCHF / currentDfiPrice;

      createLogDto.assetValue = volumeInDFI;
    }

    if (fiatObject) createLogDto.fiat = fiatObject.id;
    if (assetObject) createLogDto.asset = assetObject.id;

    createLogDto.type = LogType.VOLUME;

    createLogDto.orderId = createLogDto.address + ':' + new Date().toISOString();

    if (!createLogDto.user) {
      const userObject = await this.userRepo.getUserInternal(createLogDto.address);

      createLogDto.user = userObject;
      createLogDto.message = userObject.usedRef;
    }

    delete createLogDto.address;

    const log = await this.logRepository.createVolumeLog(createLogDto);

    log.asset = assetObject;
    log.fiat = fiatObject;

    return log;
  }

  async getAllLog(): Promise<any> {
    return this.logRepository.getAllLog();
  }

  async getAllUserLog(address: string): Promise<any> {
    return this.logRepository.getAllUserLog(address);
  }

  async getLog(key: any): Promise<any> {
    return this.logRepository.getLog(key);
  }

  async getVolume(logType: LogType, logDirection: LogDirection, value: string): Promise<any> {
    return this.logRepository.getVolume(logType, logDirection, value, 'eur', this.conversionService);
  }

  async getUserVolume(user: User, logDirection: LogDirection, value: string): Promise<any> {
    return this.logRepository.getUserVolume(user, logDirection, value, 'eur', this.conversionService);
  }
}
