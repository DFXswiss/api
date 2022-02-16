import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CountryService } from 'src/shared/models/country/country.service';
import { Util } from 'src/shared/util';
import { kycInProgress, KycState, KycStatus, UserData } from 'src/user/models/userData/userData.entity';
import { KycDocument } from 'src/user/services/kyc/dto/kyc.dto';
import { KycService, KycProgress } from 'src/user/services/kyc/kyc.service';
import { AccountType } from '../userData/account-type.enum';
import { UserDataRepository } from '../userData/userData.repository';
import { UserDataService } from '../userData/userData.service';
import { IdentUserDataDto } from './dto/ident-user-data.dto';

export interface KycResult {
  status: KycStatus;
  identUrl?: string;
  setupUrl?: string;
}

@Injectable()
export class IdentService {
  constructor(
    private readonly userDataRepo: UserDataRepository,
    private readonly userDataService: UserDataService,
    private readonly kycService: KycService,
    private readonly countryService: CountryService,
  ) {}

  // --- NAME CHECK --- //
  async doNameCheck(userDataId: number): Promise<string> {
    const userData = await this.userDataRepo.findOne({ where: { id: userDataId } });
    if (!userData) throw new NotFoundException('User data not found');

    userData.riskState = await this.kycService.checkCustomer(userData.id);
    if (!userData.riskState) throw new BadRequestException('User is not in Spider');

    await this.userDataRepo.save(userData);

    return userData.riskState;
  }

  // --- KYC --- //
  async updateIdentData(userId: number, data: IdentUserDataDto): Promise<void> {
    const user = await this.userDataService.getUserDataForUser(userId);
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

  async dataComplete(userId: number): Promise<boolean> {
    const user = await this.userDataService.getUserDataForUser(userId);
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
    const userData = await this.userDataService.getUserDataForUser(userId);
    if (!userData) throw new NotFoundException(`User data not found`);

    // create customer, if not existing
    await this.kycService.createCustomer(userData.id, userData.surname);

    const version = new Date().getTime().toString();
    return await this.kycService.uploadDocument(
      userData.id,
      false,
      kycDocument,
      version,
      document.originalname,
      document.mimetype,
      document.buffer,
    );
  }

  async requestKyc(userId: number): Promise<string> {
    let user = await this.userDataService.getUserDataForUser(userId);

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
    await this.kycService.initializeCustomer(userData);
    userData.kycHash = Util.createHash(userData.id.toString() + new Date().getDate).slice(0, 12);

    // do name check
    userData.riskState = await this.kycService.checkCustomer(userData.id);

    // start KYC
    return await this.kycService.goToStatus(userData, KycStatus.CHATBOT);
  }

  async getKycProgress(kycHash: string): Promise<KycResult> {
    let userData = await this.userDataRepo.findOne({ where: { kycHash }, relations: ['spiderData'] });
    if (!userData) throw new NotFoundException('User not found');

    if (!kycInProgress(userData.kycStatus)) throw new BadRequestException('KYC not in progress');

    // update
    userData = await this.checkKycProgress(userData);
    await this.userDataRepo.save(userData);

    const hasSecondUrl = Boolean(userData.spiderData?.secondUrl);
    return {
      status: userData.kycStatus,
      identUrl: hasSecondUrl ? userData.spiderData?.secondUrl : userData.spiderData?.url,
      setupUrl: hasSecondUrl ? userData.spiderData?.url : undefined,
    };
  }

  private async checkKycProgress(userData: UserData): Promise<UserData> {
    // check if chatbot already finished
    if (userData.kycStatus === KycStatus.CHATBOT) {
      const chatbotProgress = await this.kycService.getKycProgress(userData.id, userData.kycStatus);
      if (chatbotProgress === KycProgress.COMPLETED) {
        return await this.kycService.chatbotCompleted(userData);
      }
    }

    // retrigger, if failed
    if (userData.kycState === KycState.FAILED) {
      return await this.kycService.goToStatus(userData, userData.kycStatus);
    }

    return userData;
  }
}
