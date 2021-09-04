import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { CreateUserDto } from 'src/user/dto/create-user.dto';
import { UserRepository } from 'src/user/user.repository';
import { AuthCredentialsDto } from './dto/auth-credentials.dto';
import { JwtPayload } from './jwt-payload.interface';
import { JwtService } from '@nestjs/jwt';
import { DeFiService } from 'src/services/defi.service';

@Injectable()
export class AuthService {
  constructor(
    private userRepository: UserRepository,
    private jwtService: JwtService,
    private deFiService: DeFiService,
  ) {}

  async signUp(createUserDto: CreateUserDto): Promise<any> {
    if (!this.verifySignature(createUserDto.address, createUserDto.signature)) {
      throw new BadRequestException('Wrong signature');
    }

    await this.userRepository.createUser(createUserDto);
    return this.signIn(createUserDto);
  }

  async signIn(authCredentialsDto: AuthCredentialsDto): Promise<any> {
    const { address, signature } = authCredentialsDto;
    const user = await this.userRepository.findOne({
      address: address,
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    let credentialsValid;
    if(user.signature == signature) {
      credentialsValid = true;
    } else {
      if (user.signature.length == 96) {
        // temporary code to update old wallet signatures
        credentialsValid = this.verifySignature(address, signature);
        if (credentialsValid) {
          await this.userRepository.update({id: user.id}, {signature: signature});
        }
      } else {
        credentialsValid = false;
      }
    }
    
    if (credentialsValid) {
      const payload: JwtPayload = { address, role:user.role };
      const accessToken = this.jwtService.sign(payload);
      return { accessToken };
    } else {
      throw new UnauthorizedException('Invalid Credentials');
    }
  }

  private verifySignature(address: string, signature: string): boolean {
    const signatureMessage = process.env.SIGN_MESSAGE + address;
    return this.deFiService.verifySignature(signatureMessage, address, signature);
  }
}
