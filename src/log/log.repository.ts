import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { EntityRepository, getManager, Repository } from 'typeorm';
import { CreateLogDto } from './dto/create-log.dto';
import { Log, LogDirection, LogStatus, LogType } from './log.entity';
import { isString } from 'class-validator';
import { FiatRepository } from 'src/fiat/fiat.repository';
import { AssetRepository } from 'src/asset/asset.repository';
import { UserRepository } from 'src/user/user.repository';
import { BuyPaymentRepository } from 'src/payment/payment-buy.repository';
import { SellPaymentRepository } from 'src/payment/payment-sell.repository';
import { MailService } from 'src/services/mail.service';
import { User } from 'src/user/user.entity';
import { UserStatus } from 'src/user/user.entity';
import { CreateVolumeLogDto } from './dto/create-volume-log.dto';
import requestPromise from 'request-promise-native';
import { ConversionService } from 'src/services/conversion.service';

@EntityRepository(Log)
export class LogRepository extends Repository<Log> {
  async createLog(createLogDto: CreateLogDto, mailService?: MailService): Promise<any> {
    let fiatObject = null;
    let assetObject = null;
    let paymentObject = null;

    if (createLogDto.payment) {
      paymentObject = await getManager()
        .getCustomRepository(BuyPaymentRepository)
        .getPaymentInternal(createLogDto.payment);

      if (!paymentObject) {
        paymentObject = await getManager()
          .getCustomRepository(SellPaymentRepository)
          .getPaymentInternal(createLogDto.payment);
      }
    } else {
      delete createLogDto.payment;
    }

    if (createLogDto.fiat) {
      fiatObject = await getManager().getCustomRepository(FiatRepository).getFiat(createLogDto.fiat);
    } else {
      delete createLogDto.fiat;
    }

    if (createLogDto.asset) {
      assetObject = await getManager().getCustomRepository(AssetRepository).getAsset(createLogDto.asset);
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
      if (log.type === LogType.TRANSACTION && !log.status) {
        if (createLogDto.user.mail) mailService.sendLogMail(createLogDto, 'Transaction has been completed');

        if (log.user) {
          const currentUser = log.user;

          if (currentUser.status == UserStatus.NA) {
            currentUser.status = UserStatus.ACTIVE;

            await getManager().getCustomRepository(UserRepository).save(currentUser);
          }
        }
      }
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
      return await this.find();
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

  async getVolume(
    logType: LogType,
    logDirection: LogDirection,
    value: string,
    currency: string,
    conversionService: ConversionService,
  ): Promise<number> {
    const volumeLogs = await this.find({
      type: logType,
      direction: logDirection,
    });
    return this.sum(volumeLogs, value, currency, conversionService);
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

  async getRefVolume(ref: string, conversionService: ConversionService): Promise<number> {
    const logs = await this.find({ where: { message: ref } });
    return this.sum(logs, 'fiatValue', 'eur', conversionService);
  }

  async getUserVolume(
    user: User,
    logDirection: LogDirection,
    currency: string,
    value: string,
    conversionService: ConversionService,
  ): Promise<any> {
    const logs = await this.find({
      where: { type: LogType.TRANSACTION, address: user.address, direction: logDirection, status: null },
    });
    return this.sum(logs, value, currency, conversionService);
  }

  async sum(logs: Log[], value: string, currency: string, conversionService: ConversionService): Promise<number> {
    let sum: number = 0;
    for (const key in logs) {
      if (logs[key].fiat.name != 'EUR') {
        sum =
          sum +
          (await conversionService.convertFiatCurrency(logs[key][value], logs[key].fiat.name, currency, new Date()));
      } else {
        sum = sum + logs[key][value];
      }
    }

    return sum;
  }
}
