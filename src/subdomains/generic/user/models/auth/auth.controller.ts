import { Body, Controller, Delete, Get, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiCreatedResponse, ApiExcludeEndpoint, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { RealIP } from 'nestjs-real-ip';
import { IpCountryGuard } from 'src/shared/auth/ip-country.guard';
import { RateLimitGuard } from 'src/shared/auth/rate-limit.guard';
import { CreateUserDto } from 'src/subdomains/generic/user/models/user/dto/create-user.dto';
import { AlbySignupDto } from '../user/dto/alby.dto';
import { AuthAlbyService } from './auth-alby.service';
import { AuthTotpService } from './auth-totp.service';
import { AuthService } from './auth.service';
import { AuthCredentialsDto } from './dto/auth-credentials.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { AuthTotpDto } from './dto/auth-totp.dto';
import { ChallengeDto } from './dto/challenge.dto';
import { SignMessageDto } from './dto/sign-message.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly albyService: AuthAlbyService,
    private readonly authTotpService: AuthTotpService,
  ) {}

  @Post('signUp')
  @UseGuards(RateLimitGuard, IpCountryGuard)
  @Throttle(20, 864000)
  @ApiCreatedResponse({ type: AuthResponseDto })
  signUp(@Body() dto: CreateUserDto, @RealIP() ip: string): Promise<AuthResponseDto> {
    return this.authService.signUp(dto, ip);
  }

  @Post('signIn')
  @UseGuards(IpCountryGuard)
  @ApiCreatedResponse({ type: AuthResponseDto })
  signIn(@Body() credentials: AuthCredentialsDto, @RealIP() ip: string): Promise<AuthResponseDto> {
    return this.authService.signIn(credentials, ip);
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

  // --- ALBY --- //
  @Get('alby')
  @ApiExcludeEndpoint()
  signInWithAlby(@Query() dto: AlbySignupDto, @Res() res: Response) {
    const url = this.albyService.getOauthUrl(dto);
    res.redirect(307, url);
  }

  @Get('alby/redirect/:id')
  @ApiExcludeEndpoint()
  async redirectAlby(
    @Param('id') id: string,
    @Query('code') code: string,
    @RealIP() ip: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const url = await this.albyService.signIn(id, code, ip, req.url);
    res.redirect(307, url);
  }

  // --- TOTP (2FA) --- //
  @Post('2fa-secret')
  @ApiExcludeEndpoint()
  async createSecret(@Body() dto: AuthTotpDto): Promise<{ secret: string; uri: string }> {
    return this.authTotpService.createSecret(dto.kycHash);
  }

  @Delete('2fa-secret')
  @ApiExcludeEndpoint()
  async deleteSecret(@Body() dto: AuthTotpDto, @RealIP() ip: string): Promise<void> {
    return this.authTotpService.deleteSecret(dto.kycHash, ip);
  }

  @Post('2fa-verify')
  @ApiExcludeEndpoint()
  async verifyToken(@Body() dto: AuthTotpDto, @RealIP() ip: string): Promise<boolean> {
    return this.authTotpService.verifyToken(dto.kycHash, dto.token, ip);
  }
}
