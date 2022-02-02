import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { UpdateUserDataDto } from './dto/update-userData.dto';
import { UserDataRepository } from './userData.repository';
import { KycState, KycStatus, RiskState, UserData } from './userData.entity';
import { Customer, KycContentType, KycDocument, State } from 'src/user/services/kyc/dto/kyc.dto';
import { BankDataRepository } from 'src/user/models/bank-data/bank-data.repository';
import { UserRepository } from 'src/user/models/user/user.repository';
import { MailService } from 'src/shared/services/mail.service';
import { KycApiService } from 'src/user/services/kyc/kyc-api.service';
import { extractUserInfo, getUserInfo, User, UserInfo } from '../user/user.entity';
import { CountryService } from 'src/shared/models/country/country.service';
import { Not } from 'typeorm';
import { AccountType } from './account-type.enum';
import { SpiderDataRepository } from '../spider-data/spider-data.repository';
import { UserRole } from 'src/shared/auth/user-role.enum';

export interface UserDataChecks {
  userDataId: string;
  customerId?: string;
  kycFileReference?: string;
  nameCheckRisk: string;
  activationDate: Date;
  kycStatus: KycStatus;
}

export interface CustomerDataDetailed {
  customer: Customer;
  checkResult: RiskState;
}

@Injectable()
export class UserDataService {
  constructor(
    private readonly userRepo: UserRepository,
    private readonly userDataRepo: UserDataRepository,
    private readonly spiderDataRepo: SpiderDataRepository,
    private readonly bankDataRepo: BankDataRepository,
    private readonly countryService: CountryService,
    private readonly mailService: MailService,
    private readonly kycApi: KycApiService,
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

  async getKycData(userDataId: number): Promise<CustomerDataDetailed> {
    const customer = await this.kycApi.getCustomer(userDataId);
    if (!customer) return null;

    const checkResult = await this.kycApi.getCheckResult(userDataId);

    return { customer: customer, checkResult: checkResult };
  }

  async getKycStatus(userId: number): Promise<KycStatus> {
    return this.userDataRepo
      .createQueryBuilder('userData')
      .innerJoinAndSelect('userData.users', 'user')
      .where('user.id = :id', { id: userId })
      .getOne()
      .then((user) => user.kycStatus);
  }

  async doNameCheck(userDataId: number): Promise<string> {
    const userData = await this.userDataRepo.findOne({ where: { id: userDataId } });
    if (!userData) throw new NotFoundException(`No user data for id ${userDataId}`);
    const kycData = await this.kycApi.getCustomer(userData.id);
    if (!kycData) throw new NotFoundException(`User with id ${userDataId} is not in spider`);
    userData.riskState = await this.kycApi.doCheckResult(userData.id);
    await this.userDataRepo.save(userData);

    return userData.riskState;
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
        await this.kycApi.updateCustomer(userData.id, userInfo);
      } else {
        await this.kycApi.submitContractLinkedList(userData.id, userInfo);
      }

      userData.riskState = await this.kycApi.doCheckResult(userData.id);

      const chatBotResult = await this.kycApi.downloadCustomerDocumentVersionParts(
        userData.id,
        KycDocument.INITIAL_CUSTOMER_INFORMATION,
        'v1',
        'content',
      );
      if (!chatBotResult) await this.preFillChatbot(userData, userInfo);

      return this.initiateIdentification(userData, false, KycDocument.INITIATE_CHATBOT_IDENTIFICATION);
    } else if (
      [KycStatus.WAIT_CHAT_BOT, KycStatus.WAIT_VIDEO_ID, KycStatus.WAIT_ONLINE_ID].includes(userData?.kycStatus)
    ) {
      if (userData?.kycStatus === KycStatus.WAIT_CHAT_BOT) {
        const documentVersions = await this.kycApi.getDocumentVersion(userData.id, KycDocument.CHATBOT);
        const isCompleted = documentVersions.find((doc) => doc.state === State.COMPLETED) != null;

        if (isCompleted) {
          const userDataChatBot = await this.finishChatBot(userData);
          return userDataChatBot?.spiderData?.url;
        }
      }
      const documentType =
        userData?.kycStatus === KycStatus.WAIT_CHAT_BOT
          ? KycDocument.INITIATE_CHATBOT_IDENTIFICATION
          : userData?.kycStatus === KycStatus.WAIT_ONLINE_ID
          ? KycDocument.INITIATE_ONLINE_IDENTIFICATION
          : KycDocument.INITIATE_VIDEO_IDENTIFICATION;

      return userData.kycState === KycState.FAILED
        ? this.initiateIdentification(userData, false, documentType)
        : userData.spiderData.url;
    } else if (userData?.kycStatus === KycStatus.COMPLETED || userData?.kycStatus === KycStatus.WAIT_MANUAL) {
      const customer = await this.kycApi.getCustomer(userData.id);
      // send mail to support
      await this.mailService.sendLimitSupportMail(userData, customer.id, depositLimit);
      return;
    }

    throw new BadRequestException('Invalid KYC status');
  }

  public async initiateIdentification(userData: UserData, sendMail: boolean, identType: KycDocument): Promise<string> {
    // create/update spider data
    const initiateData = await this.kycApi.initiateIdentification(userData.id, sendMail, identType);
    const spiderData = userData.spiderData ?? this.spiderDataRepo.create({ userData: userData });
    spiderData.url =
      identType === KycDocument.INITIATE_CHATBOT_IDENTIFICATION
        ? initiateData.sessionUrl + '&nc=true'
        : initiateData.sessionUrl;
    spiderData.version = initiateData.locators[0].version;
    await this.spiderDataRepo.save(spiderData);

    // update user data
    userData.kycStatus =
      identType === KycDocument.INITIATE_VIDEO_IDENTIFICATION
        ? KycStatus.WAIT_VIDEO_ID
        : identType === KycDocument.INITIATE_ONLINE_IDENTIFICATION
        ? KycStatus.WAIT_ONLINE_ID
        : KycStatus.WAIT_CHAT_BOT;
    userData.kycState = KycState.NA;
    userData.spiderData = spiderData;
    await this.userDataRepo.save(userData);

    return spiderData.url;
  }

  private async preFillChatbot(userData: UserData, userInfo: UserInfo): Promise<void> {
    await this.kycApi.createDocumentVersion(userData.id, KycDocument.INITIAL_CUSTOMER_INFORMATION, 'v1', false);

    await this.kycApi.createDocumentVersionPart(
      userData.id,
      KycDocument.INITIAL_CUSTOMER_INFORMATION,
      'v1',
      'content',
      'initial-customer-information.json',
      KycContentType.JSON,
      false,
    );

    const additionalPersonInformation = {
      type: 'AdditionalPersonInformation',
      nickName: userInfo.firstname,
      onlyOwner: 'YES',
      businessActivity: {
        purposeBusinessRelationship: 'Kauf und Verkauf von DeFiChain Assets',
      },
    };

    const uploadInitialCustomerInformation = await this.kycApi.uploadDocument(
      userData.id,
      'v1',
      KycDocument.INITIAL_CUSTOMER_INFORMATION,
      'content',
      KycContentType.JSON,
      additionalPersonInformation,
      false,
    );

    if (uploadInitialCustomerInformation) {
      await this.kycApi.changeDocumentState(
        userData.id,
        'v1',
        KycDocument.INITIAL_CUSTOMER_INFORMATION,
        JSON.stringify(State.COMPLETED),
        false,
      );
    }

    if (userInfo.accountType !== AccountType.PERSONAL) {
      await this.kycApi.createDocumentVersion(userData.id, KycDocument.INITIAL_CUSTOMER_INFORMATION, 'v1', true);

      await this.kycApi.createDocumentVersionPart(
        userData.id,
        KycDocument.INITIAL_CUSTOMER_INFORMATION,
        'v1',
        'content',
        'initial-customer-information.json',
        KycContentType.JSON,
        true,
      );

      const organisationType =
        userInfo.accountType === AccountType.SOLE_PROPRIETORSHIP ? 'SOLE_PROPRIETORSHIP' : 'LEGAL_ENTITY';
      const type =
        userInfo.accountType === AccountType.SOLE_PROPRIETORSHIP
          ? 'AdditionalOrganisationInformation'
          : 'AdditionalLegalEntityInformation';
      const additionalOrganizationInformation = {
        type: type,
        organisationType: organisationType,
        purposeBusinessRelationship: 'Kauf und Verkauf von DeFiChain Assets',
      };

      const uploadInitialCustomerInformation = await this.kycApi.uploadDocument(
        userData.id,
        'v1',
        KycDocument.INITIAL_CUSTOMER_INFORMATION,
        'content',
        KycContentType.JSON,
        additionalOrganizationInformation,
        true,
      );

      if (uploadInitialCustomerInformation) {
        await this.kycApi.changeDocumentState(
          userData.id,
          'v1',
          KycDocument.INITIAL_CUSTOMER_INFORMATION,
          JSON.stringify(State.COMPLETED),
          true,
        );
      }
    }
  }

  public async finishChatBot(userData: UserData): Promise<UserData> {
    userData.riskState = await this.kycApi.doCheckResult(userData.id);
    const spiderData = await this.spiderDataRepo.findOne({ userData: { id: userData.id } });

    if (spiderData) {
      const chatBotResult = await this.kycApi.downloadCustomerDocumentVersionParts(
        userData.id,
        KycDocument.CHATBOT_ONBOARDING,
        spiderData.version,
        'export',
      );

      // store chatbot result
      spiderData.result = JSON.stringify(chatBotResult);
      await this.spiderDataRepo.save(spiderData);

      // update user data
      try {
        const formItems = JSON.parse(chatBotResult?.attributes?.form)?.items;
        userData.contributionAmount = formItems?.['global.contribution']?.value?.split(' ')[1];
        userData.contributionCurrency = formItems?.['global.contribution']?.value?.split(' ')[0];
        userData.plannedContribution = formItems?.['global.plannedDevelopmentOfAssets']?.value?.en;
      } catch (e) {
        const message = `Exception during KYC checks, failed to parse chatbot result for user ${userData.id} and version ${spiderData.version}:`;
        console.error(message, e);
        await this.mailService.sendErrorMail('KYC Error', [e]);
      }
    }
    await this.userDataRepo.save(userData);

    const vipUser = await this.userRepo.findOne({ where: { userData: { id: userData.id }, role: UserRole.VIP } });
    vipUser
      ? await this.initiateIdentification(userData, false, KycDocument.INITIATE_VIDEO_IDENTIFICATION)
      : await this.initiateIdentification(userData, false, KycDocument.INITIATE_ONLINE_IDENTIFICATION);
    userData.kycStatus = vipUser ? KycStatus.WAIT_VIDEO_ID : KycStatus.WAIT_ONLINE_ID;

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
