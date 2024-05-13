import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { CryptoService } from 'src/integration/blockchain/shared/services/crypto.service';
import { LightningService } from 'src/integration/lightning/services/lightning.service';
import { SiftService } from 'src/integration/sift/services/sift.service';
import { JwtPayload, JwtPayloadBase } from 'src/shared/auth/jwt-payload.interface';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { RefService } from 'src/subdomains/core/referral/process/ref.service';
import { CreateUserDto } from 'src/subdomains/generic/user/models/user/dto/create-user.dto';
import { MailContext, MailType } from 'src/subdomains/supporting/notification/enums';
import { MailKey, MailTranslationKey } from 'src/subdomains/supporting/notification/factories/mail.factory';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { FeeService } from 'src/subdomains/supporting/payment/services/fee.service';
import { KycType, UserDataStatus } from '../user-data/user-data.entity';
import { UserDataService } from '../user-data/user-data.service';
import { LinkedUserInDto } from '../user/dto/linked-user.dto';
import { User, UserStatus } from '../user/user.entity';
import { UserRepository } from '../user/user.repository';
import { UserService } from '../user/user.service';
import { Wallet } from '../wallet/wallet.entity';
import { WalletService } from '../wallet/wallet.service';
import { AuthCredentialsDto } from './dto/auth-credentials.dto';
import { AuthMailDto } from './dto/auth-mail.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { ChallengeDto } from './dto/challenge.dto';
import { SignMessageDto } from './dto/sign-message.dto';

export interface ChallengeData {
  created: Date;
  challenge: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new DfxLogger(AuthService);

  private readonly masterKeyPrefix = 'MASTER-KEY-';
  private challengeList: Map<string, ChallengeData> = new Map<string, ChallengeData>();

  constructor(
    private readonly userService: UserService,
    private readonly userRepo: UserRepository,
    private readonly walletService: WalletService,
    private readonly jwtService: JwtService,
    private readonly cryptoService: CryptoService,
    private readonly lightningService: LightningService,
    private readonly refService: RefService,
    private readonly feeService: FeeService,
    private readonly userDataService: UserDataService,
    private readonly notificationService: NotificationService,
    private readonly siftService: SiftService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  checkChallengeList() {
    for (const [key, challenge] of this.challengeList.entries()) {
      if (!this.isChallengeValid(challenge)) {
        this.challengeList.delete(key);
      }
    }
  }

  // --- AUTH METHODS --- //
  async authenticate(dto: CreateUserDto, userIp: string): Promise<AuthResponseDto> {
    const existingUser = await this.userRepo.getByAddress(dto.address, true);
    return existingUser
      ? this.doSignIn(existingUser, dto, userIp, false)
      : this.doSignUp(dto, userIp, false).catch((e) => {
          if (e.message?.includes('duplicate key')) return this.signIn(dto, userIp, false);
          throw e;
        });
  }

  async signUp(dto: CreateUserDto, userIp: string, isCustodial = false): Promise<AuthResponseDto> {
    const existingUser = await this.userRepo.getByAddress(dto.address, true);
    if (existingUser) throw new ConflictException('User already exists');

    return this.doSignUp(dto, userIp, isCustodial);
  }

  private async doSignUp(dto: CreateUserDto, userIp: string, isCustodial: boolean) {
    const keyWallet = await this.walletService.getWithMasterKey(dto.signature);
    if (keyWallet) {
      dto.signature = `${this.masterKeyPrefix}${keyWallet.id}`;
    } else if (!(await this.verifySignature(dto.address, dto.signature, isCustodial, dto.key)))
      throw new BadRequestException('Invalid signature');

    const ref = await this.refService.get(userIp);
    if (ref) dto.usedRef ??= ref.ref;

    if (dto.key) dto.signature = [dto.signature, dto.key].join(';');

    const wallet = await this.walletService.getByIdOrName(dto.walletId, dto.wallet);
    const user = await this.userService.createUser(dto, userIp, ref?.origin, wallet, dto.discountCode);
    await this.siftService.createAccount(user);
    return { accessToken: this.generateUserToken(user, userIp) };
  }

  async signIn(dto: AuthCredentialsDto, userIp: string, isCustodial = false): Promise<AuthResponseDto> {
    const isCompany = this.hasChallenge(dto.address);
    if (isCompany) return this.companySignIn(dto, userIp);

    const user = await this.userRepo.getByAddress(dto.address, true);
    if (!user) throw new NotFoundException('User not found');
    return this.doSignIn(user, dto, userIp, isCustodial);
  }

  private async doSignIn(user: User, dto: AuthCredentialsDto, userIp: string, isCustodial: boolean) {
    if (user.status === UserStatus.BLOCKED) throw new ConflictException('User is blocked');

    const keyWalletId =
      user.signature?.includes(this.masterKeyPrefix) && +user.signature?.replace(this.masterKeyPrefix, '');

    if (keyWalletId) {
      const wallet = await this.walletService.getByIdOrName(keyWalletId);
      if (dto.signature !== wallet.masterKey) throw new UnauthorizedException('Invalid credentials');
    } else if (!(await this.verifySignature(dto.address, dto.signature, isCustodial, dto.key, user.signature))) {
      throw new UnauthorizedException('Invalid credentials');
    } else if (!user.signature) {
      // TODO: temporary code to update empty signatures
      await this.userRepo.update({ address: dto.address }, { signature: dto.signature });
    }

    try {
      if (dto.discountCode) await this.feeService.addDiscountCodeUser(user, dto.discountCode);
    } catch (e) {
      this.logger.warn(`Error while adding discountCode in user signIn ${user.id}:`, e);
    }

    await this.siftService.login(user, userIp);

    return { accessToken: this.generateUserToken(user, userIp) };
  }

  async signInByMail(dto: AuthMailDto): Promise<void> {
    const userData =
      (await this.userDataService
        .getUsersByMail(dto.mail)
        .then((u) => Util.sort(u, 'id', 'DESC') && Util.maxObj(u, 'kycLevel'))) ??
      (await this.userDataService.createUserData({
        kycType: KycType.DFX,
        mail: dto.mail,
        language: dto.language,
        status: UserDataStatus.KYC_ONLY,
      }));

    await this.notificationService.sendMail({
      type: MailType.USER,
      context: MailContext.LOGIN,
      input: {
        userData: userData,
        title: `${MailTranslationKey.LOGIN}.title`,
        salutation: { key: `${MailTranslationKey.LOGIN}.salutation` },
        suffix: [
          { key: MailKey.SPACE, params: { value: '1' } },
          {
            key: `${MailTranslationKey.LOGIN}.message`,
            params: {
              url: userData.kycUrl,
              urlText: userData.kycUrl,
            },
          },
          {
            key: `${MailTranslationKey.GENERAL}.button`,
            params: {
              url: userData.kycUrl,
            },
          },
          { key: MailKey.SPACE, params: { value: '2' } },
          { key: MailKey.DFX_TEAM_CLOSING },
        ],
      },
    });
  }

  private async companySignIn(dto: AuthCredentialsDto, ip: string): Promise<AuthResponseDto> {
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

  async changeUser(id: number, changeUser: LinkedUserInDto, ip: string): Promise<AuthResponseDto> {
    const user = await this.getLinkedUser(id, changeUser.address);
    if (!user) throw new NotFoundException('User not found');
    if (user.status === UserStatus.BLOCKED) throw new BadRequestException('User is blocked');
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

  // --- HELPER METHODS --- //

  private async getLinkedUser(id: number, address: string): Promise<User> {
    const user = await this.userRepo
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.userData', 'userData')
      .leftJoinAndSelect('userData.users', 'linkedUser')
      .leftJoinAndSelect('linkedUser.wallet', 'wallet')
      .where('user.id = :id', { id })
      .andWhere('linkedUser.address = :address', { address })
      .getOne();

    return user?.userData?.users.find((u) => u.address === address);
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

    if (blockchains.includes(Blockchain.LIGHTNING)) {
      if (isCustodial || /^[a-z0-9]{140,146}$/.test(signature)) {
        // custodial Lightning wallet, only comparison check
        return !dbSignature || signature === dbSignature;
      }

      key = await this.lightningService.getPublicKeyOfAddress(address);
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

  private generateUserToken(user: User, ip: string): string {
    const payload: JwtPayload = {
      id: user.id,
      address: user.address,
      role: user.role,
      blockchains: user.blockchains,
      ip,
    };
    return this.jwtService.sign(payload);
  }

  private generateCompanyToken(wallet: Wallet, ip: string): string {
    const payload: JwtPayloadBase = {
      id: wallet.id,
      address: wallet.address,
      role: UserRole.KYC_CLIENT_COMPANY,
      ip,
    };
    return this.jwtService.sign(payload, { expiresIn: Config.auth.company.signOptions.expiresIn });
  }

  private isChallengeValid(challenge: ChallengeData): boolean {
    return challenge && Util.secondsDiff(challenge.created) <= Config.auth.challenge.expiresIn;
  }
}
