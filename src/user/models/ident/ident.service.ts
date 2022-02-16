import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Util } from 'src/shared/util';
import { getUserInfo, UserInfo } from 'src/user/models/user/user.entity';
import { UserRepository } from 'src/user/models/user/user.repository';
import { kycInProgress, KycState, KycStatus, UserData } from 'src/user/models/userData/userData.entity';
import { KycDocument } from 'src/user/services/kyc/dto/kyc.dto';
import { KycService, KycProgress } from 'src/user/services/kyc/kyc.service';
import { UserDataRepository } from '../userData/userData.repository';
import { KycResult, UserDataService } from '../userData/userData.service';

@Injectable()
export class IdentService {
  constructor(
    private readonly userRepo: UserRepository,
    private readonly userDataRepo: UserDataRepository,
    private readonly userDataService: UserDataService,
    private readonly kycService: KycService,
  ) {}

  // --- NAME CHECK --- //
  async doNameCheck(userDataId: number): Promise<string> {
    const userData = await this.userDataRepo.findOne({ where: { id: userDataId } });
    if (!userData) throw new NotFoundException(`No user data for id ${userDataId}`);

    userData.riskState = await this.kycService.checkCustomer(userData.id);
    if (!userData.riskState) throw new NotFoundException(`User with id ${userDataId} is not in spider`);

    await this.userDataRepo.save(userData);

    return userData.riskState;
  }

  // --- KYC --- //
  async uploadDocument(userId: number, document: Express.Multer.File, kycDocument: KycDocument): Promise<boolean> {
    const userData = await this.userDataService.getUserDataForUser(userId);
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
    const verification = await this.userDataService.verifyUser(userData);
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
}
