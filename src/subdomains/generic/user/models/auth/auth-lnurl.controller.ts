import { Controller, Get, Post, Query, Req } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { RealIP } from 'nestjs-real-ip';
import { AuthLnUrlService } from './auth-lnurl.service';
import {
  AuthLnurlCreateLoginResponseDto,
  AuthLnurlSignInResponseDto,
  AuthLnurlSignupDto,
  AuthLnurlStatusResponseDto,
} from './dto/auth-lnurl.dto';

@ApiTags('LNURL')
@Controller('')
export class AuthLnurlController {
  constructor(private readonly lnUrlService: AuthLnUrlService) {}

  @Post('lnurla')
  @ApiOkResponse({ type: AuthLnurlCreateLoginResponseDto })
  async getLnurlAuth(@RealIP() ip: string, @Req() req: Request): Promise<AuthLnurlCreateLoginResponseDto> {
    return this.lnUrlService.create(ip, req.url);
  }

  @Get('lnurla')
  @ApiOkResponse({ type: AuthLnurlSignInResponseDto })
  async signInWithLnurlAuth(@Query() signupDto: AuthLnurlSignupDto): Promise<AuthLnurlSignInResponseDto> {
    return this.lnUrlService.login(signupDto);
  }

  @Get('lnurla/status')
  @ApiOkResponse({ type: AuthLnurlStatusResponseDto })
  async lnurlAuthStatus(@Query('k1') k1: string): Promise<AuthLnurlStatusResponseDto> {
    return this.lnUrlService.status(k1);
  }
}
