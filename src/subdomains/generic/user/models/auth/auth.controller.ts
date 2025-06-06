import { Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiExcludeEndpoint, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { RealIP } from 'nestjs-real-ip';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { IpCountryGuard } from 'src/shared/auth/ip-country.guard';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { OptionalJwtAuthGuard } from 'src/shared/auth/optional.guard';
import { RateLimitGuard } from 'src/shared/auth/rate-limit.guard';
import { AccountMergeService } from '../account-merge/account-merge.service';
import { AlbySignupDto } from '../user/dto/alby.dto';
import { UserRepository } from '../user/user.repository';
import { AuthAlbyService } from './auth-alby.service';
import { AuthService } from './auth.service';
import { SignInDto, SignUpDto } from './dto/auth-credentials.dto';
import { AuthMailDto } from './dto/auth-mail.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { ChallengeDto } from './dto/challenge.dto';
import { MergeResponseDto } from './dto/merge-response.dto';
import { RedirectResponseDto } from './dto/redirect-response.dto';
import { SignMessageDto } from './dto/sign-message.dto';
import { VerifySignMessageDto } from './dto/verify-sign-message.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly albyService: AuthAlbyService,
    private readonly mergeService: AccountMergeService,
    private readonly userRepo: UserRepository,
  ) {}

  @Post()
  @UseGuards(IpCountryGuard, OptionalJwtAuthGuard)
  @ApiCreatedResponse({ type: AuthResponseDto })
  authenticate(@GetJwt() jwt: JwtPayload, @Body() dto: SignUpDto, @RealIP() ip: string): Promise<AuthResponseDto> {
    return this.authService.authenticate(dto, ip, jwt?.account);
  }

  @Post('signUp')
  @UseGuards(RateLimitGuard, IpCountryGuard)
  @Throttle(20, 864000)
  @ApiCreatedResponse({ type: AuthResponseDto })
  signUp(@Body() dto: SignUpDto, @RealIP() ip: string): Promise<AuthResponseDto> {
    return this.authService.signUp(dto, ip);
  }

  @Post('signIn')
  @UseGuards(IpCountryGuard)
  @ApiCreatedResponse({ type: AuthResponseDto })
  signIn(@Body() credentials: SignInDto, @RealIP() ip: string): Promise<AuthResponseDto> {
    return this.authService.signIn(credentials, ip);
  }

  @Post('mail')
  @ApiCreatedResponse()
  signInByMail(@Body() dto: AuthMailDto, @Req() req: Request, @RealIP() ip: string): Promise<void> {
    return this.authService.signInByMail(dto, req.url, ip);
  }

  @Get('mail/redirect')
  @ApiExcludeEndpoint()
  async redirectMail(@Query('code') code: string, @RealIP() ip: string): Promise<RedirectResponseDto> {
    return { redirectUrl: await this.authService.completeSignInByMail(code, ip) };
  }

  @Get('mail/confirm')
  @ApiBearerAuth()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiExcludeEndpoint()
  @ApiOkResponse({ type: MergeResponseDto })
  async executeMerge(
    @GetJwt() jwt: JwtPayload,
    @Query('code') code: string,
    @RealIP() ip: string,
  ): Promise<MergeResponseDto> {
    const { master } = await this.mergeService.executeMerge(code);
    let accessToken: string;

    if (jwt) {
      if (jwt.user) {
        const newUser = await this.userRepo.findOne({
          where: { userData: { id: master.id }, address: jwt.address },
          relations: { userData: true, wallet: true },
        });

        accessToken = this.authService.generateUserToken(newUser, ip);
      } else {
        accessToken = this.authService.generateAccountToken(master, ip);
      }
    }

    return {
      kycHash: master.kycHash,
      accessToken,
    };
  }

  @Get('signMessage')
  @ApiOkResponse({ type: SignMessageDto })
  getSignMessage(@Query('address') address: string): SignMessageDto {
    return this.authService.getSignInfo(address);
  }

  @Get('verifySignature')
  @ApiExcludeEndpoint()
  verifySignMessage(
    @Query('address') address: string,
    @Query('message') message: string,
    @Query('signature') signature: string,
  ): Promise<VerifySignMessageDto> {
    return this.authService.verifyMessageSignature(address, message, signature);
  }

  @Get('challenge')
  @ApiOkResponse({ type: ChallengeDto })
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
}
