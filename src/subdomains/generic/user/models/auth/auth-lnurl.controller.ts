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
@Controller('auth')
export class AuthLnurlController {
  constructor(private readonly lnUrlService: AuthLnUrlService) {}

  @Post('lnurla')
  @ApiOkResponse({ type: AuthLnurlCreateLoginResponseDto })
  async getLnurlAuth(): Promise<AuthLnurlCreateLoginResponseDto> {
    return this.lnUrlService.createLoginLnurl();
  }

  @Get('lnurla')
  @ApiOkResponse({ type: AuthLnurlSignInResponseDto })
  async signInWithLnurlAuth(
    @Query() signupDto: AuthLnurlSignupDto,
    @RealIP() ip: string,
    @Req() req: Request,
  ): Promise<AuthLnurlSignInResponseDto> {
    return this.lnUrlService.checkSignature(ip, req.url, signupDto);
  }

  @Get('lnurla/status')
  @ApiOkResponse({ type: AuthLnurlStatusResponseDto })
  async lnurlAuthStatus(
    @Query('k1') k1: string,
    @Query('signature') signature: string,
    @Query('key') key: string,
  ): Promise<AuthLnurlStatusResponseDto> {
    return this.lnUrlService.getStatus(k1, signature, key);
  }
}
