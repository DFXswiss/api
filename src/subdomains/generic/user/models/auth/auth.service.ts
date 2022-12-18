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
import { Util } from 'src/shared/utils/util';
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
    dto.blockchain ??= this.cryptoService.getDefaultBlockchainBasedOn(dto.address);

    const existingUser = await this.userRepo.getByAddress(dto.address, dto.blockchain);
    if (existingUser) throw new ConflictException('User already exists');

    if (!this.verifySignature(dto.address, dto.signature, dto.blockchain))
      throw new BadRequestException('Invalid signature');

    const ref = await this.refService.get(userIp);
    if (ref) {
      dto.usedRef ??= ref.ref;
    }

    const user = await this.userService.createUser(dto, userIp, ref?.origin);
    return { accessToken: this.generateUserToken(user) };
  }

  async signIn({ address, signature, blockchain }: AuthCredentialsDto): Promise<{ accessToken: string }> {
    blockchain ??= this.cryptoService.getDefaultBlockchainBasedOn(address);

    const user = await this.userRepo.getByAddress(address, blockchain);
    if (!user) throw new NotFoundException('User not found');

    if (!this.verifySignature(address, signature, blockchain)) throw new UnauthorizedException('Invalid credentials');

    // TODO: temporary code to update old wallet signatures
    if (user.signature.length !== 88) {
      await this.userRepo.update({ id: user.id }, { signature: signature });
    }

    return { accessToken: this.generateUserToken(user) };
  }

  async companySignIn(dto: AuthCredentialsDto): Promise<{ accessToken: string }> {
    dto.blockchain ??= this.cryptoService.getDefaultBlockchainBasedOn(dto.address);

    const wallet = await this.walletRepo.findOne({ where: { address: dto.address } });
    if (!wallet || !wallet.isKycClient) throw new NotFoundException('Wallet not found');

    if (!this.verifyCompanySignature(dto.address, dto.signature, dto.blockchain))
      throw new UnauthorizedException('Invalid credentials');

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
    const user = await this.getLinkedUser(id, changeUser.address, changeUser.blockchain);
    if (!user) throw new NotFoundException('User not found');
    if (user.stakingBalance > 0) throw new ForbiddenException('Change user not allowed');
    return { accessToken: this.generateUserToken(user) };
  }

  // --- SIGN MESSAGES --- //

  getSignInfo(address: string): { message: string; blockchains: Blockchain[] } {
    return {
      message: this.getSignMessages(address).defaultMessage,
      blockchains: this.cryptoService.getBlockchainsBasedOn(address),
    };
  }

  getCompanySignInfo(address: string): { message: string; blockchains: Blockchain[] } {
    return {
      message: Config.auth.signMessageWallet + address,
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

  private async getLinkedUser(id: number, address: string, blockchain: Blockchain): Promise<User> {
    return this.userRepo
      .createQueryBuilder('user')
      .select('linkedUser.*')
      .leftJoin('user.userData', 'userData')
      .leftJoin('userData.users', 'linkedUser')
      .where('user.id = :id', { id })
      .andWhere('linkedUser.address = :address', { address })
      .andWhere('linkedUser.blockchain = :blockchain', { blockchain })
      .getRawOne<User>();
  }

  private verifySignature(address: string, signature: string, blockchain: Blockchain): boolean {
    const { defaultMessage, fallbackMessage } = this.getSignMessages(address);
    return this.cryptoService.verifySignature(address, signature, blockchain, defaultMessage, fallbackMessage);
  }

  private verifyCompanySignature(address: string, signature: string, blockchain: Blockchain): boolean {
    const challengeData = this.challengeList.get(address);
    if (!this.isChallengeValid(challengeData)) throw new UnauthorizedException('Challenge invalid');
    this.challengeList.delete(address);

    return this.cryptoService.verifySignature(address, signature, blockchain, challengeData.challenge);
  }

  private generateUserToken(user: User): string {
    const payload: JwtPayload = {
      id: user.id,
      address: user.address,
      role: user.role,
      blockchain: user.blockchain,
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
