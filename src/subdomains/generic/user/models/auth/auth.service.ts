import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { CronExpression } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { CryptoService } from 'src/integration/blockchain/shared/services/crypto.service';
import { GeoLocationService } from 'src/integration/geolocation/geo-location.service';
import { SiftService } from 'src/integration/sift/services/sift.service';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { IpLogService } from 'src/shared/models/ip-log/ip-log.service';
import { LanguageService } from 'src/shared/models/language/language.service';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { AsyncCache, CacheItemResetPeriod } from 'src/shared/utils/async-cache';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { RefService } from 'src/subdomains/core/referral/process/ref.service';
import { KycStepName } from 'src/subdomains/generic/kyc/enums/kyc-step-name.enum';
import { KycAdminService } from 'src/subdomains/generic/kyc/services/kyc-admin.service';
import { MailContext, MailType } from 'src/subdomains/supporting/notification/enums';
import { MailKey, MailTranslationKey } from 'src/subdomains/supporting/notification/factories/mail.factory';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { FeeService } from 'src/subdomains/supporting/payment/services/fee.service';
import { CustodyProviderService } from '../custody-provider/custody-provider.service';
import { RecommendationService } from '../recommendation/recommendation.service';
import { UserData } from '../user-data/user-data.entity';
import { KycType, UserDataStatus } from '../user-data/user-data.enum';
import { UserDataService } from '../user-data/user-data.service';
import { LinkedUserInDto } from '../user/dto/linked-user.dto';
import { User } from '../user/user.entity';
import { UserRepository } from '../user/user.repository';
import { UserService } from '../user/user.service';
import { Wallet } from '../wallet/wallet.entity';
import { WalletService } from '../wallet/wallet.service';
import { SignInDto, SignUpDto } from './dto/auth-credentials.dto';
import { AuthMailDto } from './dto/auth-mail.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { ChallengeDto } from './dto/challenge.dto';
import { SignMessageDto } from './dto/sign-message.dto';
import { VerifySignMessageDto } from './dto/verify-sign-message.dto';

export interface ChallengeData {
  created: Date;
  challenge: string;
}

export interface MailKeyData {
  created: Date;
  key: string;
  mail: string;
  userDataId: number;
  loginUrl: string;
  redirectUri?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new DfxLogger(AuthService);

  private readonly challengeList = new Map<string, ChallengeData>();
  private readonly mailKeyList = new Map<string, MailKeyData>();
  private readonly userCache = new AsyncCache<User>(CacheItemResetPeriod.EVERY_10_SECONDS);

  constructor(
    private readonly userService: UserService,
    private readonly userRepo: UserRepository,
    private readonly walletService: WalletService,
    private readonly custodyProviderService: CustodyProviderService,
    private readonly jwtService: JwtService,
    private readonly cryptoService: CryptoService,
    private readonly refService: RefService,
    private readonly feeService: FeeService,
    private readonly userDataService: UserDataService,
    private readonly notificationService: NotificationService,
    private readonly ipLogService: IpLogService,
    private readonly siftService: SiftService,
    private readonly languageService: LanguageService,
    private readonly geoLocationService: GeoLocationService,
    private readonly settingService: SettingService,
    private readonly recommendationService: RecommendationService,
    private readonly kycAdminService: KycAdminService,
  ) {}

  @DfxCron(CronExpression.EVERY_MINUTE)
  checkLists() {
    for (const [key, challenge] of this.challengeList.entries()) {
      if (!this.isChallengeValid(challenge)) {
        this.challengeList.delete(key);
      }
    }

    for (const [key, entry] of this.mailKeyList.entries()) {
      if (!this.isMailKeyValid(entry)) {
        this.mailKeyList.delete(key);
      }
    }
  }

  // --- AUTH METHODS --- //
  async authenticate(dto: SignUpDto, userIp: string, userDataId?: number, userId?: number): Promise<AuthResponseDto> {
    const existingUser = await this.userCache.get(dto.address, () =>
      this.userService.getUserByAddress(dto.address, {
        userData: true,
        wallet: true,
        custodyProvider: true,
      }),
    );

    if (existingUser && userDataId && existingUser.userData.id !== userDataId)
      throw new ConflictException('Address already linked to another account');

    return existingUser
      ? this.doSignIn(existingUser, dto, userIp, false)
      : this.doSignUp(dto, userIp, false, userDataId, userId).catch((e) => {
          if (e.message?.includes('duplicate key')) return this.signIn(dto, userIp, false);
          throw e;
        });
  }

  async signUp(dto: SignUpDto, userIp: string, isCustodial = false): Promise<AuthResponseDto> {
    const existingUser = await this.userService.getUserByAddress(dto.address, { userData: true, wallet: true });
    if (existingUser) throw new ConflictException('User already exists');

    return this.doSignUp(dto, userIp, isCustodial);
  }

  private async doSignUp(
    dto: SignUpDto,
    userIp: string,
    isCustodial: boolean,
    userDataId?: number,
    userId?: number,
  ): Promise<AuthResponseDto> {
    const userData = userDataId && (await this.userDataService.getUserData(userDataId, { users: true }));
    const primaryUser = userId && (await this.userService.getUser(userId));

    const custodyProvider = await this.custodyProviderService.getWithMasterKey(dto.signature).catch(() => undefined);
    if (!custodyProvider && !(await this.verifySignature(dto.address, dto.signature, isCustodial, dto.key))) {
      throw new BadRequestException('Invalid signature');
    }

    const ref = await this.refService.get(userIp);
    if (ref) dto.usedRef ??= ref.ref;

    if (dto.key) dto.signature = [dto.signature, dto.key].join(';');

    const wallet = await this.walletService.getByIdOrName(dto.walletId, dto.wallet);
    const user = await this.userService.createUser(
      {
        ...dto,
        ip: userIp,
        origin: ref?.origin,
        wallet,
        custodyProvider,
        userData,
        primaryUser,
      },
      dto.specialCode ?? dto.discountCode,
      dto.moderator,
    );

    // update ip Logs
    await this.ipLogService.updateUserIpLogs(user);

    if (dto.recommendationCode) await this.confirmRecommendationCode(dto.recommendationCode, user.userData);

    if (!user.userData.tradeApprovalDate) await this.checkPendingRecommendation(user.userData, wallet);

    await this.checkIpBlacklistFor(user.userData, userIp);

    return { accessToken: this.generateUserToken(user, userIp) };
  }

  async signIn(dto: SignInDto, userIp: string, isCustodial = false): Promise<AuthResponseDto> {
    const isCompany = this.hasChallenge(dto.address);
    if (isCompany) return this.companySignIn(dto, userIp);

    const user = await this.userService.getUserByAddress(dto.address, {
      userData: { users: true },
      custodyProvider: true,
      wallet: true,
    });
    if (!user) throw new NotFoundException('User not found');

    if (user.userData.isDeactivated)
      user.userData = await this.userDataService.updateUserDataInternal(
        user.userData,
        user.userData.reactivateUserData(),
      );

    return this.doSignIn(user, dto, userIp, isCustodial);
  }

  private async doSignIn(user: User, dto: SignInDto, userIp: string, isCustodial: boolean) {
    if (!user.custodyProvider || user.custodyProvider.masterKey !== dto.signature) {
      if (!(await this.verifySignature(dto.address, dto.signature, isCustodial, dto.key, user.signature))) {
        throw new UnauthorizedException('Invalid credentials');
      } else if (!user.signature) {
        // TODO: temporary code to update empty signatures (remove?)
        await this.userRepo.update({ address: dto.address }, { signature: dto.signature });
      }
    }

    if (!user.userData.tradeApprovalDate) await this.checkPendingRecommendation(user.userData, user.wallet);

    try {
      if (dto.specialCode || dto.discountCode)
        await this.feeService.addSpecialCodeUser(user, dto.specialCode ?? dto.discountCode);
    } catch (e) {
      this.logger.warn(`Error while adding specialCode in user signIn ${user.id}:`, e);
    }

    if (dto.moderator || (dto.walletType && !user.walletType))
      await this.userService.updateUserInternal(user, { moderator: dto.moderator, walletType: dto.walletType });

    await this.checkIpBlacklistFor(user.userData, userIp);

    this.siftService.login(user, userIp);

    return { accessToken: this.generateUserToken(user, userIp) };
  }

  async signInByMail(dto: AuthMailDto, url: string, userIp: string): Promise<void> {
    if (dto.redirectUri && !Config.frontend.isRedirectUrlAllowed(dto.redirectUri))
      throw new BadRequestException('Redirect URL not allowed');

    const ipCountry = this.geoLocationService.getCountry(userIp);
    const language = await this.languageService.getLanguageByCountry(ipCountry);

    const userData =
      (await this.userDataService
        .getUsersByMail(dto.mail)
        .then((u) => Util.sort(u, 'id', 'DESC') && Util.maxObj(u, 'kycLevel'))) ??
      (await this.userDataService.createUserData({
        kycType: KycType.DFX,
        mail: dto.mail,
        language: dto.language ?? language,
        status: UserDataStatus.KYC_ONLY,
        wallet: await this.walletService.getDefault(),
      }));

    if (dto.recommendationCode) await this.confirmRecommendationCode(dto.recommendationCode, userData);

    await this.checkIpBlacklistFor(userData, userIp);

    // create random key
    const key = randomUUID();
    const loginUrl = `${Config.frontend.services}/mail-login?otp=${key}`;

    this.mailKeyList.set(key, {
      created: new Date(),
      key,
      mail: dto.mail,
      userDataId: userData.id,
      loginUrl: url,
      redirectUri: dto.redirectUri,
    });

    // send notification
    await this.notificationService.sendMail({
      type: MailType.USER_V2,
      context: MailContext.LOGIN,
      input: {
        userData,
        wallet: userData.wallet,
        title: `${MailTranslationKey.LOGIN}.title`,
        salutation: { key: `${MailTranslationKey.LOGIN}.salutation` },
        texts: [
          { key: MailKey.SPACE, params: { value: '1' } },
          {
            key: `${MailTranslationKey.GENERAL}.button`,
            params: { url: loginUrl, button: 'true' },
          },
          {
            key: `${MailTranslationKey.LOGIN}.message`,
            params: {
              url: loginUrl,
              urlText: loginUrl,
              expiration: `${Config.auth.mailLoginExpiresIn}`,
            },
          },
          { key: MailKey.SPACE, params: { value: '2' } },
          { key: MailKey.DFX_TEAM_CLOSING },
        ],
      },
    });
  }

  async completeSignInByMail(code: string, ip: string): Promise<string> {
    try {
      const entry = this.mailKeyList.get(code);
      if (!this.isMailKeyValid(entry)) throw new Error('Login link expired');

      const account = await this.userDataService.getUserData(entry.userDataId, { users: true });

      const ipLog = await this.ipLogService.create(ip, entry.loginUrl, entry.mail, undefined, account);
      if (!ipLog.result) throw new Error('The country of IP address is not allowed');

      const token = this.generateAccountToken(account, ip);

      await this.checkIpBlacklistFor(account, ip);

      if (account.isDeactivated)
        await this.userDataService.updateUserDataInternal(account, account.reactivateUserData());

      if (!account.tradeApprovalDate) await this.checkPendingRecommendation(account);

      const url = new URL(entry.redirectUri ?? `${Config.frontend.services}/account`);
      url.searchParams.set('session', token);
      return url.toString();
    } catch (e) {
      return `${Config.frontend.services}/error?msg=${encodeURIComponent(e.message)}`;
    }
  }

  private async companySignIn(dto: SignInDto, ip: string): Promise<AuthResponseDto> {
    const wallet = await this.walletService.getByAddress(dto.address);
    if (!wallet?.isKycClient) throw new NotFoundException('Wallet not found');

    if (!(await this.verifyCompanySignature(dto.address, dto.signature, dto.key)))
      throw new UnauthorizedException('Invalid credentials');

    return { accessToken: this.generateCompanyToken(wallet, ip) };
  }

  async getCompanyChallenge(address: string): Promise<ChallengeDto> {
    const wallet = await this.walletService.getByAddress(address);
    if (!wallet?.isKycClient) throw new BadRequestException('Wallet not found/invalid');

    const challenge = randomUUID();

    this.challengeList.set(address, { created: new Date(), challenge: challenge });

    return { challenge: challenge };
  }

  async changeUser(userDataId: number, changeUser: LinkedUserInDto, ip: string): Promise<AuthResponseDto> {
    const user = await this.getLinkedUser(userDataId, changeUser.address);
    if (!user) throw new NotFoundException('User not found');
    if (user.isBlockedOrDeleted || user.userData.isBlockedOrDeactivated)
      throw new BadRequestException('User is deactivated or blocked');

    if (!user.userData.tradeApprovalDate) await this.checkPendingRecommendation(user.userData, user.wallet);

    return { accessToken: this.generateUserToken(user, ip) };
  }

  // --- SIGN MESSAGES --- //

  getSignInfo(address: string): SignMessageDto {
    return {
      message: this.getSignMessages(address).defaultMessage,
      blockchains: CryptoService.getBlockchainsBasedOn(address),
    };
  }

  private getSignMessages(address: string): { defaultMessage: string; fallbackMessage: string } {
    return {
      defaultMessage: Config.auth.signMessageGeneral + address,
      fallbackMessage: Config.auth.signMessage + address,
    };
  }

  // --- VERIFY SIGN MESSAGES --- //

  async verifyMessageSignature(address: string, message: string, signature: string): Promise<VerifySignMessageDto> {
    const custodyProvider = await this.custodyProviderService.getWithMasterKey(signature);

    const isValid = custodyProvider ? true : await this.cryptoService.verifySignature(message, address, signature);

    return { isValid };
  }

  // --- HELPER METHODS --- //

  private async checkPendingRecommendation(userData: UserData, userWallet?: Wallet): Promise<void> {
    if (userData.wallet?.autoTradeApproval || userWallet?.autoTradeApproval)
      await this.userDataService.updateUserDataInternal(userData, { tradeApprovalDate: new Date() });

    await this.recommendationService.checkAndConfirmRecommendInvitation(userData.id);
  }

  private async confirmRecommendationCode(code: string, userData: UserData): Promise<void> {
    const recommendation = await this.recommendationService.getAndCheckRecommendationByCode(code);
    if (recommendation) {
      await this.recommendationService.updateRecommendationInternal(recommendation, {
        isConfirmed: true,
        confirmationDate: new Date(),
        recommended: userData,
      });

      const recommendationStep = await this.kycAdminService
        .getKycSteps(userData.id)
        .then((k) => k.find((s) => s.name === KycStepName.RECOMMENDATION && !s.isCompleted));
      if (recommendationStep) await this.kycAdminService.updateKycStepInternal(recommendationStep.cancel());
    }
  }

  private async checkIpBlacklistFor(userData: UserData, ip: string): Promise<void> {
    if (userData.hasIpRisk) return;

    const ipBlacklist = await this.settingService.getIpBlacklist();
    if (ipBlacklist.includes(ip)) await this.userDataService.updateUserDataInternal(userData, { hasIpRisk: true });
  }

  private async getLinkedUser(userDataId: number, address: string): Promise<User> {
    const userData = await this.userDataService.getUserData(userDataId, { users: { wallet: true, userData: true } });

    return userData?.users.find((u) => u.address === address);
  }

  private async verifySignature(
    address: string,
    signature: string,
    isCustodial: boolean,
    key?: string,
    dbSignature?: string,
  ): Promise<boolean> {
    const { defaultMessage, fallbackMessage } = this.getSignMessages(address);

    const blockchains = CryptoService.getBlockchainsBasedOn(address);

    if (blockchains.includes(Blockchain.LIGHTNING) && (isCustodial || /^[a-z0-9]{140,146}$/.test(signature))) {
      // custodial Lightning wallet, only comparison check
      return !dbSignature || signature === dbSignature;
    }

    if (blockchains.includes(Blockchain.DEFICHAIN)) {
      // DeFiChain wallet, only comparison check
      return dbSignature && signature === dbSignature;
    }

    let isValid = await this.cryptoService.verifySignature(defaultMessage, address, signature, key);
    if (!isValid) isValid = await this.cryptoService.verifySignature(fallbackMessage, address, signature, key);

    return isValid;
  }

  private async verifyCompanySignature(address: string, signature: string, key?: string): Promise<boolean> {
    const challengeData = this.challengeList.get(address);
    if (!this.isChallengeValid(challengeData)) throw new UnauthorizedException('Challenge invalid');
    this.challengeList.delete(address);

    return this.cryptoService.verifySignature(challengeData.challenge, address, signature, key);
  }

  private hasChallenge(address: string): boolean {
    return this.challengeList.has(address);
  }

  generateUserToken(user: User, ip: string): string {
    const payload: JwtPayload = {
      user: user.id,
      address: user.address,
      role: user.role,
      userStatus: user.status,
      account: user.userData.id,
      accountStatus: user.userData.status,
      riskStatus: user.userData.riskStatus,
      blockchains: user.blockchains,
      ip,
    };
    return this.jwtService.sign(payload);
  }

  generateAccountToken(userData: UserData, ip: string): string {
    const payload: JwtPayload = {
      role: UserRole.ACCOUNT,
      account: userData.id,
      accountStatus: userData.status,
      riskStatus: userData.riskStatus,
      blockchains: [],
      ip,
    };
    return this.jwtService.sign(payload);
  }

  private generateCompanyToken(wallet: Wallet, ip: string): string {
    const payload: JwtPayload = {
      user: wallet.id,
      address: wallet.address,
      role: UserRole.KYC_CLIENT_COMPANY,
      ip,
    };
    return this.jwtService.sign(payload, { expiresIn: Config.auth.company.signOptions.expiresIn });
  }

  private isChallengeValid(challenge: ChallengeData): boolean {
    return challenge && Util.secondsDiff(challenge.created) <= Config.auth.challenge.expiresIn;
  }

  private isMailKeyValid(entry: MailKeyData): boolean {
    return entry && Util.minutesDiff(entry.created) <= Config.auth.mailLoginExpiresIn;
  }
}
