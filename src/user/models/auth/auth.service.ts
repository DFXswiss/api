import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { CreateUserDto } from 'src/user/models/user/dto/create-user.dto';
import { AuthCredentialsDto } from './dto/auth-credentials.dto';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { JwtService } from '@nestjs/jwt';
import { CryptoService } from 'src/ain/services/crypto.service';
import { Config } from 'src/config/config';
import { UserService } from '../user/user.service';
import { UserRepository } from '../user/user.repository';
import { User } from '../user/user.entity';

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly userRepo: UserRepository,
    private readonly jwtService: JwtService,
    private readonly cryptoService: CryptoService,
  ) {}

  async signUp(dto: CreateUserDto, userIp: string): Promise<{ accessToken: string }> {
    if (!this.verifySignature(dto.address, dto.signature)) {
      throw new BadRequestException('Invalid signature');
    }

    const user = await this.userService.createUser(dto, userIp);
    return { accessToken: this.generateToken(user) };
  }

  async signIn({ address, signature }: AuthCredentialsDto): Promise<{ accessToken: string }> {
    const user = await this.userService.getUserByAddress(address);
    if (!user) throw new NotFoundException('User not found');

    const credentialsValid = this.verifySignature(address, signature);
    if (!credentialsValid) throw new UnauthorizedException('Invalid credentials');

    // TODO: temporary code to update old wallet signatures
    if (user.signature.length !== 88) {
      await this.userRepo.update({ id: user.id }, { signature: signature });
    }

    return { accessToken: this.generateToken(user) };
  }

  getSignMessage(address: string): string {
    return Config.auth.signMessage + address;
  }

  private verifySignature(address: string, signature: string): boolean {
    const signatureMessage = this.getSignMessage(address);
    return this.cryptoService.verifySignature(signatureMessage, address, signature);
  }

  private generateToken(user: User): string {
    const payload: JwtPayload = { id: user.id, address: user.address, role: user.role };
    return this.jwtService.sign(payload);
  }
}
