import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CreateUserDto } from 'src/subdomains/generic/user/models/user/dto/create-user.dto';
import { AuthService } from './auth.service';
import { AuthCredentialsDto } from './dto/auth-credentials.dto';
import { RealIP } from 'nestjs-real-ip';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('signUp')
  signUp(@Body() dto: CreateUserDto, @RealIP() ip: string): Promise<{ accessToken: string }> {
    return this.authService.signUp(dto, ip);
  }

  @Post('signIn')
  signIn(@Body() credentials: AuthCredentialsDto): Promise<{ accessToken: string }> {
    return this.authService.signIn(credentials);
  }

  @Get('signMessage')
  getSignMessage(@Query('address') address: string): { message: string; blockchain: Blockchain } {
    return this.authService.getSignMessage(address);
  }

  @Post('company/signIn')
  signInCompany(@Body() credentials: AuthCredentialsDto): Promise<{ accessToken: string }> {
    return this.authService.companySignIn(credentials);
  }

  @Post('company/challenge')
  companyChallenge(@Query('address') address: string): Promise<{ challenge: string }> {
    return this.authService.getCompanyChallenge(address);
  }
}
