import { Injectable, UnauthorizedException } from '@nestjs/common';
import { CreateUserDto } from 'src/user/dto/create-user.dto';
import { UserRepository } from 'src/user/user.repository';
import { AuthCredentialsDto } from './dto/auth-credentials.dto';
import { JwtPayload } from './jwt-payload.interface';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthService {
  constructor(private userRepository: UserRepository, private jwtService: JwtService) {}

  // async createAuth(user: any): Promise<string> {
  //   return '1';
  // }

  // async findAuthByAddress(): Promise<string> {
  //   return '2';
  // }

  // async updateAuth(user: any): Promise<string> {
  //   return '3';
  // }

  async signUp(createUserDto: CreateUserDto): Promise<void> {
    this.userRepository.createUser(createUserDto);
  }

  async signIn(authCredentialsDto: AuthCredentialsDto): Promise<any> {
    const { address, signature } = authCredentialsDto;

    const user = await this.userRepository.findOne({ address, signature });

    // TODO: Evtl. signature verschlüsseln?

    if(user) {
      const payload: JwtPayload = { address };
      const accessToken = await this.jwtService.sign(payload);
      return { accessToken };
    } else {
      throw new UnauthorizedException('Invalid Credentials');
    }
  }
}
