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
import { JwtCompanyPayload, JwtPayload } from 'src/shared/auth/jwt-payload.interface';
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

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly userRepo: UserRepository,
    private readonly walletRepo: WalletRepository,
    private readonly jwtService: JwtService,
    private readonly cryptoService: CryptoService,
    private readonly refService: RefService,
  ) {}

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

  async signIn({ address, signature }: AuthCredentialsDto, companyLogin = false): Promise<{ accessToken: string }> {
    let user;

    user = companyLogin ? await this.walletRepo.getByAddress(address) : await this.userRepo.getByAddress(address);
    if (!user) throw new NotFoundException('User not found');

    const credentialsValid = this.verifySignature(address, signature);
    if (!credentialsValid) throw new UnauthorizedException('Invalid credentials');

    // TODO: temporary code to update old wallet signatures
    if (user.signature.length !== 88) {
      await this.userRepo.update({ id: user.id }, { signature: signature });
    }

    return { accessToken: companyLogin ? this.generateCompanyToken(user) : this.generateUserToken(user) };
  }

  getSignMessage(address: string, companyLogin = false): { message: string; blockchains: Blockchain[] } {
    const blockchains = this.cryptoService.getBlockchainsBasedOn(address);
    return {
      message: (companyLogin ? Config.auth.signMessageWallet : Config.auth.signMessageGeneral) + address,
      blockchains,
    };
  }

  async changeUser(id: number, changeUser: LinkedUserInDto): Promise<{ accessToken: string }> {
    const user = await this.getLinkedUser(id, changeUser.address);
    if (!user) throw new NotFoundException('User not found');
    if (user.stakingBalance > 0) throw new ForbiddenException('Change user not allowed');
    return { accessToken: this.generateUserToken(user) };
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

  private verifySignature(address: string, signature: string, companyLogin = false): boolean {
    const signatureMessage = this.getSignMessage(address, companyLogin);
    return this.cryptoService.verifySignature(signatureMessage.message, address, signature);
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

  private generateCompanyToken(user: Wallet): string {
    const payload: JwtCompanyPayload = {
      id: user.id,
      address: user.address,
      isKycClient: user.isKycClient,
    };
    return this.jwtService.sign(payload);
  }
}
