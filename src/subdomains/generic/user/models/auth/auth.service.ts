import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { CreateUserDto } from 'src/subdomains/generic/user/models/user/dto/create-user.dto';
import { AuthCredentialsDto } from './dto/auth-credentials.dto';
import { JwtPayloadBase, JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { JwtService } from '@nestjs/jwt';
import { CryptoService } from 'src/integration/blockchain/ain/services/crypto.service';
import { Config } from 'src/config/config';
import { UserService } from '../user/user.service';
import { UserRepository } from '../user/user.repository';
import { User } from '../user/user.entity';
import { LinkedUserInDto } from '../user/dto/linked-user.dto';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { WalletRepository } from '../wallet/wallet.repository';
import { Wallet } from '../wallet/wallet.entity';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { Util } from 'src/shared/util';
import { Interval } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { RefService } from 'src/subdomains/core/referral/process/ref.service';

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
    private readonly walletRepo: WalletRepository,
    private readonly jwtService: JwtService,
    private readonly cryptoService: CryptoService,
    private readonly refService: RefService,
  ) {}

  @Interval(90000)
  checkChallengeList() {
    for (const [key, challenge] of this.challengeList.entries()) {
      if (!this.isChallengeValid(challenge)) {
        this.challengeList.delete(key);
      }
    }
  }

  // --- AUTH METHODS --- //
  async signUp(dto: CreateUserDto, userIp: string): Promise<{ accessToken: string }> {
    const existingUser = await this.userRepo.getByAddress(dto.address);
    if (existingUser) {
      throw new ConflictException('User already exists');
    }

    const { message } = this.getSignMessage(dto.address);
    if (!this.verifySignature(message, dto.address, dto.signature)) {
      throw new BadRequestException('Invalid signature');
    }

    const ref = await this.refService.get(userIp);
    if (ref) {
      dto.usedRef ??= ref.ref;
    }

    const user = await this.userService.createUser(dto, userIp, ref?.origin);
    return { accessToken: this.generateUserToken(user) };
  }

  async signIn({ address, signature }: AuthCredentialsDto): Promise<{ accessToken: string }> {
    const user = await this.userRepo.getByAddress(address);
    if (!user) throw new NotFoundException('User not found');

    const { message } = this.getSignMessage(address);
    const credentialsValid = this.verifySignature(message, address, signature);
    if (!credentialsValid) throw new UnauthorizedException('Invalid credentials');

    // TODO: temporary code to update old wallet signatures
    if (user.signature.length !== 88) {
      await this.userRepo.update({ id: user.id }, { signature: signature });
    }

    return { accessToken: this.generateUserToken(user) };
  }

  async companySignIn(dto: AuthCredentialsDto): Promise<{ accessToken: string }> {
    const wallet = await this.walletRepo.findOne({ where: { address: dto.address } });
    if (!wallet || !wallet.isKycClient) throw new NotFoundException('Wallet not found');

    const credentialsValid = this.verifyCompanySignature(dto);
    if (!credentialsValid) throw new UnauthorizedException('Invalid credentials');

    return { accessToken: this.generateCompanyToken(wallet) };
  }

  async getCompanyChallenge(address: string): Promise<{ challenge: string }> {
    const wallet = await this.walletRepo.findOne({ where: { address: address } });
    if (!wallet || !wallet.isKycClient) throw new BadRequestException('Wallet not found/invalid');

    const challenge = randomUUID();

    this.challengeList.set(address, { created: new Date(), challenge: challenge });

    return { challenge: challenge };
  }

  async changeUser(id: number, changeUser: LinkedUserInDto): Promise<{ accessToken: string }> {
    const user = await this.getLinkedUser(id, changeUser.address);
    if (!user) throw new NotFoundException('User not found');
    if (user.stakingBalance > 0) throw new ForbiddenException('Change user not allowed');
    return { accessToken: this.generateUserToken(user) };
  }

  // --- HELPER METHODS --- //

  getSignMessage(address: string): { message: string; blockchains: Blockchain[] } {
    const blockchains = this.cryptoService.getBlockchainsBasedOn(address);
    return {
      message: Config.auth.signMessageGeneral + address,
      blockchains,
    };
  }

  getCompanySignMessage(address: string): { message: string; blockchains: Blockchain[] } {
    const blockchains = this.cryptoService.getBlockchainsBasedOn(address);
    return {
      message: Config.auth.signMessageWallet + address,
      blockchains,
    };
  }

  private async getLinkedUser(id: number, address: string): Promise<User> {
    return this.userRepo
      .createQueryBuilder('user')
      .select('linkedUser.*')
      .leftJoin('user.userData', 'userData')
      .leftJoin('userData.users', 'linkedUser')
      .where('user.id = :id', { id })
      .andWhere('linkedUser.address = :address', { address })
      .getRawOne<User>();
  }

  private verifySignature(message: string, address: string, signature: string): boolean {
    return this.cryptoService.verifySignature(message, address, signature);
  }

  private verifyCompanySignature(dto: AuthCredentialsDto): boolean {
    const challengeData = this.challengeList.get(dto.address);
    if (!this.isChallengeValid(challengeData)) throw new UnauthorizedException('Challenge invalid');
    this.challengeList.delete(dto.address);

    return this.verifySignature(challengeData.challenge, dto.address, dto.signature);
  }

  private generateUserToken(user: User): string {
    const payload: JwtPayload = {
      id: user.id,
      address: user.address,
      role: user.role,
      blockchains: this.cryptoService.getBlockchainsBasedOn(user.address),
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
}
