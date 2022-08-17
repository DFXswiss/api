import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { CreateUserDto } from 'src/user/models/user/dto/create-user.dto';
import { AuthCredentialsDto } from './dto/auth-credentials.dto';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { JwtService } from '@nestjs/jwt';
import { CryptoService } from 'src/ain/services/crypto.service';
import { Config } from 'src/config/config';
import { UserService } from '../user/user.service';
import { UserRepository } from '../user/user.repository';
import { User } from '../user/user.entity';
import { RefService } from '../referral/ref.service';
import { Blockchain } from 'src/ain/node/node.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly userRepo: UserRepository,
    private readonly jwtService: JwtService,
    private readonly cryptoService: CryptoService,
    private readonly refService: RefService,
  ) {}

  async signUp(dto: CreateUserDto, userIp: string): Promise<{ accessToken: string }> {
    const existingUser = await this.userService.getUserByAddress(dto.address);
    if (existingUser) {
      throw new ConflictException('User already exists');
    }

    const blockchain = this.cryptoService.getBlockchainBasedOn(dto.address);
    if (!this.verifySignature(dto.address, dto.signature, blockchain)) {
      throw new BadRequestException('Invalid signature');
    }

    const ref = await this.refService.get(userIp);
    if (ref) {
      dto.usedRef ??= ref.ref;
    }

    const user = await this.userService.createUser(dto, userIp, blockchain, ref?.origin);
    return { accessToken: this.generateToken(user) };
  }

  async signIn({ address, signature }: AuthCredentialsDto): Promise<{ accessToken: string }> {
    const user = await this.userService.getUserByAddress(address);
    if (!user) throw new NotFoundException('User not found');

    const credentialsValid = this.verifySignature(address, signature, user.blockchain);
    if (!credentialsValid) throw new UnauthorizedException('Invalid credentials');

    // TODO: temporary code to update old wallet signatures
    if (user.signature.length !== 88) {
      await this.userRepo.update({ id: user.id }, { signature: signature });
    }

    return { accessToken: this.generateToken(user) };
  }

  getSignMessage(address: string, blockchain: Blockchain): string {
    if (blockchain === Blockchain.ETHEREUM || blockchain === Blockchain.BITCOIN)
      return Config.auth.signMessageGeneral + address;
    return Config.auth.signMessage + address;
  }

  private verifySignature(address: string, signature: string, blockchain: Blockchain): boolean {
    const signatureMessage = this.getSignMessage(address, blockchain);
    return this.cryptoService.verifySignature(signatureMessage, address, signature, blockchain);
  }

  private generateToken(user: User): string {
    const payload: JwtPayload = { id: user.id, address: user.address, role: user.role, blockchain: user.blockchain };
    return this.jwtService.sign(payload);
  }
}
