import { Injectable } from '@nestjs/common';
import { LogRepository } from './log.repository';
import { CreateLogDto } from './dto/create-log.dto';
import { MailService } from 'src/services/mail.service';
import { CreateVolumeLogDto } from './dto/create-volume-log.dto';
import { HttpService } from 'src/shared/services/http.service';
import { AssetRepository } from 'src/asset/asset.repository';
import { BuyPaymentRepository } from 'src/payment/payment-buy.repository';
import { FiatRepository } from 'src/fiat/fiat.repository';
import { SellPaymentRepository } from 'src/payment/payment-sell.repository';
import { LogDirection, LogType } from './log.entity';
import { UserRepository } from 'src/user/user.repository';
import { User } from 'src/user/user.entity';
import { Not } from 'typeorm';
import { ConversionService } from 'src/shared/services/conversion.service';

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
  private readonly baseUrl = 'https://api.coingecko.com/api/v3/coins/defichain/market_chart?vs_currency=chf&days=1';

  async createLog(createLogDto: CreateLogDto): Promise<any> {
    return this.logRepository.createLog(createLogDto, this.mailService);
  }

  async createVolumeLog(createLogDto: CreateVolumeLogDto): Promise<any> {
    let assetObject = null;
    let fiatObject = null;

    if (createLogDto.payment) {
      if (createLogDto.direction === LogDirection.fiat2asset) {
        createLogDto.payment =
          createLogDto.direction === LogDirection.fiat2asset
            ? await this.buyPaymentRepo.getPaymentInternal(createLogDto.payment)
            : await this.sellPaymentRepo.getPaymentInternal(createLogDto.payment);
      } else {
        createLogDto.payment = await this.sellPaymentRepo.getPaymentInternal(createLogDto.payment);
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

      const result = await this.http.get(`${this.baseUrl}`);
      const resultArray = result['prices'];

      let sumPrice = 0;
      for (const price of resultArray) {
        sumPrice += Number.parseFloat(price[1]);
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

  async getRefVolume(ref: string): Promise<any> {
    const logsWithoutEur = await this.logRepository.find({ where: { message: ref, fiat: Not(2) } });
    const logsEur = await this.logRepository.find({ where: { message: ref, fiat: 2 } });
    const volumeWithoutEur = await this.conversionService.convertFiatCurrency(
      await this.logRepository.sum(logsWithoutEur, 'fiatInCHF', 2),
      'chf',
      'eur',
      new Date(),
    );
    const volumeEur = await this.logRepository.sum(logsEur, 'fiatValue', 2);

    return this.conversionService.round(volumeWithoutEur + volumeEur, 0);
  }

  async getAssetVolume(logType: LogType, logDirection: LogDirection): Promise<any> {
    return this.logRepository.getAssetVolume(logType, logDirection);
  }

  async getChfVolume(logType: LogType, logDirection: LogDirection): Promise<any> {
    return this.logRepository.getChfVolume(logType, logDirection);
  }

  async getUserVolume(user: User, logDirection: LogDirection): Promise<any> {
    const logsWithoutEur = await this.logRepository.find({
      where: { type: LogType.TRANSACTION, address: user.address, direction: logDirection, status: null, fiat: Not(2) },
    });
    const logsEur = await this.logRepository.find({
      where: { type: LogType.TRANSACTION, address: user.address, direction: logDirection, status: null, fiat: 2 },
    });

    const volumeWithoutEur = await this.conversionService.convertFiatCurrency(
      await this.logRepository.sum(logsWithoutEur, 'fiatInCHF', 2),
      'chf',
      'eur',
      new Date(),
    );
    const volumeEur = await this.logRepository.sum(logsEur, 'fiatValue', 2);

    return this.conversionService.round(volumeWithoutEur + volumeEur, 0);
  }
}
