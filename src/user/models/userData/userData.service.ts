import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { UpdateUserDataDto } from './dto/update-userData.dto';
import { UserDataRepository } from './userData.repository';
import { kycInProgress, KycState, KycStatus, UserData } from './userData.entity';
import { KycDocument } from 'src/user/services/kyc/dto/kyc.dto';
import { BankDataRepository } from 'src/user/models/bank-data/bank-data.repository';
import { UserRepository } from 'src/user/models/user/user.repository';
import { extractUserInfo, getUserInfo, User, UserInfo } from '../user/user.entity';
import { CountryService } from 'src/shared/models/country/country.service';
import { In, IsNull, Not } from 'typeorm';
import { AccountType } from './account-type.enum';
import { KycService, KycProgress } from 'src/user/services/kyc/kyc.service';
import { Util } from 'src/shared/util';

export interface KycResult {
  status: KycStatus;
  identUrl?: string;
  setupUrl?: string;
}

@Injectable()
export class UserDataService {
  constructor(
    private readonly userRepo: UserRepository,
    private readonly userDataRepo: UserDataRepository,
    private readonly bankDataRepo: BankDataRepository,
    private readonly countryService: CountryService,
    private readonly kycService: KycService,
  ) {
    this.createHashes().then();
  }

  // TODO: remove after successful creation
  private async createHashes(): Promise<void> {
    const users = await this.userDataRepo.find({
      where: { kycStatus: In([KycStatus.CHATBOT, KycStatus.ONLINE_ID, KycStatus.VIDEO_ID]), kycHash: IsNull() },
    });
    for (const user of users) {
      user.kycHash = Util.createHash(user.id.toString() + new Date().toISOString).slice(0, 12);
    }
    await this.userDataRepo.save(users);
  }

  async getUserData(name: string, location: string): Promise<UserData> {
    const bankData = await this.bankDataRepo.findOne({ where: { name, location }, relations: ['userData'] });
    if (!bankData) throw new NotFoundException(`No user data for name ${name} and location ${location}`);
    return bankData.userData;
  }

  async createUserData(user: User): Promise<UserData> {
    const userData = await this.userDataRepo.save({ users: [user] });
    return await this.updateUserInfo(userData, extractUserInfo(user));
  }

  async updateUserData(userDataId: number, updatedUser: UpdateUserDataDto): Promise<UserData> {
    let userData = await this.userDataRepo.findOne(userDataId);
    if (!userData) throw new NotFoundException('No user for id found');

    // update user info
    const userInfo = extractUserInfo({
      ...updatedUser,
      country: undefined,
      organizationCountry: undefined,
      language: undefined,
    });
    if (updatedUser.countryId) {
      userInfo.country = await this.countryService.getCountry(updatedUser.countryId);
      if (!userInfo.country) throw new NotFoundException('No country for ID found');
    }
    if (updatedUser.organizationCountryId) {
      userInfo.organizationCountry = await this.countryService.getCountry(updatedUser.organizationCountryId);
      if (!userInfo.organizationCountry) throw new NotFoundException('No country for ID found');
    }
    await this.updateUserInfo(userData, userInfo);

    // update the rest
    userData = await this.userDataRepo.findOne(userDataId);
    if (updatedUser.kycStatus && !updatedUser.kycState) {
      updatedUser.kycState = KycState.NA;
    }

    if (updatedUser.mainBankDataId) {
      const bankData = await this.bankDataRepo.findOne(updatedUser.mainBankDataId);
      if (!bankData) throw new NotFoundException(`No bank data for id ${updatedUser.mainBankDataId} found`);
      userData.mainBankData = bankData;
    }

    if (updatedUser.depositLimit) userData.depositLimit = updatedUser.depositLimit;
    if (updatedUser.kycStatus) userData.kycStatus = updatedUser.kycStatus;
    if (updatedUser.kycState) userData.kycState = updatedUser.kycState;
    if (updatedUser.isMigrated != null) userData.isMigrated = updatedUser.isMigrated;
    if (updatedUser.kycFileId) {
      const userWithSameFileId = await this.userDataRepo.findOne({
        where: { id: Not(userDataId), kycFileId: updatedUser.kycFileId },
      });
      if (userWithSameFileId) throw new ConflictException('A user with this KYC file ID already exists');
      userData.kycFileId = updatedUser.kycFileId;
    }

    return await this.userDataRepo.save(userData);
  }

  async updateUserInfo(user: UserData, info: UserInfo): Promise<UserData> {
    user = { ...user, ...info };

    if (user.accountType === AccountType.PERSONAL) {
      user.organizationName = null;
      user.organizationStreet = null;
      user.organizationHouseNumber = null;
      user.organizationLocation = null;
      user.organizationZip = null;
      user.organizationCountry = null;
    }

    return this.userDataRepo.save(user);
  }

  async verifyUser(user: UserData): Promise<{ result: boolean; errors: { [error: string]: string } }> {
    const requiredFields = [
      'mail',
      'firstname',
      'surname',
      'street',
      'houseNumber',
      'location',
      'zip',
      'country',
      'phone',
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
    const errors = requiredFields.filter((f) => !user[f]);

    return {
      result: errors.length === 0,
      errors: errors.reduce((prev, curr) => ({ ...prev, [curr]: 'missing' }), {}),
    };
  }

  async getAllUserData(): Promise<UserData[]> {
    return this.userDataRepo.getAllUserData();
  }

  async getUserDataForUser(userId: number): Promise<UserData> {
    return this.userDataRepo
      .createQueryBuilder('userData')
      .innerJoinAndSelect('userData.users', 'user')
      .where('user.id = :id', { id: userId })
      .getOne();
  }

  async doNameCheck(userDataId: number): Promise<string> {
    const userData = await this.userDataRepo.findOne({ where: { id: userDataId } });
    if (!userData) throw new NotFoundException(`No user data for id ${userDataId}`);

    userData.riskState = await this.kycService.checkCustomer(userData.id);
    if (!userData.riskState) throw new NotFoundException(`User with id ${userDataId} is not in spider`);

    await this.userDataRepo.save(userData);

    return userData.riskState;
  }

  async uploadDocument(userId: number, document: Express.Multer.File, kycDocument: KycDocument): Promise<boolean> {
    const userData = await this.getUserDataForUser(userId);
    if (!userData) throw new NotFoundException(`No user data for user id ${userId}`);

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
    // get user data
    const user = await this.userRepo.findOne({
      where: { id: userId },
      relations: ['userData', 'userData.country', 'userData.organizationCountry'],
    });
    let userData = user.userData;
    const userInfo = getUserInfo(user);

    // check if KYC already started
    if (userData.kycStatus !== KycStatus.NA) {
      throw new BadRequestException('KYC already in progress/completed');
    }

    // check if user data complete
    const verification = await this.verifyUser(userData);
    if (!verification.result) throw new BadRequestException('User data incomplete');

    // update
    userData = await this.startKyc(userData, userInfo);
    await this.userDataRepo.save(userData);

    return userData.kycHash;
  }

  private async startKyc(userData: UserData, userInfo: UserInfo): Promise<UserData> {
    // update customer
    await this.kycService.initializeCustomer(userData.id, userInfo);
    userData.kycHash = Util.createHash(userData.id.toString() + new Date().getDate).slice(0, 12);

    // do name check
    userData.riskState = await this.kycService.checkCustomer(userData.id);

    // start KYC
    return await this.kycService.goToStatus(userData, KycStatus.CHATBOT);
  }

  async getKycProgress(kycHash: string): Promise<KycResult> {
    let userData = await this.userDataRepo.findOne({ where: { kycHash }, relations: ['spiderData'] });
    if (!userData) throw new NotFoundException('Invalid KYC hash');

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

  async mergeUserData(masterId: number, slaveId: number): Promise<void> {
    const [master, slave] = await Promise.all([
      this.userDataRepo.findOne({ where: { id: masterId }, relations: ['users', 'bankDatas'] }),
      this.userDataRepo.findOne({ where: { id: slaveId }, relations: ['users', 'bankDatas'] }),
    ]);

    master.bankDatas = master.bankDatas.concat(slave.bankDatas);
    master.users = master.users.concat(slave.users);
    await this.userDataRepo.save(master);
  }
}
