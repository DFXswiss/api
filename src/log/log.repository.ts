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

@EntityRepository(Log)
export class LogRepository extends Repository<Log> {
  async createLog(createLogDto: CreateLogDto): Promise<any> {
    if (createLogDto.id) delete createLogDto.id;
    if (createLogDto.orderId) delete createLogDto.orderId;
    if (createLogDto.created) delete createLogDto.created;
    if (
      !createLogDto.type ||
      (createLogDto.type != LogType.INFO &&
        createLogDto.type != LogType.TRANSACTION)
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

    if (createLogDto.fiat)
      fiatObject = await getManager()
        .getCustomRepository(FiatRepository)
        .getFiat(createLogDto.fiat);
    if (createLogDto.asset)
      assetObject = await getManager()
        .getCustomRepository(AssetRepository)
        .getAsset(createLogDto.asset);

    if (fiatObject) createLogDto.fiat = fiatObject.id;
    if (assetObject) createLogDto.asset = assetObject.id;

    createLogDto.orderId =
      createLogDto.address + ':' + new Date().toISOString();

    const log = this.create(createLogDto);

    try {
      await this.save(log);
    } catch (error) {
      throw new ConflictException(error.message);
    }

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
