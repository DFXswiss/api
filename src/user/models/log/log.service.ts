import { ConflictException, Injectable } from '@nestjs/common';
import { LogRepository } from './log.repository';
import { CreateLogDto } from './dto/create-log.dto';
import { CreateVolumeLogDto } from './dto/create-volume-log.dto';
import { HttpService } from 'src/shared/services/http.service';
import { LogDirection, LogType } from './log.entity';
import { UserRepository } from 'src/user/models/user/user.repository';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { Not } from 'typeorm';
import { ConversionService } from 'src/shared/services/conversion.service';
import { Util } from 'src/shared/util';

// TODO: crypto conversion to service
@Injectable()
export class LogService {
  constructor(
    private logRepository: LogRepository,
    private http: HttpService,
    private assetService: AssetService,
    private fiatService: FiatService,
    private userRepo: UserRepository,
    private conversionService: ConversionService,
  ) {}
  private readonly baseUrl = 'https://api.coingecko.com/api/v3/coins/defichain/market_chart?vs_currency=chf&days=1';

  async createLog(createLogDto: CreateLogDto): Promise<any> {
    let existingLog;
    let currentAddress;

    if (createLogDto.blockchainTx) {
      if (createLogDto.address) {
        currentAddress = createLogDto.address;
      } else if (createLogDto.user) {
        currentAddress = createLogDto.user.address;
      }

      existingLog = await this.logRepository
        .createQueryBuilder('log')
        .innerJoin('log.user', 'user')
        .where('user.address = :address', { address: currentAddress })
        .andWhere('log.blockchainTx = :blockchainTx', { blockchainTx: createLogDto.blockchainTx })
        .andWhere('log.type = :type', { type: createLogDto.type })
        .getRawOne();
    }

    if (existingLog) throw new ConflictException('Log already existing - duplicate log');

    if (createLogDto.type === LogType.TRANSACTION && !createLogDto.status) {
      if (!createLogDto.user && createLogDto.address) {
        const userObject = await this.userRepo.findOne({
          where: { address: createLogDto.address },
          relations: ['wallet'],
        });

        createLogDto.user = userObject;
        createLogDto.usedRef = userObject.usedRef;
        //createLogDto.refFeePercent = userObject.refFeePercent;
        createLogDto.usedWallet = userObject.wallet.id;
      } else if (createLogDto.user) {
        createLogDto.usedRef = createLogDto.user.usedRef;
        //createLogDto.refFeePercent = createLogDto.user.refFeePercent;
        createLogDto.usedWallet = createLogDto.user.wallet.id;
      } else {
        delete createLogDto.usedRef;
        delete createLogDto.usedWallet;
        delete createLogDto.refFeePercent;
      }
    } else {
      delete createLogDto.usedRef;
      delete createLogDto.usedWallet;
      delete createLogDto.refFeePercent;
    }

    return this.logRepository.createLog(createLogDto, this.assetService, this.fiatService);
  }

  async createVolumeLog(createLogDto: CreateVolumeLogDto): Promise<any> {
    let assetObject = null;
    let fiatObject = null;
    let currentAddress;
    let existingLog;

    createLogDto.type = LogType.VOLUME;

    if (createLogDto.blockchainTx) {
      if (createLogDto.address) {
        currentAddress = createLogDto.address;
      } else if (createLogDto.user) {
        currentAddress = createLogDto.user.address;
      }

      existingLog = await this.logRepository
        .createQueryBuilder('log')
        .innerJoin('log.user', 'user')
        .where('user.address = :address', { address: currentAddress })
        .andWhere('log.blockchainTx = :blockchainTx', { blockchainTx: createLogDto.blockchainTx })
        .andWhere('log.type = :type', { type: createLogDto.type })
        .getRawOne();
    }

    if (existingLog) throw new ConflictException('Log already existing - duplicate log');

    if (createLogDto.fiat) {
      fiatObject = await this.fiatService.getFiatOld(createLogDto.fiat);
    } else {
      delete createLogDto.fiat;
    }

    if (createLogDto.asset) {
      assetObject = await this.assetService.getAssetOld(createLogDto.asset);
    }

    if (assetObject.name != 'DFI') {
      assetObject = await this.assetService.getAssetByDexName('DFI');

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
      //createLogDto.message = userObject.usedRef;
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

  async getRefVolume(ref: string, fiat: string): Promise<any> {
    const logsWithoutEur = await this.logRepository.find({ where: { usedRef: ref, fiat: Not(2) } });
    const logsEur = await this.logRepository.find({ where: { usedRef: ref, fiat: 2 } });
    const volumeWithoutEur = await this.conversionService.convertFiatCurrency(
      await this.logRepository.sum(logsWithoutEur, 'fiatInCHF', 2),
      'chf',
      fiat,
    );
    const volumeEur = await this.logRepository.sum(logsEur, 'fiatValue', 2);

    return Util.round(volumeWithoutEur + volumeEur, 0);
  }

  async getAssetVolume(logType: LogType, logDirection: LogDirection): Promise<any> {
    return this.logRepository.getAssetVolume(logType, logDirection);
  }

  async getChfVolume(logType: LogType, logDirection: LogDirection): Promise<any> {
    return this.logRepository.getChfVolume(logType, logDirection);
  }
}
