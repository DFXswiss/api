import {
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Brackets, EntityRepository, Repository } from 'typeorm';
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
import { UserRepository } from 'src/user/user.repository';
import { User, UserStatus } from 'src/user/user.entity';
import { UserDataNameCheck } from 'src/userData/userData.entity';
import { MailService } from 'src/mail/mail.service';
import { KycService } from 'src/services/kyc.service';

@EntityRepository(BuyPayment)
export class BuyPaymentRepository extends Repository<BuyPayment> {
  async createPayment(
    createPaymentDto: CreateBuyPaymentDto,
    mailService?: MailService,
    kycService?: KycService,
  ): Promise<any> {
    let fiatObject = null;
    let originFiatObject = null;
    let countryObject = null;
    let buy: Buy = null;

    try {
      fiatObject = await getManager()
        .getCustomRepository(FiatRepository)
        .getFiat(createPaymentDto.fiat);

      createPaymentDto.fiat = fiatObject.id;

      originFiatObject = await getManager()
        .getCustomRepository(FiatRepository)
        .getFiat(createPaymentDto.originFiat);

      createPaymentDto.originFiat = originFiatObject.id;
    } catch {
      createPaymentDto.info = 'Wrong Fiat: ' + createPaymentDto.fiat;
      createPaymentDto.fiat = null;
      createPaymentDto.errorCode = PaymentError.FIAT;
    }

    // convert amount to CHF
    if(fiatObject){
      createPaymentDto.fiatInCHF = await this.getInChf(
        createPaymentDto.fiatValue,
        fiatObject.name.toLowerCase(),
        new Date(createPaymentDto.received),
      );
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

      if (buy.asset.buyable) {
        createPaymentDto.asset = buy.asset;
      } else {
        createPaymentDto.info = 'Asset not buyable: ' + createPaymentDto.asset;
        createPaymentDto.errorCode = PaymentError.ASSET;
      }
    } else {
      createPaymentDto.info = '';

      const currentPayment = await this.find({
        iban: createPaymentDto.iban,
        errorCode: PaymentError.NA,
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

      createPaymentDto.info +=
        '; Wrong BankUsage: ' + createPaymentDto.bankUsage;
      createPaymentDto.asset = null;
      createPaymentDto.errorCode = PaymentError.BANKUSAGE;
    }

    let currentUserData = await getManager()
      .getCustomRepository(UserDataRepository)
      .getUserData(createPaymentDto);

    let currentUser: User = null;
    let savedUser = null;

    if (buy) {
      currentUser = await buy.user;

      let userDataTemp = await currentUser.userData;

      savedUser = currentUser;

      if (!currentUserData && !userDataTemp) {
        const createUserDataDto = new CreateUserDataDto();
        createUserDataDto.name = createPaymentDto.name;
        createUserDataDto.location = createPaymentDto.location;

        //TODO name check

        if (createPaymentDto.country) {
          createUserDataDto.country = createPaymentDto.country;
        }

        createUserDataDto.nameCheck = kycService.doNameCheck(
          createPaymentDto.address,
          createPaymentDto.name,
        )
          ? UserDataNameCheck.SAFE
          : UserDataNameCheck.WARNING;

        currentUserData = await getManager()
          .getCustomRepository(UserDataRepository)
          .createUserData(createUserDataDto);

        currentUser.userData = currentUserData;
        savedUser = await getManager()
          .getCustomRepository(UserRepository)
          .save(currentUser);
      }else if(currentUserData && !userDataTemp){

        currentUser.userData = currentUserData;
        savedUser = await getManager()
          .getCustomRepository(UserRepository)
          .save(currentUser);

      }else if(!currentUserData && userDataTemp){
        createPaymentDto.errorCode = PaymentError.USERDATA;
        createPaymentDto.info = 'Referenced userData: ' + userDataTemp.name + ', ' + userDataTemp.location + '; new current userData: ' + createPaymentDto.name + ', ' + createPaymentDto.location;
      }else if(currentUserData && userDataTemp){
        if(currentUserData.id != userDataTemp.id){
          createPaymentDto.errorCode = PaymentError.USERDATA;
          createPaymentDto.info = 'Referenced userData: ' + userDataTemp.name + ', ' + userDataTemp.location + '; current userData: ' + createPaymentDto.name + ', ' + createPaymentDto.location;
        }
      }

    }

    // Get county-Object
    if (createPaymentDto.country) {
      countryObject = await getManager()
        .getCustomRepository(CountryRepository)
        .getCountry(createPaymentDto.country);

      createPaymentDto.country = countryObject.id;
    }

    if (currentUser) {
      // KYC-Check
      if (!savedUser['__userData__'])
        throw new ForbiddenException('Error! No refereced userData');

      let lastMonthDate = new Date(createPaymentDto.received);
      let lastDayDate = new Date(createPaymentDto.received);
      lastDayDate.setDate(lastDayDate.getDate() - 1);
      lastMonthDate.setDate(lastMonthDate.getDate() + 1);
      lastMonthDate.setMonth(lastMonthDate.getMonth() - 1);
      let lastMonthDateString = lastMonthDate.toISOString().split('T')[0];
      let lastDayDateString = lastDayDate.toISOString().split('T')[0];
      let receivedDateString = new Date(createPaymentDto.received)
        .toISOString()
        .split('T')[0];

      let sumBuyCHF = Number.parseFloat(
        (
          await this.createQueryBuilder('buyPayment')
            .select('SUM(buyPayment.fiatInCHF)', 'sum')
            .innerJoin('buyPayment.buy', 'buy')
            .innerJoin('buy.user', 'user')
            .innerJoin('user.userData', 'userData')
            .where('userData.id = :id', { id: currentUserData.id })
            .andWhere('buyPayment.received > :lastDayDate', {
              lastDayDate: lastDayDateString,
            })
            .andWhere('buyPayment.received <= :receivedDate', {
              receivedDate: receivedDateString,
            })
            .andWhere(
              new Brackets((qb) => {
                qb.where('buyPayment.status = :unprocessed', {
                  unprocessed: PaymentStatus.UNPROCESSED,
                }).orWhere('buyPayment.status = :processed', {
                  processed: PaymentStatus.PROCESSED,
                });
              }),
            )
            .getRawMany()
        )[0].sum,
      );

      let sum30BuyCHF = Number.parseFloat(
        (
          await this.createQueryBuilder('buyPayment')
            .select('SUM(buyPayment.fiatInCHF)', 'sum')
            .innerJoin('buyPayment.buy', 'buy')
            .innerJoin('buy.user', 'user')
            .innerJoin('user.userData', 'userData')
            .where('userData.id = :id', { id: currentUserData.id })
            .andWhere('buyPayment.received > :lastMonthDate', {
              lastMonthDate: lastMonthDateString,
            })
            .andWhere('buyPayment.received <= :receivedDate', {
              receivedDate: receivedDateString,
            })
            .andWhere(
              new Brackets((qb) => {
                qb.where('buyPayment.status = :unprocessed', {
                  unprocessed: PaymentStatus.UNPROCESSED,
                }).orWhere('buyPayment.status = :processed', {
                  processed: PaymentStatus.PROCESSED,
                });
              }),
            )
            .getRawMany()
        )[0].sum,
      );

      // let sumSellCHF = Number.parseFloat((await getRepository(SellPayment).createQueryBuilder("sellPayment")
      // .select("SUM(sellPayment.fiatInCHF)","sum")
      // .innerJoin("sellPayment.sell", "sell")
      // .innerJoin("sell.user", "user")
      // .innerJoin("user.userData","userData")
      // .where("userData.id = :id", { id: currentUserData.id })
      // .andWhere("sellPayment.received > :lastMonthDate", {lastMonthDate: lastMonthDateString})
      // .getRawMany())[0].sum);

      if (!sumBuyCHF) sumBuyCHF = 0;
      // if(!sumSellCHF) sumSellCHF = 0;

      // let sumCHF = sumBuyCHF + sumSellCHF + createPaymentDto.fiatInCHF;
      let sumCHF = sumBuyCHF + createPaymentDto.fiatInCHF;
      let sum30CHF = sum30BuyCHF + createPaymentDto.fiatInCHF;

      if (currentUser.status != UserStatus.KYC && sumCHF > 1000) {
        // createPaymentDto.info = 'No KYC, last Month: ' + sumCHF + " CHF instead of max 1000 CHF";
        createPaymentDto.info =
          'No KYC, last Day: ' + sumCHF + ' CHF instead of max 1000 CHF';
        createPaymentDto.info += '; userDataId: ' + currentUserData.id;
        createPaymentDto.info += '; User Name: ' + createPaymentDto.name;
        createPaymentDto.info +=
          '; User Location: ' + createPaymentDto.location;
        if (createPaymentDto.country) {
          createPaymentDto.info +=
            '; User Country: ' + createPaymentDto.country;
        }
        createPaymentDto.errorCode = PaymentError.KYC;
      } else if (currentUser.status == UserStatus.KYC && sum30CHF > 50000) {
        createPaymentDto.info =
          'Check Account Flag, last Month: ' + sumCHF + ' CHF';
        createPaymentDto.info += '; userDataId: ' + currentUserData.id;
        createPaymentDto.info += '; User Name: ' + createPaymentDto.name;
        createPaymentDto.info +=
          '; User Location: ' + createPaymentDto.location;
        if (createPaymentDto.country) {
          createPaymentDto.info +=
            '; User Country: ' + createPaymentDto.country;
        }
        createPaymentDto.errorCode = PaymentError.ACCOUNTCHECK;
      }
    }

    if (currentUserData.nameCheck == UserDataNameCheck.NA) {
      createPaymentDto.errorCode = PaymentError.NAMECHECK;
      if (!createPaymentDto.info) {
        createPaymentDto.info += '; Name-Check missing!';
      } else {
        createPaymentDto.info = 'Name-Check missing!';
        createPaymentDto.info += '; User Name: ' + createPaymentDto.name;
        createPaymentDto.info +=
          '; User Location: ' + createPaymentDto.location;
        if (createPaymentDto.country) {
          createPaymentDto.info +=
            '; User Country: ' + createPaymentDto.country;
        }
      }
    }

    if (currentUserData.nameCheck != UserDataNameCheck.SAFE) {
      createPaymentDto.errorCode = PaymentError.NAMECHECK;
      if (!createPaymentDto.info) {
        createPaymentDto.info += '; Name-Check: ' + currentUserData.nameCheck;
      } else {
        createPaymentDto.info = 'Name-Check: ' + currentUserData.nameCheck;
        createPaymentDto.info += '; User Name: ' + createPaymentDto.name;
        createPaymentDto.info +=
          '; User Location: ' + createPaymentDto.location;
        if (createPaymentDto.country) {
          createPaymentDto.info +=
            '; User Country: ' + createPaymentDto.country;
        }
      }
    }

    const payment = this.create(createPaymentDto);

    if (payment) {
      const logDto: CreateLogDto = new CreateLogDto();
      logDto.status = LogStatus.fiatDeposit;
      if (fiatObject) logDto.fiat = fiatObject.id;
      logDto.fiatValue = createPaymentDto.fiatValue;
      // logDto.iban = createPaymentDto.iban;
      logDto.direction = LogDirection.fiat2asset;
      logDto.type = LogType.TRANSACTION;
      logDto.address = createPaymentDto.address;
      logDto.fiatInCHF = createPaymentDto.fiatInCHF;

      if (buy) {
        logDto.user = await buy.user;
      }

      if (createPaymentDto.asset) {
        logDto.asset = createPaymentDto.asset;
      }

      if (createPaymentDto.info) {
        logDto.message = createPaymentDto.info;
      }

      try {
        await this.save(payment);

        logDto.payment = payment;
      } catch (error) {
        throw new ConflictException(error.message);
      }

      await getManager()
        .getCustomRepository(LogRepository)
        .createLog(logDto, mailService);

      if (payment.buy) delete payment.buy;
      if (payment['__buy__']) delete payment['__buy__'];
      if (payment['__logs__']) delete payment['__logs__'];
      if (payment['__has_logs__']) delete payment['__has_logs__'];

      payment.fiat = fiatObject;
      payment.originFiat = originFiatObject;
      if (buy) payment.asset = buy.asset;
    }
    return payment;
  }

  async updatePayment(
    payment: UpdatePaymentDto,
    mailService?: MailService,
  ): Promise<any> {
    const currentPayment = await this.findOne({ id: payment.id });

    if (!currentPayment)
      throw new NotFoundException('No matching payment for id found');
    if (currentPayment.status == PaymentStatus.PROCESSED)
      throw new ForbiddenException('Payment is already processed!');
    if (!currentPayment.accepted && payment.status == PaymentStatus.PROCESSED)
      throw new ForbiddenException('Payment is not accepted yet!');

    let processedPayment = false;

    currentPayment.status = payment.status;
    currentPayment.accepted = payment.accepted;

    const logDto: CreateLogDto = new CreateLogDto();

    if (payment.status) {
      // if (
      //   payment.status == PaymentStatus.PROCESSED &&
      //   currentPayment.errorCode == PaymentError.NA
      // ) {
      processedPayment = true;

      try {
        let baseUrl =
          'https://api.coingecko.com/api/v3/coins/defichain/market_chart?vs_currency=chf&days=1';

        const options = {
          uri: baseUrl,
        };

        const result = await requestPromise.get(options);

        let resultArray = result
          .split('prices":[[')[1]
          .split(']],')[0]
          .split(',[');

        let sumPrice = 0;

        for (let a = 0; a < resultArray.length; a++) {
          sumPrice += Number.parseFloat(resultArray[a].split(',')[1]);
        }

        const currentDfiPrice = sumPrice / resultArray.length;

        const volumeInDFI = currentPayment.fiatInCHF / currentDfiPrice;

        logDto.fiatValue = currentPayment.fiatValue;
        logDto.fiat = currentPayment.fiat;
        logDto.assetValue = volumeInDFI;
        logDto.asset = await getManager()
          .getCustomRepository(AssetRepository)
          .getAsset('DFI');
        logDto.direction = LogDirection.fiat2asset;
        logDto.type = LogType.VOLUME;
        logDto.fiatInCHF = currentPayment.fiatInCHF;

        if (currentPayment.buy) {
          const currentBuy = await currentPayment.buy;

          let currentUser = await currentBuy.user;

          let currentUserData = await currentUser.userData;

          if (!currentUserData)
            throw new ForbiddenException(
              'You cannot process a payment without a referenced userData',
            );

          logDto.user = currentUser;

          if (currentUser.usedRef != '000-000') {
            const refUser = await getManager()
              .getCustomRepository(UserRepository)
              .findOne({ ref: currentUser.usedRef });

            let refUserData = null;

            refUserData = await refUser.userData;
            if (refUserData && currentUserData) {
              if (refUserData.id == currentUserData.id)
                currentUser.usedRef = '000-000';
            }
          }

          //logDto.address = currentUser.address;
          logDto.message = currentUser.usedRef;

          currentUser.status = UserStatus.ACTIVE;

          await getManager()
            .getCustomRepository(UserRepository)
            .save(currentUser);
        } else {
          throw new ForbiddenException(
            'You cannot process a payment without a referenced Buy-Route',
          );
        }
      } catch (error) {
        throw new ConflictException(error.message);
      }
      // } else if (
      //   payment.status == PaymentStatus.PROCESSED &&
      //   currentPayment.errorCode != PaymentError.NA
      // ) {
      //   throw new ForbiddenException(
      //     'You cannot process a payment with an error',
      //   );
      // }
    }

    try {
      await this.save(currentPayment);

      logDto.payment = currentPayment;
    } catch (error) {
      throw new ConflictException(error.message);
    }

    if (processedPayment)
      await getManager()
        .getCustomRepository(LogRepository)
        .createLog(logDto, mailService);

    return currentPayment;
  }

  async getAllPayment(): Promise<any> {
    const payments = await this.find();

    for (let a = 0; a < payments.length; a++) {
      let buy = await payments[a].buy;
      let user = await buy.user;
      await user.userData;
    }

    return payments;
  }

  async getPayment(id: any): Promise<any> {
    if (id.key) {
      if (!isNaN(id.key)) {
        const payment = await this.findOne({ id: id.key });

        if (!payment)
          throw new NotFoundException('No matching payment for id found');

        return payment;
      }
    } else if (!isNaN(id)) {
      const payment = await this.findOne({ id: id });

      if (!payment)
        throw new NotFoundException('No matching payment for id found');

      return payment;
    }
    throw new BadRequestException('id must be a number');
  }

  async getPaymentInternal(id: any): Promise<any> {
    if (id.id) {
      if (!isNaN(id.id)) {
        const payment = await this.findOne({ id: id.id });

        return payment;
      }
    } else if (!isNaN(id)) {
      const payment = await this.findOne({ id: id });

      return payment;
    }
    throw new BadRequestException('id must be a number');
  }

  async getUnprocessedPayment(): Promise<any> {
    const payments = await this.find({ status: PaymentStatus.UNPROCESSED });

    for (let a = 0; a < payments.length; a++) {
      let buy = await payments[a].buy;
      let user = await buy.user;
      await user.userData;
    }

    return payments;
  }

  async getUnprocessedAcceptedPayment(): Promise<any> {
    const payments = await this.find({
      status: PaymentStatus.UNPROCESSED,
      accepted: true,
    });

    for (let a = 0; a < payments.length; a++) {
      let buy = await payments[a].buy;
      let user = await buy.user;
      await user.userData;
    }

    return payments;
  }

  private async getInChf(amount: number, currency: string, date: Date): Promise<number> {
    const baseUrl = 'https://cdn.jsdelivr.net/gh/fawazahmed0/currency-api@1';
    const url = this.isToday(date)
      ? `${baseUrl}/latest/currencies/${currency}/chf.json`
      : `${baseUrl}/${date.toISOString().split('T')[0]}/currencies/${currency}/chf.json`;

    const result = await requestPromise.get({ uri: url });
    return amount * JSON.parse(result).chf;
  }

  private isToday(date: Date): boolean {
    const today = new Date();
    return (
      date.getUTCDate() == today.getUTCDate() &&
      date.getUTCMonth() == today.getUTCMonth() &&
      date.getUTCFullYear() == today.getUTCFullYear()
    );
  }
  
}
