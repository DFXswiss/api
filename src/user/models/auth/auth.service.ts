import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { CreateUserDto } from 'src/user/models/user/dto/create-user.dto';
import { AuthCredentialsDto } from './dto/auth-credentials.dto';
import { JwtPayloadBase, JwtPayload, JwtChallengePayload } from 'src/shared/auth/jwt-payload.interface';
import { JwtService } from '@nestjs/jwt';
import { CryptoService } from 'src/blockchain/ain/services/crypto.service';
import { Config } from 'src/config/config';
import { UserService } from '../user/user.service';
import { UserRepository } from '../user/user.repository';
import { User } from '../user/user.entity';
import { RefService } from '../referral/ref.service';
import { LinkedUserInDto } from '../user/dto/linked-user.dto';
import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';
import { WalletRepository } from '../wallet/wallet.repository';
import { Wallet } from '../wallet/wallet.entity';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { AuthCompanyCredentialsDto } from './dto/auth-company-credentials.dto';
import { Util } from 'src/shared/util';
import { sign } from 'crypto';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { Interval } from '@nestjs/schedule';

export interface keyChallengePair {
  [key: string]: string;
}

@Injectable()
export class AuthService {
  private challengeList: keyChallengePair = {};
  private challengeIndex: number = 0;

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
    const keyList = Object.entries(this.challengeList);
    for (const keyChallengePair of keyList) {
      if (!this.checkChallengeToken(keyChallengePair[0])) {
        this.deleteChallengeToken(keyChallengePair[0]);
      }
    }
  }

  // --- AUTH METHODS --- //
  async signUp(dto: CreateUserDto, userIp: string): Promise<{ accessToken: string }> {
    const existingUser = await this.userRepo.getByAddress(dto.address);
    if (existingUser) {
      throw new ConflictException('User already exists');
    }

    if (!this.verifySignature(dto.address, dto.signature)) {
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

    const credentialsValid = this.verifySignature(address, signature);
    if (!credentialsValid) throw new UnauthorizedException('Invalid credentials');

    // TODO: temporary code to update old wallet signatures
    if (user.signature.length !== 88) {
      await this.userRepo.update({ id: user.id }, { signature: signature });
    }

    return { accessToken: this.generateUserToken(user) };
  }

  async companySignIn(dto: AuthCompanyCredentialsDto): Promise<{ accessToken: string }> {
    const wallet = await this.walletRepo.findOne({ where: { address: dto.address, description: dto.name } });
    if (!wallet || !wallet.isKycClient) throw new NotFoundException('Wallet not found');

    const credentialsValid = this.verifyCompanyChallengeHash(dto, wallet.signature);
    if (!credentialsValid) throw new UnauthorizedException('Invalid credentials');

    return { accessToken: this.generateCompanyToken(wallet) };
  }

  async getCompanyChallenge(): Promise<{ key: string; challenge: string }> {
    const key = this.generateChallengeToken(this.challengeIndex++, new Date());

    const challenge = Util.createHash(new Date().getTime() + Config.auth.challenge.company.secret, 'sha256');

    this.addChallengeToken(key, challenge);

    return { key: key, challenge: challenge };
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

  private verifySignature(address: string, signature: string): boolean {
    const signatureMessage = this.getSignMessage(address);
    return this.cryptoService.verifySignature(signatureMessage.message, address, signature);
  }

  private verifyCompanyChallengeHash(dto: AuthCompanyCredentialsDto, signature: string): boolean {
    const challengeToken = this.getChallengeToken(dto.key);
    if (!challengeToken || !this.checkChallengeToken(dto.key))
      throw new ConflictException('key/challenge Token is not valid anymore');
    this.deleteChallengeToken(dto.key);

    return this.generateChallengeHash(dto, signature, challengeToken).toLowerCase() === dto.challengeHash.toLowerCase();
  }

  private generateChallengeHash(dto: AuthCompanyCredentialsDto, signature: string, challengeToken: string): string {
    return Util.createHash(dto.name + dto.address + signature + dto.key + challengeToken, 'sha256');
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
    return this.jwtService.sign(payload);
  }

  private generateChallengeToken(id: number, time: Date): string {
    const payload: JwtChallengePayload = {
      id: id,
      time: time,
    };
    return this.jwtService.sign(payload);
  }

  private getChallengeToken(key: string): string {
    return this.challengeList[key];
  }

  private deleteChallengeToken(key: string): void {
    delete this.challengeList[key];
  }

  private addChallengeToken(key: string, challenge: string): void {
    this.challengeList[key] = challenge;
  }

  private checkChallengeToken(key: string): boolean {
    const keyDecoded = this.jwtService.decode(key);

    return (
      new Date().getTime() - new Date(keyDecoded['time']).getTime() <=
      Number.parseInt(Config.auth.challenge.company.expiresIn)
    );
  }
}
