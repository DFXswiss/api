import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  Blank,
  BlankType,
  KycInProgress,
  KycState,
  KycStatus,
  UserData,
} from 'src/user/models/user-data/user-data.entity';
import { KycDocument } from '../../services/spider/dto/spider.dto';
import { AccountType } from 'src/user/models/user-data/account-type.enum';
import { SpiderService } from 'src/user/services/spider/spider.service';
import { UserDataService } from '../user-data/user-data.service';
import { CountryService } from 'src/shared/models/country/country.service';
import { KycUserDataDto } from './dto/kyc-user-data.dto';
import { UserDataRepository } from '../user-data/user-data.repository';
import { SpiderSyncService } from 'src/user/services/spider/spider-sync.service';
import { KycProcessService } from './kyc-process.service';
import { MailService } from 'src/shared/services/mail.service';
import { Config } from 'src/config/config';

export interface KycInfo {
  kycStatus: KycStatus;
  kycState: KycState;
  kycHash: string;
  kycDataComplete: boolean;
  depositLimit: number;
  sessionUrl?: string;
  setupUrl?: string;
  blankedPhone?: string;
  blankedMail?: string;
}

@Injectable()
export class KycService {
  constructor(
    private readonly userDataService: UserDataService,
    private readonly userDataRepo: UserDataRepository,
    private readonly spiderService: SpiderService,
    private readonly spiderSyncService: SpiderSyncService,
    private readonly countryService: CountryService,
    private readonly kycProcess: KycProcessService,
    private readonly mailService: MailService,
  ) {}

  // --- NAME CHECK --- //
  async doNameCheck(userDataId: number): Promise<string> {
    const userData = await this.userDataRepo.findOne({ where: { id: userDataId } });
    if (!userData) throw new NotFoundException('User data not found');

    userData.riskState = await this.spiderService.checkCustomer(userData.id);
    if (!userData.riskState) throw new BadRequestException('User is not in Spider');

    await this.userDataRepo.save(userData);

    return userData.riskState;
  }

  // --- KYC DATA --- //
  async resyncKycData(userId: number): Promise<void> {
    await this.spiderSyncService.syncKycUser(userId, true);
  }

  async updateKycData(code: string, data: KycUserDataDto, userId?: number): Promise<KycInfo> {
    const user = await this.getUser(code, userId);
    const isPersonalAccount = (data.accountType ?? user.accountType) === AccountType.PERSONAL;

    // check countries
    const [country, organizationCountry] = await Promise.all([
      this.countryService.getCountry(data.country?.id ?? user.country?.id),
      this.countryService.getCountry(data.organizationCountry?.id ?? user.organizationCountry?.id),
    ]);
    if (!country || (!isPersonalAccount && !organizationCountry)) throw new BadRequestException('Country not found');

    if (isPersonalAccount) {
      data.organizationName = null;
      data.organizationStreet = null;
      data.organizationHouseNumber = null;
      data.organizationLocation = null;
      data.organizationZip = null;
      data.organizationCountry = null;
    }

    await this.userDataService.updateSpiderIfNeeded(user, data);

    const updatedUser = await this.userDataRepo.save({ ...user, ...data });

    return this.createKycInfoBasedOn(updatedUser);
  }

  async userDataComplete(userId: number): Promise<boolean> {
    const user = await this.userDataService.getUserDataByUser(userId);
    return this.isDataComplete(user);
  }

  isDataComplete(user: UserData): boolean {
    const requiredFields = [
      'mail',
      'phone',
      'firstname',
      'surname',
      'street',
      'houseNumber',
      'location',
      'zip',
      'country',
    ].concat(
      user?.accountType === AccountType.PERSONAL
        ? []
        : [
            'organizationName',
            'organizationStreet',
            'organizationHouseNumber',
            'organizationLocation',
            'organizationZip',
            'organizationCountry',
          ],
    );
    return requiredFields.filter((f) => !user[f]).length === 0;
  }

  async uploadDocument(
    code: string,
    document: Express.Multer.File,
    kycDocument: KycDocument,
    userId?: number,
  ): Promise<boolean> {
    const userData = await this.getUser(code, userId);

    // create customer, if not existing
    await this.spiderService.createCustomer(userData.id, userData.surname);

    return await this.spiderService.uploadDocument(
      userData.id,
      false,
      kycDocument,
      document.originalname,
      document.mimetype,
      document.buffer,
    );
  }

  // --- KYC PROCESS --- //
  async requestKyc(code: string, userId?: number): Promise<KycInfo> {
    let user = await this.getUser(code, userId);

    // check if KYC already started
    if (user.kycStatus !== KycStatus.NA) {
      throw new BadRequestException('KYC already in progress/completed');
    }

    // check if user data complete
    const dataComplete = this.isDataComplete(user);
    if (!dataComplete) throw new BadRequestException('Ident data incomplete');

    const [users, numberOfUsersWithSameInformation] = await this.userDataService.getUsersByInformation(user);
    if (users) {
      const completedUser = users.find((data) => data.kycStatus === KycStatus.COMPLETED);
      const shouldSendLinkEmail = numberOfUsersWithSameInformation > 1;
      if (shouldSendLinkEmail && completedUser) {
        // this is not correct, where do we know. Which address is the correct one, if there are already linked addresses?
        const existingAddress = completedUser.users[0].address;
        // this should be fine, as a new user_data should have only one address
        const newAddress = user.users[0].address;
        await this.mailService.sendTranslatedMail({
          userData: user,
          translationKey: 'mail.link.address',
          params: {
            firstname: completedUser.firstname,
            surname: completedUser.surname,
            organizationName: completedUser.organizationName ?? '',
            existingAddress,
            newAddress,
            url: this.buildLinkUrl(existingAddress, newAddress),
          },
        });
        throw new ConflictException();
      }
    }

    // update
    user = await this.startKyc(user);
    await this.userDataRepo.save(user);

    return this.createKycInfoBasedOn(user);
  }

  private buildLinkUrl(existingAddress: string, newAddress: string): string {
    return `${Config.payment.url}/link?existing=${encodeURIComponent(existingAddress)}&new=${encodeURIComponent(
      newAddress,
    )}`;
  }

  private async startKyc(userData: UserData): Promise<UserData> {
    // update customer
    await this.spiderService.initializeCustomer(userData);

    // do name check
    userData.riskState = await this.spiderService.checkCustomer(userData.id);

    // start KYC
    return await this.kycProcess.startKycProcess(userData);
  }

  async getKycStatus(code: string): Promise<KycInfo> {
    let userData = await this.getUserByKycCode(code);

    if (KycInProgress(userData.kycStatus)) {
      // update
      userData = await this.kycProcess.checkKycProcess(userData);
      await this.userDataRepo.save(userData);
    }

    return this.createKycInfoBasedOn(userData);
  }

  // --- CREATE KYC INFO --- //

  private createKycInfoBasedOn(userData: UserData): KycInfo {
    const hasSecondUrl = Boolean(userData.spiderData?.secondUrl);
    return {
      kycStatus: userData.kycStatus,
      kycState: userData.kycState,
      kycHash: userData.kycHash,
      kycDataComplete: this.isDataComplete(userData),
      depositLimit: userData.depositLimit,
      blankedPhone: Blank(userData.phone, BlankType.PHONE),
      blankedMail: Blank(userData.mail, BlankType.MAIL),
      sessionUrl: hasSecondUrl ? userData.spiderData?.secondUrl : userData.spiderData?.url,
      setupUrl: hasSecondUrl ? userData.spiderData?.url : undefined,
    };
  }

  // --- GET USER --- //

  private async getUser(code: string, userId?: number): Promise<UserData> {
    return userId ? await this.getUserById(userId) : await this.getUserByKycCode(code);
  }

  private async getUserById(id: number): Promise<UserData> {
    const userData = await this.userDataService.getUserDataByUser(id);
    if (!userData) throw new NotFoundException('User not found');
    return userData;
  }

  private async getUserByKycCode(code: string): Promise<UserData> {
    const userData = await this.userDataRepo.findOne({ where: { kycHash: code }, relations: ['users', 'spiderData'] });
    if (!userData) throw new NotFoundException('User not found');
    return userData;
  }
}
