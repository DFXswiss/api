import {
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { EntityRepository, Repository } from 'typeorm';
import { CreateBuyPaymentDto } from './dto/create-buy-payment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { BuyPayment } from './payment-buy.entity';
import { FiatRepository } from 'src/fiat/fiat.repository';
import { getManager } from 'typeorm';
import { AssetRepository } from 'src/asset/asset.repository';
import { BuyRepository } from 'src/buy/buy.repository';
import { PaymentError, PaymentStatus } from './payment.entity';
import { LogRepository } from 'src/log/log.repository';
import { CreateLogDto } from 'src/log/dto/create-log.dto';
import { LogDirection, LogStatus, LogType } from 'src/log/log.entity';
import { CreateUserDataDto } from 'src/userData/dto/create-userData.dto';
import { UserDataRepository } from 'src/userData/userData.repository';
import { CountryRepository } from 'src/country/country.repository';
import * as requestPromise from 'request-promise-native';
import { Buy } from 'src/buy/buy.entity';

@EntityRepository(BuyPayment)
export class BuyPaymentRepository extends Repository<BuyPayment> {
  async createPayment(createPaymentDto: CreateBuyPaymentDto): Promise<any> {
    if (createPaymentDto.id) delete createPaymentDto['id'];
    if (createPaymentDto.created) delete createPaymentDto['created'];

    // let assetObject = null;
    let fiatObject = null;
    let countryObject = null;
    let buy: Buy = null;

    try {
      fiatObject = await getManager()
        .getCustomRepository(FiatRepository)
        .getFiat(createPaymentDto.fiat);

      createPaymentDto.fiat = fiatObject.id;
    } catch {
      createPaymentDto.info = 'Wrong Fiat: ' + createPaymentDto.fiat;
      createPaymentDto.fiat = null;
      createPaymentDto.errorCode = PaymentError.FIAT;
    }

    try {
      let baseUrl =
        'https://cdn.jsdelivr.net/gh/fawazahmed0/currency-api@1/latest/currencies/' +
        fiatObject.name.toLowerCase() +
        '.json';

      const receivedDate = new Date(createPaymentDto.received);

      const isToday = (someDate: Date) => {
        const today = new Date();
        return (
          someDate.getDate() == today.getDate() &&
          someDate.getMonth() == today.getMonth() &&
          someDate.getFullYear() == today.getFullYear()
        );
      };

      if (!isToday(receivedDate)) {
        baseUrl =
          'https://cdn.jsdelivr.net/gh/fawazahmed0/currency-api@1/' +
          receivedDate.toISOString().split('T')[0] +
          '/currencies/' +
          fiatObject.name.toLowerCase() +
          '.json';
      }

      const options = {
        uri: baseUrl,
      };

      const result = await requestPromise.get(options);

      createPaymentDto.fiatInCHF =
        Number.parseFloat(result.split('"chf": ')[1].split(',')[0]) *
        createPaymentDto.fiatValue;
    } catch (error) {
      throw new ConflictException(error.message);
    }

    if (createPaymentDto.bankUsage) {
      buy = await getManager()
        .getCustomRepository(BuyRepository)
        .getBuyByBankUsage(createPaymentDto.bankUsage);
    }

    if (buy) {
      createPaymentDto.address = buy.address;
      createPaymentDto.buy = buy;

      if (!buy.iban || !createPaymentDto.iban) {
        createPaymentDto.info =
          'Missing IBAN: ' + createPaymentDto.iban + ', ' + buy.iban;
        createPaymentDto.errorCode = PaymentError.IBAN;
      } else if (buy.iban != createPaymentDto.iban) {
        createPaymentDto.info =
          'Wrong IBAN: ' + createPaymentDto.iban + ' instead of ' + buy.iban;
        createPaymentDto.errorCode = PaymentError.IBAN;
      }

      //   assetObject = await getManager()
      //     .getCustomRepository(AssetRepository)
      //     .getAsset(buy.asset);

      if (buy.asset.buyable) {
        createPaymentDto.asset = buy.asset.id;
      } else {
        createPaymentDto.info = 'Asset not buyable: ' + createPaymentDto.asset;
        createPaymentDto.errorCode = PaymentError.ASSET;
      }
    } else {
      createPaymentDto.info = '';

      const currentPayment = await this.find({
        iban: createPaymentDto.iban,
        errorCode: PaymentError.NULL,
      });

      if (!currentPayment) {
        const currentBuy = await getManager()
          .getCustomRepository(BuyRepository)
          .find({ iban: createPaymentDto.iban });

        if (currentBuy) {
          createPaymentDto.info = 'UserID: ' + currentBuy[0].user.id;

          for (let a = 0; a < currentBuy.length; a++) {
            if (currentBuy[a].user.mail) {
              createPaymentDto.info +=
                '; User Mail: ' + currentBuy[a].user.mail;
              if (!currentBuy[a].user.phone) break;
            }
            if (currentBuy[a].user.phone) {
              createPaymentDto.info +=
                '; User Phonenumber: ' + currentBuy[a].user.phone;
              break;
            }
          }
        }
      }

      if (!createPaymentDto.info) {
        const currentUserData = await getManager()
          .getCustomRepository(UserDataRepository)
          .getUserData(createPaymentDto);

        if (currentUserData) {
          for (let a = 0; a < currentUserData.users.length; a++) {
            if (currentUserData.users[a].mail) {
              createPaymentDto.info +=
                '; User Mail: ' + currentUserData.users[a].mail;
              if (!currentUserData.users[a].phone) break;
            }
            if (currentUserData.users[a].phone) {
              createPaymentDto.info +=
                '; User Phonenumber: ' + currentUserData.users[a].phone;
              break;
            }
          }
        }
      }

      createPaymentDto.info = '; User Name: ' + createPaymentDto.name;
      createPaymentDto.info += '; User Location: ' + createPaymentDto.location;
      createPaymentDto.info += '; User Country: ' + createPaymentDto.country;

      createPaymentDto.info =
        '; Wrong BankUsage: ' + createPaymentDto.bankUsage;
      createPaymentDto.asset = null;
      createPaymentDto.errorCode = PaymentError.BANKUSAGE;
    }

    if (!createPaymentDto.errorCode) {
      countryObject = await getManager()
        .getCustomRepository(CountryRepository)
        .getCountry(createPaymentDto.country);

      createPaymentDto.country = countryObject;

      let currentUserData = await getManager()
        .getCustomRepository(UserDataRepository)
        .getUserData(createPaymentDto);

      createPaymentDto.country = countryObject.id;

      //TODO Summe letzte 30 Tage checken

      if (!currentUserData) {
        const createUserDataDto = new CreateUserDataDto();
        createUserDataDto.name = createPaymentDto.name;
        createUserDataDto.location = createPaymentDto.location;
        createUserDataDto.country = createPaymentDto.country;

        currentUserData = await getManager()
          .getCustomRepository(UserDataRepository)
          .createUserData(createUserDataDto);
      } else if (buy) {
        // const currentUser = buy.user;
        // const query = this.createQueryBuilder('buy');
        //   query.where({ address });
        //   query.innerJoinAndSelect('buy.asset','assetXYZ');
        // const buy = await query.getMany();
        // if(!currentUser.userData){
        //     currentUser.userData = currentUserData;
        //     await getManager()
        //         .getCustomRepository(UserDataRepository).save(currentUser)
        // }
      }
    }

    const logDto: CreateLogDto = new CreateLogDto();
    logDto.status = LogStatus.fiatDeposit;
    if (fiatObject) logDto.fiat = fiatObject.id;
    logDto.fiatValue = createPaymentDto.fiatValue;
    logDto.iban = createPaymentDto.iban;
    logDto.direction = LogDirection.fiat2asset;
    logDto.type = LogType.TRANSACTION;
    logDto.address = createPaymentDto.address;
    logDto.fiatInCHF = createPaymentDto.fiatInCHF;

    if (buy) {
      logDto.user = buy.user;
    }

    if (createPaymentDto.info) {
      logDto.message = createPaymentDto.info;
    }

    await getManager().getCustomRepository(LogRepository).createLog(logDto);

    const payment = this.create(createPaymentDto);

    if (payment) {
      await this.save(payment);
      payment.fiat = fiatObject;
      payment.asset = buy.asset;
    }
    return payment;
  }

  async updatePayment(payment: UpdatePaymentDto): Promise<any> {
    const currentPayment = await this.findOne({ id: payment.id });

    if (!currentPayment)
      throw new NotFoundException('No matching payment for id found');

    currentPayment.status = payment.status;

    await this.save(currentPayment);

    const newPayment = await this.findOne({ id: payment.id });

    if (newPayment) {
      if (newPayment.fiat)
        newPayment.fiat = await getManager()
          .getCustomRepository(FiatRepository)
          .getFiat(newPayment.fiat);
      if (newPayment.asset)
        newPayment.asset = await getManager()
          .getCustomRepository(AssetRepository)
          .getAsset(newPayment.asset);
    }

    return newPayment;
  }

  async getAllPayment(): Promise<any> {
    const payment = await this.find();

    if (payment) {
      for (let a = 0; a < payment.length; a++) {
        if (payment[a].fiat)
          payment[a].fiat = (
            await getManager()
              .getCustomRepository(FiatRepository)
              .getFiat(payment[a].fiat)
          ).name;
        if (payment[a].asset)
          payment[a].asset = (
            await getManager()
              .getCustomRepository(AssetRepository)
              .getAsset(payment[a].asset)
          ).name;
      }
    }

    return payment;
  }

  async getPayment(id: any): Promise<any> {
    if (!isNaN(id.key)) {
      const payment = await this.findOne({ id: id.key });

      if (!payment)
        throw new NotFoundException('No matching payment for id found');

      if (payment.fiat)
        payment.fiat = await getManager()
          .getCustomRepository(FiatRepository)
          .getFiat(payment.fiat);
      if (payment.asset)
        payment.asset = await getManager()
          .getCustomRepository(AssetRepository)
          .getAsset(payment.asset);

      return payment;
    } else if (!isNaN(id)) {
      const payment = await this.findOne({ id: id });

      if (!payment)
        throw new NotFoundException('No matching payment for id found');

      if (payment.fiat)
        payment.fiat = await getManager()
          .getCustomRepository(FiatRepository)
          .getFiat(payment.fiat);
      if (payment.asset)
        payment.asset = await getManager()
          .getCustomRepository(AssetRepository)
          .getAsset(payment.asset);

      return payment;
    }
    throw new BadRequestException('id must be a number');
  }

  async getUnprocessedPayment(): Promise<any> {
    const payment = await this.find({ status: PaymentStatus.UNPROCESSED });

    if (payment) {
      for (let a = 0; a < payment.length; a++) {
        if (payment[a].fiat)
          payment[a].fiat = (
            await getManager()
              .getCustomRepository(FiatRepository)
              .getFiat(payment[a].fiat)
          ).name;
        if (payment[a].asset)
          payment[a].asset = (
            await getManager()
              .getCustomRepository(AssetRepository)
              .getAsset(payment[a].asset)
          ).name;
      }
    }

    return payment;
  }
}
