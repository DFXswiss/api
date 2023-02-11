import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CreateUserDto } from 'src/subdomains/generic/user/models/user/dto/create-user.dto';
import { AuthService } from './auth.service';
import { AuthCredentialsDto } from './dto/auth-credentials.dto';
import { RealIP } from 'nestjs-real-ip';
import { SignMessageDto } from './dto/sign-message.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { ChallengeDto } from './dto/challenge.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('signUp')
  @ApiCreatedResponse({ type: AuthResponseDto })
  signUp(@Body() dto: CreateUserDto, @RealIP() ip: string): Promise<AuthResponseDto> {
    return this.authService.signUp(dto, ip);
  }

  @Post('signIn')
  @ApiCreatedResponse({ type: AuthResponseDto })
  signIn(@Body() credentials: AuthCredentialsDto): Promise<AuthResponseDto> {
    return this.authService.signIn(credentials);
  }

  @Get('signMessage')
  @ApiOkResponse({ type: SignMessageDto })
  getSignMessage(@Query('address') address: string): SignMessageDto {
    return this.authService.getSignInfo(address);
  }

  @Get('challenge')
  @ApiCreatedResponse({ type: ChallengeDto })
  companyChallenge(@Query('address') address: string): Promise<ChallengeDto> {
    return this.authService.getCompanyChallenge(address);
  }
}
