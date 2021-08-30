import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { EntityRepository, getManager, Repository } from 'typeorm';
import { CreateLogDto } from './dto/create-log.dto';
import { Log, LogDirection, LogStatus, LogType } from './log.entity';
import { isString } from 'class-validator';
import { FiatRepository } from 'src/fiat/fiat.repository';
import { AssetRepository } from 'src/asset/asset.repository';
import { UserRepository } from 'src/user/user.repository';

@EntityRepository(Log)
export class LogRepository extends Repository<Log> {
  async createLog(createLogDto: CreateLogDto): Promise<any> {
    
    if (
      !createLogDto.type ||
      (createLogDto.type != LogType.INFO &&
        createLogDto.type != LogType.TRANSACTION && createLogDto.type != LogType.VOLUME)
    )
      throw new BadRequestException('type must be Info or Transaction');
    if (
      createLogDto.status &&
      createLogDto.status != LogStatus.fiatDeposit &&
      createLogDto.status != LogStatus.fiat2btc &&
      createLogDto.status != LogStatus.btc2dfi &&
      createLogDto.status != LogStatus.dfi2asset &&
      createLogDto.status != LogStatus.assetWithdrawal &&
      createLogDto.status != LogStatus.assetDeposit &&
      createLogDto.status != LogStatus.btc2fiat &&
      createLogDto.status != LogStatus.dfi2btc &&
      createLogDto.status != LogStatus.asset2dfi &&
      createLogDto.status != LogStatus.fiatWithdrawal
    )
      throw new BadRequestException('wrong status');
    if (
      createLogDto.direction &&
      createLogDto.direction != LogDirection.fiat2asset &&
      createLogDto.direction != LogDirection.asset2fiat
    )
      throw new BadRequestException('wrong direction');

    let fiatObject = null;
    let assetObject = null;

    if (createLogDto.fiat){
      fiatObject = await getManager()
        .getCustomRepository(FiatRepository)
        .getFiat(createLogDto.fiat);
    }else{
      delete createLogDto.fiat;
    }

    if (createLogDto.asset){
      assetObject = await getManager()
        .getCustomRepository(AssetRepository)
        .getAsset(createLogDto.asset);
    }else{
      delete createLogDto.asset;
    }

    if (fiatObject) createLogDto.fiat = fiatObject.id;
    if (assetObject) createLogDto.asset = assetObject.id;

    if(createLogDto.address){
    createLogDto.orderId =
      createLogDto.address + ':' + new Date().toISOString();

      if(!createLogDto.user) createLogDto.user = await getManager()
      .getCustomRepository(UserRepository)
      .getUserInternal(createLogDto.address);

    }else if(createLogDto.user){
      createLogDto.orderId = createLogDto.user.address + ':' + new Date().toISOString();
    }else{
      createLogDto.orderId = new Date().toISOString();
    }

    const log = this.create(createLogDto);

    try {
      await this.save(log);
    } catch (error) {
      throw new ConflictException(error.message);
    }

    if(log["__user__"]) delete log["__user__"];
    log.fiat = fiatObject;
    log.asset = assetObject;

    return log;
  }

  async getAllLog(): Promise<any> {
    try {
      return await this.find();
    } catch (error) {
      throw new ConflictException(error.message);
    }
  }

  async getBuyVolume(): Promise<any> {
    try {
      const volumeLogs = await this.find({ type: LogType.VOLUME, direction: LogDirection.fiat2asset });
      let buyVolume = 0;
      for (let a = 0; a < volumeLogs.length; a++) {
        buyVolume += volumeLogs[a].assetValue;
      }
      return { buyVolume: buyVolume };
    } catch (error) {
      throw new ConflictException(error.message);
    }
  }

  async getSellVolume(): Promise<any> {
    try {
      const volumeLogs = await this.find({ type: LogType.VOLUME, direction: LogDirection.asset2fiat });
      let sellVolume = 0;
      for (let a = 0; a < volumeLogs.length; a++) {
        sellVolume += volumeLogs[a].assetValue;
      }
      return { sellVolume: sellVolume };
    } catch (error) {
      throw new ConflictException(error.message);
    }
  }

  async getVolume(): Promise<any> {
    try {
      return {
        totalVolume: [await this.getBuyVolume(), await this.getSellVolume()],
      };
    } catch (error) {
      throw new ConflictException(error.message);
    }
  }

  async getLog(key: any): Promise<any> {
    if (!isNaN(key.key)) {
      const log = await this.findOne({ id: key.key });

      if (log) return log;
    } else if (isString(key.key)) {
      let log = await this.findOne({ address: key.key });

      if (log) return log;

      log = await this.findOne({ orderId: key.key });

      if (log) return log;

      throw new NotFoundException('No matching log for id found');
    }
  }
}
