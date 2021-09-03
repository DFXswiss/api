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
    const signatureMessage = process.env.SIGN_MESSAGE + createUserDto.address;
    const signatureValid = this.deFiService.verifySignature(signatureMessage, createUserDto.address, createUserDto.signature);
    if (!signatureValid) {
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

    if (user) {
      if(user.signature == signature) {
        const payload: JwtPayload = { address, role:user.role };
        const accessToken = this.jwtService.sign(payload);
        return { accessToken };
      }else{
        throw new UnauthorizedException('Invalid Credentials');
      }
    } else {
      throw new NotFoundException('User not found');
    }
  }
}
