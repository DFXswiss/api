import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  Blank,
  BlankType,
  KycCompleted,
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
import { LinkService } from '../link/link.service';
import { LinkAddressRepository } from '../link/link-address.repository';
import { LinkAddress } from '../link/link-address.entity';
import { UpdateKycStatusDto } from '../user-data/dto/update-kyc-status.dto';

export interface KycInfo {
  kycStatus: KycStatus;
  kycState: KycState;
  kycHash: string;
  kycDataComplete: boolean;
  accountType: AccountType;
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
    private readonly linkAddressRepo: LinkAddressRepository,
  ) {}

  // --- ADMIN/SUPPORT --- //
  async doNameCheck(userDataId: number): Promise<string> {
    const userData = await this.userDataRepo.findOne({ where: { id: userDataId } });
    if (!userData) throw new NotFoundException('User data not found');

    userData.riskState = await this.spiderService.checkCustomer(userData.id);
    if (!userData.riskState) throw new BadRequestException('User is not in Spider');

    await this.userDataRepo.save(userData);

    return userData.riskState;
  }

  async updateKycStatus(userDataId: number, dto: UpdateKycStatusDto): Promise<void> {
    let userData = await this.userDataRepo.findOne({ where: { id: userDataId } });
    if (!userData) throw new NotFoundException('User data not found');

    // update status
    if (dto.kycStatus) {
      if (!this.isKycChangeAllowed(userData.kycStatus, dto.kycStatus))
        throw new BadRequestException(`Invalid KYC status change ${userData.kycStatus} -> ${dto.kycStatus}`);

      userData = await this.kycProcess.goToStatus(userData, dto.kycStatus);
    }

    // update state
    if (dto.kycState) userData = this.kycProcess.updateKycState(userData, dto.kycState);

    await this.userDataRepo.save(userData);
  }

  private isKycChangeAllowed(from: KycStatus, to: KycStatus): boolean {
    const allowedChanges = { [KycStatus.ONLINE_ID]: [KycStatus.VIDEO_ID] };
    return allowedChanges[from]?.includes(to);
  }

  // --- KYC DATA --- //
  async resyncKycData(userId: number): Promise<void> {
    await this.spiderSyncService.syncKycUser(userId, true);
  }

  async updateKycData(code: string, data: KycUserDataDto, userId?: number): Promise<KycInfo> {
    let user = await this.getUser(code, userId);
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

    user = await this.userDataService.updateSpiderIfNeeded(user, data);

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

    const users = await this.userDataService.getUsersByInformation(user);
    if (users) {
      const completedUser = users.find((data) => KycCompleted(data.kycStatus));
      const shouldSendLinkEmail = users.length > 1;
      if (shouldSendLinkEmail && completedUser) {
        const oldestToNewestUser = completedUser.users.sort((a, b) => (a.created > b.created ? 1 : -1));
        const existingAddress = oldestToNewestUser[0].address;
        const newAddress = user.users[0].address;

        const linkAddress = await this.linkAddressRepo.save(LinkAddress.create(existingAddress, newAddress));

        await this.mailService.sendTranslatedMail({
          userData: user,
          translationKey: 'mail.link.address',
          params: {
            firstname: completedUser.firstname,
            surname: completedUser.surname,
            organizationName: completedUser.organizationName ?? '',
            existingAddress: Blank(existingAddress, BlankType.WALLET_ADDRESS),
            newAddress: Blank(newAddress, BlankType.WALLET_ADDRESS),
            url: this.buildLinkUrl(linkAddress.authentication),
          },
        });
        throw new ConflictException('User already has completed Kyc');
      }
    }

    // update
    user = await this.startKyc(user);
    await this.userDataRepo.save(user);

    return this.createKycInfoBasedOn(user);
  }

  private buildLinkUrl(authentication: string): string {
    return `${Config.payment.url}/link?authentication=${authentication}`;
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
      accountType: userData.accountType,
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
