import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { UpdateUserDataDto } from './dto/update-userData.dto';
import { UserDataRepository } from './userData.repository';
import { KycState, KycStatus, UserData } from './userData.entity';
import { KycContentType, KycDocument, KycDocumentState } from 'src/user/services/kyc/dto/kyc.dto';
import { BankDataRepository } from 'src/user/models/bank-data/bank-data.repository';
import { UserRepository } from 'src/user/models/user/user.repository';
import { MailService } from 'src/shared/services/mail.service';
import { KycApiService } from 'src/user/services/kyc/kyc-api.service';
import { extractUserInfo, getUserInfo, User, UserInfo } from '../user/user.entity';
import { CountryService } from 'src/shared/models/country/country.service';
import { Not } from 'typeorm';
import { AccountType } from './account-type.enum';
import { KycService } from 'src/user/services/kyc/kyc.service';

export interface UserDataChecks {
  userDataId: string;
  customerId?: string;
  kycFileReference?: string;
  nameCheckRisk: string;
  activationDate: Date;
  kycStatus: KycStatus;
}

@Injectable()
export class UserDataService {
  constructor(
    private readonly userRepo: UserRepository,
    private readonly userDataRepo: UserDataRepository,
    private readonly bankDataRepo: BankDataRepository,
    private readonly countryService: CountryService,
    private readonly mailService: MailService,
    private readonly kycApi: KycApiService,
    private readonly kycService: KycService,
  ) {}

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

    const customer = await this.kycApi.getCustomer(userData.id);
    if (!customer) throw new NotFoundException(`User with id ${userDataId} is not in spider`);

    userData.riskState = await this.kycApi.checkCustomer(userData.id);
    await this.userDataRepo.save(userData);

    return userData.riskState;
  }

  async uploadDocument(userId: number, document: Express.Multer.File, kycDocument: KycDocument): Promise<boolean> {
    const userData = await this.getUserDataForUser(userId);
    if (!userData) throw new NotFoundException(`No user data for user id ${userId}`);

    const customer = await this.kycApi.getCustomer(userData.id);
    if (!customer) throw new NotFoundException(`User with id ${userData.id} is not in spider`);

    const version = new Date().getTime().toString();
    return await this.kycService.uploadDocument(
      userData.id,
      false,
      kycDocument,
      version,
      'content',
      document.originalname,
      document.mimetype as KycContentType,
      document.buffer,
    );
  }

  async requestKyc(userId: number, depositLimit?: string): Promise<string | undefined> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      relations: ['userData', 'userData.country', 'userData.organizationCountry', 'userData.spiderData'],
    });
    const userData = user.userData;
    const userInfo = getUserInfo(user);
    const verification = await this.verifyUser(userData);
    if (!verification.result) throw new BadRequestException('User data incomplete');

    if (userData?.kycStatus === KycStatus.NA) {
      if (userInfo.accountType === AccountType.PERSONAL) {
        await this.kycApi.updatePersonalCustomer(userData.id, userInfo);
      } else {
        await this.kycApi.updateOrganizationCustomer(userData.id, userInfo);
      }

      userData.riskState = await this.kycApi.checkCustomer(userData.id);

      const chatBotResult = await this.kycApi.getDocument(
        userData.id,
        KycDocument.INITIAL_CUSTOMER_INFORMATION,
        'v1',
        'content',
      );
      if (!chatBotResult) await this.kycService.preFillChatbot(userData, userInfo);

      return this.kycService.initiateIdentification(userData, false, KycDocument.INITIATE_CHATBOT_IDENTIFICATION);
    } else if ([KycStatus.CHATBOT, KycStatus.VIDEO_ID, KycStatus.ONLINE_ID].includes(userData?.kycStatus)) {
      if (userData?.kycStatus === KycStatus.CHATBOT) {
        const documentVersions = await this.kycApi.getDocumentVersions(userData.id, KycDocument.CHATBOT);
        const isCompleted = documentVersions.find((doc) => doc.state === KycDocumentState.COMPLETED) != null;

        if (isCompleted) {
          const userDataChatBot = await this.kycService.finishChatBot(userData);
          return userDataChatBot?.spiderData?.url;
        }
      }
      const documentType =
        userData?.kycStatus === KycStatus.CHATBOT
          ? KycDocument.INITIATE_CHATBOT_IDENTIFICATION
          : userData?.kycStatus === KycStatus.ONLINE_ID
          ? KycDocument.INITIATE_ONLINE_IDENTIFICATION
          : KycDocument.INITIATE_VIDEO_IDENTIFICATION;

      return userData.kycState === KycState.FAILED
        ? this.kycService.initiateIdentification(userData, false, documentType)
        : userData.spiderData.url;
    } else if (userData?.kycStatus === KycStatus.COMPLETED || userData?.kycStatus === KycStatus.MANUAL) {
      const customer = await this.kycApi.getCustomer(userData.id);
      // send mail to support
      await this.mailService.sendLimitSupportMail(userData, customer.id, depositLimit);
      return;
    }

    throw new BadRequestException('Invalid KYC status');
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
