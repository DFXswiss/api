import { NotFoundException, BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { EntityRepository, Repository } from 'typeorm';
import { CreateBuyPaymentDto } from './dto/create-buy-payment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { BuyPayment } from './payment-buy.entity';
import { FiatRepository } from 'src/fiat/fiat.repository';
import { getManager } from 'typeorm';
import { AssetRepository } from 'src/asset/asset.repository';
import { BuyRepository } from 'src/buy/buy.repository';
import { PaymentStatus } from './payment.entity';
import { LogRepository } from 'src/log/log.repository';
import { CreateLogDto } from 'src/log/dto/create-log.dto';
import { LogDirection, LogStatus, LogType } from 'src/log/log.entity';
import { UserDataRepository } from 'src/userData/userData.repository';
import { CountryRepository } from 'src/country/country.repository';
import * as requestPromise from 'request-promise-native';
import { UserRepository } from 'src/user/user.repository';
import { UserStatus } from 'src/user/user.entity';
import { NameCheckStatus } from 'src/userData/userData.entity';
import { MailService } from 'src/mail/mail.service';
import { KycService } from 'src/services/kyc.service';

@EntityRepository(BuyPayment)
export class BuyPaymentRepository extends Repository<BuyPayment> {
  // async createPayment(
  //   createPaymentDto: CreateBuyPaymentDto,
  //   mailService?: MailService,
  //   kycService?: KycService,
  // ): Promise<any> {
  //   const fiatRepo = getManager().getCustomRepository(FiatRepository);
  //   const buyRepo = getManager().getCustomRepository(BuyRepository);
  //   const userRepo = getManager().getCustomRepository(UserRepository);
  //   const userDataRepo = getManager().getCustomRepository(UserDataRepository);
  //   const countryRepo = getManager().getCustomRepository(CountryRepository);
  //   const logRepo = getManager().getCustomRepository(LogRepository);

  //   // find all relations
  //   const [fiat, originFiat, buy, country] = await Promise.all([
  //     fiatRepo.findOne({ name: createPaymentDto.fiat }),
  //     fiatRepo.findOne({ name: createPaymentDto.originFiat }),
  //     buyRepo.getBuyByBankUsage(createPaymentDto.bankUsage),
  //     countryRepo.findOne({ symbol: createPaymentDto.country }),
  //   ]);

  //   if (!fiat) {
  //     throw new NotFoundException(`Fiat ${createPaymentDto.fiat} not found`);
  //   }
  //   if (!originFiat) {
  //     throw new NotFoundException(`Origin fiat ${createPaymentDto.originFiat} not found`);
  //   }
  //   if (!buy) {
  //     throw new NotFoundException(`No route found for bank usage ${createPaymentDto.bankUsage}`);
  //   }
  //   if (!country) {
  //     throw new NotFoundException(`Country ${createPaymentDto.country} not found`);
  //   }

  //   // amount in CHF
  //   const fiatInChf = await this.getInChf(
  //     createPaymentDto.fiatValue,
  //     fiat.name.toLowerCase(),
  //     new Date(createPaymentDto.received),
  //   );

  //   // handle user data
  //   let userData = await userDataRepo.getUserData({
  //     name: createPaymentDto.name,
  //     location: createPaymentDto.location,
  //   });
  //   const user = await buy.user;
  //   const referencedUserData = await user.userData;

  //   if (!referencedUserData) {
  //     if (!userData) {
  //       userData = await userDataRepo.create({
  //         name: createPaymentDto.name,
  //         location: createPaymentDto.location,
  //         country: country,
  //       });
  //       await userDataRepo.save(userData);

  //       userData.nameCheck =
  //         !process.env.ENABLE_NAME_CHECK || (await kycService.doNameCheck(userData.id, userData.name))
  //           ? NameCheckStatus.SAFE
  //           : NameCheckStatus.WARNING;

  //       await userDataRepo.save(userData);
  //     }

  //     user.userData = userData;
  //     await userRepo.save(user);
  //   }

  //   // create payment
  //   // TODO: use fiatString as DTO member to improve this!
  //   const payment = await this.create({
  //     iban: createPaymentDto.iban,
  //     bankTransactionId: createPaymentDto.bankTransactionId,
  //     address: buy.address,
  //     fiat: fiat,
  //     fiatValue: createPaymentDto.fiatValue,
  //     originFiat: originFiat,
  //     originFiatValue: createPaymentDto.originFiatValue,
  //     fiatInCHF: fiatInChf,
  //     btcValue: createPaymentDto.btcValue,
  //     buy: buy,
  //     asset: buy.asset,
  //     status: createPaymentDto.status,
  //     received: new Date(createPaymentDto.received),
  //     accepted: createPaymentDto.accepted,
  //     info: createPaymentDto.info,
  //     errorCode: createPaymentDto.errorCode,
  //   });

  //   try {
  //     await this.save(payment);
  //   } catch (e) {
  //     throw new ConflictException(e.message);
  //   }

  //   // TODO: creates entries in payment table
  //   // // create a log entry
  //   // const logDto: any = {
  //   //   // TODO: CreateLogDto
  //   //   status: LogStatus.fiatDeposit,
  //   //   fiat: fiat,
  //   //   fiatValue: payment.fiatValue,
  //   //   direction: LogDirection.fiat2asset,
  //   //   type: LogType.TRANSACTION,
  //   //   address: payment.address,
  //   //   fiatInCHF: fiatInChf,
  //   //   user: user,
  //   //   asset: payment.asset,
  //   //   message: payment.info,
  //   //   payment: payment,
  //   // };
  //   // await logRepo.createLog(logDto, mailService);

  //   return payment;
  // }

  // async updatePayment(payment: UpdatePaymentDto, mailService?: MailService): Promise<any> {
  //   const currentPayment = await this.findOne({ id: payment.id });

  //   if (!currentPayment) throw new NotFoundException('No matching payment for id found');
  //   if (currentPayment.status == PaymentStatus.PROCESSED) throw new ForbiddenException('Payment is already processed!');
  //   if (!currentPayment.accepted && payment.status == PaymentStatus.PROCESSED)
  //     throw new ForbiddenException('Payment is not accepted yet!');

  //   let processedPayment = false;

  //   currentPayment.status = payment.status;
  //   currentPayment.accepted = payment.accepted;

  //   const logDto: CreateLogDto = new CreateLogDto();

  //   if (payment.status) {
  //     // if (
  //     //   payment.status == PaymentStatus.PROCESSED &&
  //     //   currentPayment.errorCode == PaymentError.NA
  //     // ) {
  //     processedPayment = true;

  //     try {
  //       let baseUrl = 'https://api.coingecko.com/api/v3/coins/defichain/market_chart?vs_currency=chf&days=1';

  //       const options = {
  //         uri: baseUrl,
  //       };

  //       const result = await requestPromise.get(options);

  //       let resultArray = result.split('prices":[[')[1].split(']],')[0].split(',[');

  //       let sumPrice = 0;

  //       for (let a = 0; a < resultArray.length; a++) {
  //         sumPrice += Number.parseFloat(resultArray[a].split(',')[1]);
  //       }

  //       const currentDfiPrice = sumPrice / resultArray.length;

  //       const volumeInDFI = currentPayment.fiatInCHF / currentDfiPrice;

  //       logDto.fiatValue = currentPayment.fiatValue;
  //       logDto.fiat = currentPayment.fiat;
  //       logDto.assetValue = volumeInDFI;
  //       logDto.asset = await getManager().getCustomRepository(AssetRepository).getAsset('DFI');
  //       logDto.direction = LogDirection.fiat2asset;
  //       logDto.type = LogType.VOLUME;
  //       logDto.fiatInCHF = currentPayment.fiatInCHF;

  //       if (currentPayment.buy) {
  //         const currentBuy = await currentPayment.buy;

  //         let currentUser = await currentBuy.user;

  //         let currentUserData = await currentUser.userData;

  //         if (!currentUserData)
  //           throw new ForbiddenException('You cannot process a payment without a referenced userData');

  //         logDto.user = currentUser;

  //         if (currentUser.usedRef != '000-000') {
  //           const refUser = await getManager()
  //             .getCustomRepository(UserRepository)
  //             .findOne({ ref: currentUser.usedRef });

  //           let refUserData = null;

  //           refUserData = await refUser.userData;
  //           if (refUserData && currentUserData) {
  //             if (refUserData.id == currentUserData.id) currentUser.usedRef = '000-000';
  //           }
  //         }

  //         //logDto.address = currentUser.address;
  //         logDto.message = currentUser.usedRef;

  //         currentUser.status = UserStatus.ACTIVE;

  //         await getManager().getCustomRepository(UserRepository).save(currentUser);
  //       } else {
  //         throw new ForbiddenException('You cannot process a payment without a referenced Buy-Route');
  //       }
  //     } catch (error) {
  //       throw new ConflictException(error.message);
  //     }
  //     // } else if (
  //     //   payment.status == PaymentStatus.PROCESSED &&
  //     //   currentPayment.errorCode != PaymentError.NA
  //     // ) {
  //     //   throw new ForbiddenException(
  //     //     'You cannot process a payment with an error',
  //     //   );
  //     // }
  //   }

  //   try {
  //     await this.save(currentPayment);

  //     logDto.payment = currentPayment;
  //   } catch (error) {
  //     throw new ConflictException(error.message);
  //   }

  //   if (processedPayment) await getManager().getCustomRepository(LogRepository).createLog(logDto, mailService);

  //   return currentPayment;
  // }

  async getAllPayment(): Promise<any> {
    const payments = await this.find();

    for (let a = 0; a < payments.length; a++) {
      let buy = await payments[a].buy;
      if(buy){
        let user = await buy.user;
        if(user) await user.userData;
      }
    }

    return payments;
  }

  // async getPayment(id: any): Promise<any> {
  //   if (id.key) {
  //     if (!isNaN(id.key)) {
  //       const payment = await this.findOne({ id: id.key });

  //       if (!payment) throw new NotFoundException('No matching payment for id found');

  //       return payment;
  //     }
  //   } else if (!isNaN(id)) {
  //     const payment = await this.findOne({ id: id });

  //     if (!payment) throw new NotFoundException('No matching payment for id found');

  //     return payment;
  //   }
  //   throw new BadRequestException('id must be a number');
  // }

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

  // async getUnprocessedPayment(): Promise<any> {
  //   const payments = await this.find({ status: PaymentStatus.UNPROCESSED });

  //   for (let a = 0; a < payments.length; a++) {
  //     let buy = null;
  //     let user = null;

  //     if(payments[a].buy) {
  //       buy = await payments[a].buy;
  //       if(buy) { 
  //         user = await buy.user;
  //         if(user) await user.userData;
  //       }
  //     }
  //   }

  //   return payments;
  // }

  // async getUnprocessedAcceptedPayment(): Promise<any> {
  //   const payments = await this.find({
  //     status: PaymentStatus.UNPROCESSED,
  //     accepted: true,
  //   });

  //   for (let a = 0; a < payments.length; a++) {

  //     let buy = null;
  //     let user = null;

  //     if(payments[a].buy) {
  //       buy = await payments[a].buy;
  //       if(buy) { 
  //         user = await buy.user;
  //         if(user) await user.userData;
  //       }
  //     }
  //   }

  //   return payments;
  // }

  // private async getInChf(amount: number, currency: string, date: Date): Promise<number> {
  //   const baseUrl = 'https://cdn.jsdelivr.net/gh/fawazahmed0/currency-api@1';
  //   const url = this.isToday(date)
  //     ? `${baseUrl}/latest/currencies/${currency}/chf.json`
  //     : `${baseUrl}/${date.toISOString().split('T')[0]}/currencies/${currency}/chf.json`;

  //   const result = await requestPromise.get({ uri: url });
  //   return amount * JSON.parse(result).chf;
  // }

  // private isToday(date: Date): boolean {
  //   const today = new Date();
  //   return (
  //     date.getUTCDate() == today.getUTCDate() &&
  //     date.getUTCMonth() == today.getUTCMonth() &&
  //     date.getUTCFullYear() == today.getUTCFullYear()
  //   );
  // }
}
