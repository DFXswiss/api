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
import { JwtPayload, JwtPayloadBase } from 'src/shared/auth/jwt-payload.interface';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { Util } from 'src/shared/utils/util';
import { FeeService } from 'src/subdomains/core/fee/fee.service';
import { RefService } from 'src/subdomains/core/referral/process/ref.service';
import { CreateUserDto } from 'src/subdomains/generic/user/models/user/dto/create-user.dto';
import { LinkedUserInDto } from '../user/dto/linked-user.dto';
import { User, UserStatus } from '../user/user.entity';
import { UserRepository } from '../user/user.repository';
import { UserService } from '../user/user.service';
import { Wallet } from '../wallet/wallet.entity';
import { WalletService } from '../wallet/wallet.service';
import { AuthCredentialsDto } from './dto/auth-credentials.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { ChallengeDto } from './dto/challenge.dto';
import { SignMessageDto } from './dto/sign-message.dto';

export interface ChallengeData {
  created: Date;
  challenge: string;
}

@Injectable()
export class AuthService {
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

  async signUp(dto: CreateUserDto, userIp: string, isCustodial = false): Promise<AuthResponseDto> {
    const existingUser = await this.userRepo.getByAddress(dto.address, true);
    if (existingUser) throw new ConflictException('User already exists');

    const wallet = await this.walletService.getByIdOrName(dto.walletId, dto.wallet);

    if (wallet?.masterKey === dto.signature) {
      delete dto.signature;
    } else if (!(await this.verifySignature(dto.address, dto.signature, isCustodial, dto.key)))
      throw new BadRequestException('Invalid signature');

    const ref = await this.refService.get(userIp);
    if (ref) dto.usedRef ??= ref.ref;

    if (dto.key) dto.signature = [dto.signature, dto.key].join(';');

    const user = await this.userService.createUser(dto, userIp, ref?.origin, undefined, wallet, dto.discountCode);
    return { accessToken: this.generateUserToken(user) };
  }

  async signIn(dto: AuthCredentialsDto, isCustodial = false): Promise<AuthResponseDto> {
    const isCompany = this.hasChallenge(dto.address);
    if (isCompany) return this.companySignIn(dto);

    const user = await this.userRepo.getByAddress(dto.address, true);
    if (!user || user.status == UserStatus.BLOCKED) throw new NotFoundException('User not found');

    if (user.wallet.masterKey !== dto.signature) {
      if (!(await this.verifySignature(dto.address, dto.signature, isCustodial, dto.key, user.signature))) {
        throw new UnauthorizedException('Invalid credentials');
      } else if (!user.signature) {
        // TODO: temporary code to update empty signatures
        await this.userRepo.update({ address: dto.address }, { signature: dto.signature });
      }
    }

    if (dto.discountCode) await this.feeService.addDiscountCodeUser(user.userData, dto.discountCode);

    return { accessToken: this.generateUserToken(user) };
  }

  private async companySignIn(dto: AuthCredentialsDto): Promise<AuthResponseDto> {
    const wallet = await this.walletService.getByAddress(dto.address);
    if (!wallet?.isKycClient) throw new NotFoundException('Wallet not found');

    if (!(await this.verifyCompanySignature(dto.address, dto.signature, dto.key)))
      throw new UnauthorizedException('Invalid credentials');

    return { accessToken: this.generateCompanyToken(wallet) };
  }

  async getCompanyChallenge(address: string): Promise<ChallengeDto> {
    const wallet = await this.walletService.getByAddress(address);
    if (!wallet?.isKycClient) throw new BadRequestException('Wallet not found/invalid');

    const challenge = randomUUID();

    this.challengeList.set(address, { created: new Date(), challenge: challenge });

    return { challenge: challenge };
  }

  async changeUser(id: number, changeUser: LinkedUserInDto): Promise<AuthResponseDto> {
    const user = await this.getLinkedUser(id, changeUser.address);
    if (!user) throw new NotFoundException('User not found');
    if (user.status === UserStatus.BLOCKED) throw new BadRequestException('User is blocked');
    return { accessToken: this.generateUserToken(user) };
  }

  // --- SIGN MESSAGES --- //

  getSignInfo(address: string): SignMessageDto {
    return {
      message: this.getSignMessages(address).defaultMessage,
      blockchains: this.cryptoService.getBlockchainsBasedOn(address),
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

    const blockchains = this.cryptoService.getBlockchainsBasedOn(address);

    if (blockchains.includes(Blockchain.LIGHTNING)) {
      if (isCustodial || /^[a-z0-9]{140,146}$/.test(signature)) {
        // custodial Lightning wallet, only comparison check
        return !dbSignature || signature === dbSignature;
      }

      key = await this.lightningService.getPublicKeyOfAddress(address);
    }

    let isValid = this.cryptoService.verifySignature(defaultMessage, address, signature, key);
    if (!isValid) isValid = this.cryptoService.verifySignature(fallbackMessage, address, signature, key);

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

  private generateUserToken(user: User): string {
    const payload: JwtPayload = {
      id: user.id,
      address: user.address,
      role: user.role,
      blockchains: this.getBlockchains(user),
    };
    return this.jwtService.sign(payload);
  }

  private generateCompanyToken(wallet: Wallet): string {
    const payload: JwtPayloadBase = {
      id: wallet.id,
      address: wallet.address,
      role: UserRole.KYC_CLIENT_COMPANY,
    };
    return this.jwtService.sign(payload, { expiresIn: Config.auth.company.signOptions.expiresIn });
  }

  private isChallengeValid(challenge: ChallengeData): boolean {
    return challenge && Util.secondsDiff(challenge.created, new Date()) <= Config.auth.challenge.expiresIn;
  }

  private getBlockchains(user: User): Blockchain[] {
    // wallet name / blockchain map
    const customChains = {
      Talium: ['Talium' as Blockchain],
    };

    return customChains[user.wallet.name] ?? this.cryptoService.getBlockchainsBasedOn(user.address);
  }
}
