import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { KycInProgress, KycStatus, UserData } from 'src/user/models/user-data/user-data.entity';
import { KycDocument } from '../../services/spider/dto/spider.dto';
import { AccountType } from 'src/user/models/user-data/account-type.enum';
import { SpiderService } from 'src/user/services/spider/spider.service';
import { UserDataService } from '../user-data/user-data.service';
import { CountryService } from 'src/shared/models/country/country.service';
import { KycUserDataDto } from './dto/kyc-user-data.dto';
import { Util } from 'src/shared/util';
import { UserDataRepository } from '../user-data/user-data.repository';
import { SpiderSyncService } from 'src/user/services/spider/spider-sync.service';
import { KycProcessService } from './kyc-process.service';

export interface KycInfo {
  status: KycStatus;
  sessionUrl?: string;
  setupUrl?: string;
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

  async updateKycData(userId: number, data: KycUserDataDto): Promise<void> {
    const user = await this.userDataService.getUserDataByUser(userId);
    if (!user) throw new NotFoundException(`User data not found`);

    // check countries
    const [country, organizationCountry] = await Promise.all([
      this.countryService.getCountry(data.country.id),
      this.countryService.getCountry(data.organizationCountry?.id),
    ]);
    if (!country || (data.accountType !== AccountType.PERSONAL && !organizationCountry))
      throw new BadRequestException('Country not found');

    if (data.accountType === AccountType.PERSONAL) {
      data.organizationName = null;
      data.organizationStreet = null;
      data.organizationHouseNumber = null;
      data.organizationLocation = null;
      data.organizationZip = null;
      data.organizationCountry = null;
    }

    await this.userDataRepo.save({ ...user, ...data });
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
      user.accountType === AccountType.PERSONAL
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

  async uploadDocument(userId: number, document: Express.Multer.File, kycDocument: KycDocument): Promise<boolean> {
    const userData = await this.userDataService.getUserDataByUser(userId);
    if (!userData) throw new NotFoundException(`User data not found`);

    // create customer, if not existing
    await this.spiderService.createCustomer(userData.id, userData.surname);

    const version = new Date().getTime().toString();
    return await this.spiderService.uploadDocument(
      userData.id,
      false,
      kycDocument,
      version,
      document.originalname,
      document.mimetype,
      document.buffer,
    );
  }

  // --- KYC PROCESS --- //
  async requestKyc(userId: number): Promise<string> {
    let user = await this.userDataService.getUserDataByUser(userId);

    // check if KYC already started
    if (user.kycStatus !== KycStatus.NA) {
      throw new BadRequestException('KYC already in progress/completed');
    }

    // check if user data complete
    const dataComplete = await this.isDataComplete(user);
    if (!dataComplete) throw new BadRequestException('Ident data incomplete');

    // update
    user = await this.startKyc(user);
    await this.userDataRepo.save(user);

    return user.kycHash;
  }

  private async startKyc(userData: UserData): Promise<UserData> {
    // update customer
    await this.spiderService.initializeCustomer(userData);

    // generate KYC hash
    userData.kycHash = Util.createHash(userData.id.toString() + new Date().getDate()).slice(0, 12);
    if ((await this.userDataRepo.findOne({ kycHash: userData.kycHash })) != null)
      throw new InternalServerErrorException(`KYC hash ${userData.kycHash} already exists`);

    // do name check
    userData.riskState = await this.spiderService.checkCustomer(userData.id);

    // start KYC
    return await this.kycProcess.startKycProcess(userData);
  }

  async getKycStatus(kycHash: string): Promise<KycInfo> {
    let userData = await this.userDataRepo.findOne({ where: { kycHash }, relations: ['spiderData'] });
    if (!userData) throw new NotFoundException('User not found');

    if (!KycInProgress(userData.kycStatus)) throw new BadRequestException('KYC not in progress');

    // update
    userData = await this.kycProcess.checkKycProcess(userData);
    await this.userDataRepo.save(userData);

    const hasSecondUrl = Boolean(userData.spiderData?.secondUrl);
    return {
      status: userData.kycStatus,
      sessionUrl: hasSecondUrl ? userData.spiderData?.secondUrl : userData.spiderData?.url,
      setupUrl: hasSecondUrl ? userData.spiderData?.url : undefined,
    };
  }
}
