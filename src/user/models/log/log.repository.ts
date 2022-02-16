import { ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { EntityRepository, getManager, Repository } from 'typeorm';
import { CreateLogDto } from './dto/create-log.dto';
import { Log, LogDirection, LogType } from './log.entity';
import { isString } from 'class-validator';
import { UserRepository } from 'src/user/models/user/user.repository';
import { CreateVolumeLogDto } from './dto/create-volume-log.dto';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { UpdateLogDto } from './dto/update-log.dto';

@EntityRepository(Log)
export class LogRepository extends Repository<Log> {
  async createLog(createLogDto: CreateLogDto, assetService: AssetService, fiatService: FiatService): Promise<any> {
    let fiatObject = null;
    let assetObject = null;

    if (createLogDto.fiat) {
      fiatObject = await fiatService.getFiatOld(createLogDto.fiat);
    } else {
      delete createLogDto.fiat;
    }

    if (createLogDto.asset) {
      assetObject = await assetService.getAssetOld(createLogDto.asset);
    } else {
      delete createLogDto.asset;
    }

    if (fiatObject) createLogDto.fiat = fiatObject.id;
    if (assetObject) createLogDto.asset = assetObject.id;

    if (createLogDto.address) {
      createLogDto.orderId = createLogDto.address + ':' + new Date().toISOString();

      if (!createLogDto.user)
        createLogDto.user = await getManager()
          .getCustomRepository(UserRepository)
          .getUserInternal(createLogDto.address);
    } else if (createLogDto.user) {
      createLogDto.orderId = createLogDto.user.address + ':' + new Date().toISOString();
    } else {
      createLogDto.orderId = new Date().toISOString();
    }

    if (createLogDto.type === LogType.VOLUME) delete createLogDto.address;

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

  async createVolumeLog(createLogDto: CreateVolumeLogDto): Promise<Log> {
    const log = this.create(createLogDto);

    try {
      await this.save(log);
    } catch (error) {
      throw new ConflictException(error.message);
    }

    return log;
  }

  async getAllLog(): Promise<any> {
    try {
      return await this.find({ relations: ['user'] });
    } catch (error) {
      throw new ConflictException(error.message);
    }
  }

  async getAllUserLog(address: string): Promise<any> {
    try {
      return await this.find({ address: address });
    } catch (error) {
      throw new ConflictException(error.message);
    }
  }

  async getAssetVolume(logType: LogType, logDirection: LogDirection): Promise<number> {
    const volumeLogs = await this.find({
      type: logType,
      direction: logDirection,
    });
    return this.sum(volumeLogs, 'assetValue', 8);
  }

  async getChfVolume(logType: LogType, logDirection: LogDirection): Promise<number> {
    const volumeLogs = await this.find({
      type: logType,
      direction: logDirection,
    });
    return this.sum(volumeLogs, 'fiatInCHF', 2);
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

  async getRefVolumeChf(ref: string): Promise<number> {
    const logs = await this.find({ where: { message: ref } });
    return this.sum(logs, 'fiatInCHF', 2);
  }

  async sum(logs: Log[], value: string, decimals: number): Promise<number> {
    return Math.round(logs.reduce((sum, log) => sum + log[value], 0) * Math.pow(10, decimals)) / Math.pow(10, decimals);
  }

  async updateLog(updatedLog: UpdateLogDto): Promise<any> {
    try {
      const log = await this.findOne({ id: updatedLog.id });
      if (!log) throw new NotFoundException('No matching user for id found');

      return Object.assign(log, await this.save(updatedLog));
    } catch (error) {
      throw new ServiceUnavailableException(error.message);
    }
  }
}
