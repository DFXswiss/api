import { Controller, Get, Post, Query, Req } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { RealIP } from 'nestjs-real-ip';
import { AuthLnUrlService } from './auth-lnurl.service';
import { AuthLnurlResponseDto, AuthLnurlSignupDto } from './dto/auth-lnurl.dto';

@ApiTags('LNURL')
@Controller('auth')
export class AuthLnurlController {
  constructor(private readonly lnUrlService: AuthLnUrlService) {}

  @Post('lnurla')
  async getLnurlAuth(): Promise<string> {
    return this.lnUrlService.createLoginLnurl();
  }

  @Get('lnurla')
  @ApiOkResponse({ type: AuthLnurlResponseDto })
  async signInWithLnurlAuth(
    @Query() signupDto: AuthLnurlSignupDto,
    @RealIP() ip: string,
    @Req() req: Request,
  ): Promise<AuthLnurlResponseDto> {
    return this.lnUrlService.checkSignature(ip, req.url, signupDto);
  }

  @Get('lnurla/status')
  lnurlAuthStatus(@Query('k1') k1: string, @Query('signature') signature: string, @Query('key') key: string): string {
    return this.lnUrlService.getStatus(k1, signature, key);
  }
}
