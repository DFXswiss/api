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
          const currentUser = await log.user;

          if (currentUser.status == UserStatus.NA) {
            currentUser.status = UserStatus.ACTIVE;

            await getManager().getCustomRepository(UserRepository).save(currentUser);
          }
        }
      }
    } catch (error) {
      throw new ConflictException(error.message);
    }

    if (log['__user__']) delete log['__user__'];
    if (log['__payment__']) delete log['__payment__'];

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

    if (log['__user__']) delete log['__user__'];
    if (log['__payment__']) delete log['__payment__'];

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

  async getBuyDFIVolume(): Promise<any> {
    try {
      const volumeLogs = await this.find({
        type: LogType.VOLUME,
        direction: LogDirection.fiat2asset,
      });
      let buyVolume = 0;
      for (let a = 0; a < volumeLogs.length; a++) {
        buyVolume += volumeLogs[a].assetValue;
      }

      return Math.round(buyVolume * Math.pow(10, 8)) / Math.pow(10, 8);
    } catch (error) {
      throw new ConflictException(error.message);
    }
  }

  async getSellDFIVolume(): Promise<any> {
    try {
      const volumeLogs = await this.find({
        type: LogType.VOLUME,
        direction: LogDirection.asset2fiat,
      });
      let sellVolume = 0;
      for (let a = 0; a < volumeLogs.length; a++) {
        sellVolume += volumeLogs[a].assetValue;
      }
      return Math.round(sellVolume * Math.pow(10, 8)) / Math.pow(10, 8);
    } catch (error) {
      throw new ConflictException(error.message);
    }
  }

  async getDFIVolume(): Promise<any> {
    try {
      return {
        buy: await this.getBuyDFIVolume(),
        sell: await this.getSellDFIVolume(),
      };
    } catch (error) {
      throw new ConflictException(error.message);
    }
  }

  async getBuyCHFVolume(): Promise<any> {
    try {
      const volumeLogs = await this.find({
        type: LogType.VOLUME,
        direction: LogDirection.fiat2asset,
      });
      let buyVolume = 0;
      for (let a = 0; a < volumeLogs.length; a++) {
        buyVolume += volumeLogs[a].fiatInCHF;
      }
      return Math.round(buyVolume * Math.pow(10, 2)) / Math.pow(10, 2);
    } catch (error) {
      throw new ConflictException(error.message);
    }
  }

  async getSellCHFVolume(): Promise<any> {
    try {
      const volumeLogs = await this.find({
        type: LogType.VOLUME,
        direction: LogDirection.asset2fiat,
      });
      let sellVolume = 0;
      for (let a = 0; a < volumeLogs.length; a++) {
        sellVolume += volumeLogs[a].fiatInCHF;
      }
      return Math.round(sellVolume * Math.pow(10, 2)) / Math.pow(10, 2);
    } catch (error) {
      throw new ConflictException(error.message);
    }
  }

  async getCHFVolume(): Promise<any> {
    try {
      return {
        buy: await this.getBuyCHFVolume(),
        sell: await this.getSellCHFVolume(),
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

  async getRefVolume(ref: string): Promise<Number> {
    let volume: number = 0;
    const test = (await this.find({ where: { message: ref } })).forEach((a) => (volume += a.fiatValue));
    return volume;
  }

  async getVolume(user: User): Promise<any> {
    let buyVolume = 0;
    let sellVolume = 0;
    (await this.find({ type: LogType.TRANSACTION, address: user.address, direction: LogDirection.fiat2asset })).forEach(
      (a) => (buyVolume += a.fiatValue),
    );
    (await this.find({ type: LogType.TRANSACTION, address: user.address, direction: LogDirection.asset2fiat })).forEach(
      (a) => (sellVolume += a.fiatValue),
    );

    const result = {
      buyVolume: buyVolume,
      sellVolume: sellVolume,
    };

    return result;
  }
}
