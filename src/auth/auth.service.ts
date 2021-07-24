import { Injectable, UnauthorizedException } from '@nestjs/common';
import { CreateUserDto } from 'src/user/dto/create-user.dto';
import { UserRepository } from 'src/user/user.repository';
import { AuthCredentialsDto } from './dto/auth-credentials.dto';
import { JwtPayload } from './jwt-payload.interface';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthService {
  constructor(private userRepository: UserRepository, private jwtService: JwtService) {}

  async signUp(createUserDto: CreateUserDto): Promise<any> {
    const signUpResult = await this.userRepository.createUser(createUserDto);
    if(signUpResult.statusCode) return signUpResult;
    
    return this.signIn(createUserDto);
  }

  async signIn(authCredentialsDto: AuthCredentialsDto): Promise<any> {
    const { address, signature } = authCredentialsDto;
    const user = await this.userRepository.findOne({ "address": address, "signature": signature });

    if(user) {
      const payload: JwtPayload = { address };
      const accessToken = await this.jwtService.sign(payload);
      return { accessToken };
    } else {
      throw new UnauthorizedException('Invalid Credentials');
    }
  }
}
