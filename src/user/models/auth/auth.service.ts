import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { CreateUserDto } from 'src/user/models/user/dto/create-user.dto';
import { UserRepository } from 'src/user/models/user/user.repository';
import { AuthCredentialsDto } from './dto/auth-credentials.dto';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { JwtService } from '@nestjs/jwt';
import { CryptoService } from 'src/ain/services/crypto.service';
import { UserDataService } from '../userData/userData.service';
import { LanguageService } from 'src/shared/models/language/language.service';
import { CountryService } from 'src/shared/models/country/country.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { Config } from 'src/config/config';

@Injectable()
export class AuthService {
  constructor(
    private userRepository: UserRepository,
    private userDataService: UserDataService,
    private jwtService: JwtService,
    private cryptoService: CryptoService,
    private languageService: LanguageService,
    private countryService: CountryService,
    private fiatService: FiatService,
  ) {}

  async signUp(createUserDto: CreateUserDto): Promise<any> {
    if (!this.verifySignature(createUserDto.address, createUserDto.signature)) {
      throw new BadRequestException('Wrong signature');
    }

    // create user and user data entry
    const user = await this.userRepository.createUser(
      createUserDto,
      this.languageService,
      this.countryService,
      this.fiatService,
    );
    await this.userDataService.createUserData(user);

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

    const credentialsValid = this.verifySignature(address, signature);

    // TODO: temporary code to update old wallet signatures
    if (credentialsValid && user.signature.length !== 88) {
      await this.userRepository.update({ id: user.id }, { signature: signature });
    }

    if (credentialsValid) {
      const payload: JwtPayload = { id: user.id, address: user.address, role: user.role };
      const accessToken = this.jwtService.sign(payload);
      return { accessToken };
    } else {
      throw new UnauthorizedException('Invalid Credentials');
    }
  }

  getSignMessage(address: string): string {
    return Config.auth.signMessage + address;
  }

  private verifySignature(address: string, signature: string): boolean {
    const signatureMessage = this.getSignMessage(address);
    return this.cryptoService.verifySignature(signatureMessage, address, signature);
  }
}
