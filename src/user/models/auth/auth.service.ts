import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { CreateUserDto } from 'src/user/models/user/dto/create-user.dto';
import { UserRepository } from 'src/user/models/user/user.repository';
import { AuthCredentialsDto } from './dto/auth-credentials.dto';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { JwtService } from '@nestjs/jwt';
import { CryptoService } from 'src/ain/services/crypto.service';
import { UserDataRepository } from 'src/user/models/userData/userData.repository';
import { LanguageService } from 'src/shared/models/language/language.service';
import { CountryService } from 'src/shared/models/country/country.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';

@Injectable()
export class AuthService {
  constructor(
    private userRepository: UserRepository,
    private userDataRepository: UserDataRepository,
    private jwtService: JwtService,
    private cryptoService: CryptoService,
    private languageService: LanguageService,
    private countryService: CountryService,
    private fiatService: FiatService,
  ) {}

  async signUp(createUserDto: CreateUserDto): Promise<any> {
    // TODO(david) mit App Update überarbeiten
    if (!this.verifySignature(createUserDto.address, createUserDto.signature) && createUserDto.signature.length != 96) {
      throw new BadRequestException('Wrong signature');
    }

    // create user and user data entry
    const user = await this.userRepository.createUser(
      createUserDto,
      this.languageService,
      this.countryService,
      this.fiatService,
    );
    await this.userDataRepository.save({ users: [user] });

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
    if (user.signature == signature || signature.length == 96) {
      credentialsValid = true;
    } else {
      if (user.signature.length == 96) {
        // temporary code to update old wallet signatures
        credentialsValid = this.verifySignature(address, signature);
        if (credentialsValid) {
          await this.userRepository.update({ id: user.id }, { signature: signature });
        }
      } else {
        credentialsValid = false;
      }
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
    return process.env.SIGN_MESSAGE + address;
  }

  private verifySignature(address: string, signature: string): boolean {
    const signatureMessage = this.getSignMessage(address);
    return this.cryptoService.verifySignature(signatureMessage, address, signature);
  }
}
