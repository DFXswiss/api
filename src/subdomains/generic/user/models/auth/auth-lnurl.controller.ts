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
@Controller('lnurla')
export class AuthLnurlController {
  constructor(private readonly lnUrlService: AuthLnUrlService) {}

  @Post()
  @ApiOkResponse({ type: AuthLnurlCreateLoginResponseDto })
  async getLnurlAuth(@RealIP() ip: string, @Req() req: Request): Promise<AuthLnurlCreateLoginResponseDto> {
    return this.lnUrlService.create(ip, req.url);
  }

  @Get()
  @ApiOkResponse({ type: AuthLnurlSignInResponseDto })
  async signInWithLnurlAuth(
    @Query() signupDto: AuthLnurlSignupDto,
    @RealIP() ip: string,
  ): Promise<AuthLnurlSignInResponseDto> {
    return this.lnUrlService.login(signupDto, ip);
  }

  @Get('status')
  @ApiOkResponse({ type: AuthLnurlStatusResponseDto })
  async lnurlAuthStatus(@Query('k1') k1: string): Promise<AuthLnurlStatusResponseDto> {
    return this.lnUrlService.status(k1);
  }
}
