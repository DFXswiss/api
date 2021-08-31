import {
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
import { UserRepository } from 'src/user/user.repository';
import { User, UserStatus } from 'src/user/user.entity';
import { UserDataNameCheck } from 'src/userData/userData.entity';

@EntityRepository(BuyPayment)
export class BuyPaymentRepository extends Repository<BuyPayment> {
  async createPayment(createPaymentDto: CreateBuyPaymentDto): Promise<any> {

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

    if(fiatObject){

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

    if (!createPaymentDto.errorCode) {
      countryObject = await getManager()
        .getCustomRepository(CountryRepository)
        .getCountry(createPaymentDto.country);

      createPaymentDto.country = countryObject;

      let currentUserData = await getManager()
        .getCustomRepository(UserDataRepository)
        .getUserData(createPaymentDto);

      createPaymentDto.country = countryObject.id;

      let currentUser: User = null;

      if (!currentUserData) {
        const createUserDataDto = new CreateUserDataDto();
        createUserDataDto.name = createPaymentDto.name;
        createUserDataDto.location = createPaymentDto.location;
        createUserDataDto.country = createPaymentDto.country;

        currentUserData = await getManager()
          .getCustomRepository(UserDataRepository)
          .createUserData(createUserDataDto);
      }

      if (buy) {

        currentUser = await buy.user;

        let userDataTemp = await currentUser.userData;

        if(!userDataTemp){
            currentUser.userData = currentUserData;
            await getManager()
                .getCustomRepository(UserRepository).save(currentUser)
        }
      }

      if(currentUser){

          let lastMonthDate = new Date(createPaymentDto.received);
          lastMonthDate.setDate(lastMonthDate.getDate() - 1);
          lastMonthDate.setDate(lastMonthDate.getDate() + 1);
          lastMonthDate.setMonth(lastMonthDate.getMonth() - 1);
          let lastMonthDateString = lastMonthDate.toISOString().split('T')[0];
          let lastDayDateString = lastMonthDate.toISOString();

          let sumBuyCHF = Number.parseFloat((await this.createQueryBuilder("buyPayment")
          .select("SUM(buyPayment.fiatInCHF)","sum")
          .innerJoin("buyPayment.buy", "buy")
          .innerJoin("buy.user", "user")
          .innerJoin("user.userData","userData")
          .where("userData.id = :id", { id: currentUserData.id })
          .andWhere("buyPayment.received > :lastMonthDate", {lastMonthDate: lastDayDateString})
          .getRawMany())[0].sum);

          let sum30BuyCHF = Number.parseFloat((await this.createQueryBuilder("buyPayment")
          .select("SUM(buyPayment.fiatInCHF)","sum")
          .innerJoin("buyPayment.buy", "buy")
          .innerJoin("buy.user", "user")
          .innerJoin("user.userData","userData")
          .where("userData.id = :id", { id: currentUserData.id })
          .andWhere("buyPayment.received > :lastMonthDate", {lastMonthDate: lastMonthDateString})
          .getRawMany())[0].sum);

          // let sumSellCHF = Number.parseFloat((await getRepository(SellPayment).createQueryBuilder("sellPayment")
          // .select("SUM(sellPayment.fiatInCHF)","sum")
          // .innerJoin("sellPayment.sell", "sell")
          // .innerJoin("sell.user", "user")
          // .innerJoin("user.userData","userData")
          // .where("userData.id = :id", { id: currentUserData.id })
          // .andWhere("sellPayment.received > :lastMonthDate", {lastMonthDate: lastMonthDateString})
          // .getRawMany())[0].sum);

          if(!sumBuyCHF) sumBuyCHF = 0;
          // if(!sumSellCHF) sumSellCHF = 0;

          // let sumCHF = sumBuyCHF + sumSellCHF + createPaymentDto.fiatInCHF;
          let sumCHF = sumBuyCHF + createPaymentDto.fiatInCHF;
          let sum30CHF = sum30BuyCHF + createPaymentDto.fiatInCHF;

        if(currentUser.status != UserStatus.KYC && sumCHF > 1000){

          // createPaymentDto.info = 'No KYC, last Month: ' + sumCHF + " CHF instead of max 1000 CHF";
          createPaymentDto.info = 'No KYC, last Day: ' + sumCHF + " CHF instead of max 1000 CHF";
          createPaymentDto.info += '; userDataId: ' + currentUserData.id;
          createPaymentDto.info += '; User Name: ' + createPaymentDto.name;
          createPaymentDto.info += '; User Location: ' + createPaymentDto.location;
          createPaymentDto.info += '; User Country: ' + createPaymentDto.country;
          createPaymentDto.errorCode = PaymentError.KYC;

        }else if(currentUser.status == UserStatus.KYC && sum30CHF > 50000){

          createPaymentDto.info = 'Check Account Flag, last Month: ' + sumCHF + " CHF";
          createPaymentDto.info += '; userDataId: ' + currentUserData.id;
          createPaymentDto.info += '; User Name: ' + createPaymentDto.name;
          createPaymentDto.info += '; User Location: ' + createPaymentDto.location;
          createPaymentDto.info += '; User Country: ' + createPaymentDto.country;
          createPaymentDto.errorCode = PaymentError.ACCOUNTCHECK;
        }
      }

      if(currentUserData.nameCheck == UserDataNameCheck.NA) {
        if(!createPaymentDto.errorCode) createPaymentDto.errorCode = PaymentError.NAMECHECK;
        if(!createPaymentDto.info){
          createPaymentDto.info += '; Name-Check missing!';
        }else{
          createPaymentDto.info = 'Name-Check missing!';
          createPaymentDto.info += '; User Name: ' + createPaymentDto.name;
          createPaymentDto.info += '; User Location: ' + createPaymentDto.location;
          createPaymentDto.info += '; User Country: ' + createPaymentDto.country;
        }
      }
    }

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

    if(createPaymentDto.asset){
      logDto.asset = createPaymentDto.asset;
    }

    if (createPaymentDto.info) {
      logDto.message = createPaymentDto.info;
    }

    await getManager().getCustomRepository(LogRepository).createLog(logDto);

    const payment = this.create(createPaymentDto);

    if (payment) {
      try{
        await this.save(payment);
      } catch (error) {
        throw new ConflictException(error.message);
      }
      if(payment.buy) delete payment.buy;
      if(payment["__buy__"]) delete payment["__buy__"];

      payment.fiat = fiatObject;
      if(buy) payment.asset = buy.asset;
    }
    return payment;
  }

  async updatePayment(payment: UpdatePaymentDto): Promise<any> {
    const currentPayment = await this.findOne({ id: payment.id });

    if (!currentPayment) throw new NotFoundException('No matching payment for id found');
    if(currentPayment.status == PaymentStatus.PROCESSED) throw new ForbiddenException('Payment is already processed!')
    if(payment.status != PaymentStatus.PROCESSED && payment.status != PaymentStatus.REPAYMENT && payment.status != PaymentStatus.CANCELED) throw new ForbiddenException('Payment-status must be \"Processed\"')

    currentPayment.status = payment.status;

    if(payment.status == PaymentStatus.PROCESSED){

      try{

        let baseUrl =
            'https://api.coingecko.com/api/v3/coins/defichain/market_chart?vs_currency=chf&days=1';

        const options = {
          uri: baseUrl,
        };

        const result = await requestPromise.get(options);

        let resultArray = result.split("prices\":[[")[1].split("]],")[0].split(",[");

        let sumPrice = 0;

        for(let a = 0; a < resultArray.length; a++) {
          sumPrice += Number.parseFloat(resultArray[a].split(",")[1]);
        }

        const currentDfiPrice = sumPrice/resultArray.length;

        const volumeInDFI = currentPayment.fiatInCHF / currentDfiPrice;

        const logDto: CreateLogDto = new CreateLogDto();
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

          logDto.user = currentUser;
          //logDto.address = currentUser.address;
          logDto.message = currentUser.usedRef;

          currentUser.status = UserStatus.ACTIVE;

          await getManager()
          .getCustomRepository(UserRepository).save(currentUser)

        }

        await getManager().getCustomRepository(LogRepository).createLog(logDto);

      } catch (error) {
        throw new ConflictException(error.message);
      }
    }

    await this.save(currentPayment);

    return currentPayment;
  }

  async getAllPayment(): Promise<any> {
    return await this.find();
  }

  async getPayment(id: any): Promise<any> {
    if (!isNaN(id.key)) {
      const payment = await this.findOne({ id: id.key });

      if (!payment)
        throw new NotFoundException('No matching payment for id found');

      return payment;
    } else if (!isNaN(id)) {
      const payment = await this.findOne({ id: id });

      if (!payment)
        throw new NotFoundException('No matching payment for id found');

      return payment;
    }
    throw new BadRequestException('id must be a number');
  }

  async getUnprocessedPayment(): Promise<any> {
    return await this.find({ status: PaymentStatus.UNPROCESSED });
  }
}
