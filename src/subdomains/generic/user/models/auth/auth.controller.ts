import { Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiCreatedResponse, ApiExcludeEndpoint, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { RealIP } from 'src/shared/auth/real-ip.decorator';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { IpCountryGuard } from 'src/shared/auth/ip-country.guard';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { OptionalJwtAuthGuard } from 'src/shared/auth/optional.guard';
import { RateLimitGuard } from 'src/shared/auth/rate-limit.guard';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { Start2faDto } from 'src/subdomains/generic/kyc/dto/input/start-2fa.dto';
import { Verify2faDto } from 'src/subdomains/generic/kyc/dto/input/verify-2fa.dto';
import { Setup2faDto } from 'src/subdomains/generic/kyc/dto/output/setup-2fa.dto';
import { TfaService } from 'src/subdomains/generic/kyc/services/tfa.service';
import { AccountMergeService } from '../account-merge/account-merge.service';
import { UserDataService } from '../user-data/user-data.service';
import { UserData } from '../user-data/user-data.entity';
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
    private readonly userDataService: UserDataService,
    private readonly tfaService: TfaService,
  ) {}

  @Post()
  @UseGuards(IpCountryGuard, OptionalJwtAuthGuard)
  @ApiCreatedResponse({ type: AuthResponseDto })
  authenticate(
    @GetJwt() jwt: JwtPayload | undefined,
    @Body() dto: SignUpDto,
    @RealIP() ip: string,
  ): Promise<AuthResponseDto> {
    return this.authService.authenticate(dto, ip, jwt?.account, jwt?.user);
  }

  @Post('signUp')
  @UseGuards(RateLimitGuard, IpCountryGuard)
  @Throttle(100, 86400)
  @ApiCreatedResponse({ type: AuthResponseDto })
  @ApiExcludeEndpoint()
  signUp(@Body() dto: SignUpDto, @RealIP() ip: string): Promise<AuthResponseDto> {
    return this.authService.signUp(dto, ip);
  }

  @Post('signIn')
  @UseGuards(IpCountryGuard)
  @ApiCreatedResponse({ type: AuthResponseDto })
  @ApiExcludeEndpoint()
  signIn(@Body() credentials: SignInDto, @RealIP() ip: string): Promise<AuthResponseDto> {
    return this.authService.signIn(credentials, ip);
  }

  @Post('mail')
  @UseGuards(RateLimitGuard)
  @Throttle(10, 60)
  @ApiCreatedResponse()
  signInByMail(@Body() dto: AuthMailDto, @Req() req: Request, @RealIP() ip: string): Promise<void> {
    return this.authService.signInByMail(dto, req.url, ip);
  }

  @Get('mail/redirect')
  @ApiExcludeEndpoint()
  async redirectMail(@Query('code') code: string, @RealIP() ip: string): Promise<RedirectResponseDto> {
    return { redirectUrl: await this.authService.completeSignInByMail(code, ip) };
  }

  // --- 2FA (JWT-based) --- //
  // Lets a logged-in user (e.g. staff who reached a staff endpoint and got TFA_REQUIRED) set up and
  // verify 2FA via their session token, resolving the kycHash from jwt.account. Reuses TfaService.
  @Get('2fa')
  @ApiBearerAuth()
  @ApiOkResponse({ description: '2FA active' })
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT), UserActiveGuard())
  async check2fa(@GetJwt() jwt: JwtPayload, @RealIP() ip: string, @Query() { level }: Start2faDto): Promise<void> {
    return this.tfaService.check(jwt.account, ip, level);
  }

  @Post('2fa')
  @ApiBearerAuth()
  @ApiCreatedResponse({ type: Setup2faDto })
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT), UserActiveGuard())
  async setup2fa(@GetJwt() jwt: JwtPayload, @Query() { level }: Start2faDto): Promise<Setup2faDto> {
    const { kycHash } = await this.userDataService.getUserData(jwt.account);
    return this.tfaService.setup(kycHash, level);
  }

  @Post('2fa/verify')
  @ApiBearerAuth()
  @ApiCreatedResponse({ description: '2FA successful' })
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT), UserActiveGuard())
  async verify2fa(@GetJwt() jwt: JwtPayload, @RealIP() ip: string, @Body() dto: Verify2faDto): Promise<void> {
    const { kycHash } = await this.userDataService.getUserData(jwt.account);
    return this.tfaService.verify(kycHash, dto.token, ip);
  }

  @Get('mail/confirm')
  @ApiBearerAuth()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiExcludeEndpoint()
  @ApiOkResponse({ type: MergeResponseDto })
  async executeMerge(
    @GetJwt() jwt: JwtPayload | undefined,
    @Query('code') code: string,
    @RealIP() ip: string,
  ): Promise<MergeResponseDto> {
    const { master } = await this.mergeService.executeMerge(code);

    const accessToken = jwt
      ? await this.createAccessTokenAfterMerge(master, jwt.address, ip, jwt.tfaRequired)
      : undefined;

    return {
      kycHash: master.kycHash,
      accessToken,
    };
  }

  private async createAccessTokenAfterMerge(
    userData: UserData,
    address: string | undefined,
    ip: string,
    tfaRequired = false,
  ): Promise<string | undefined> {
    // create user token, if the user is known
    if (address) {
      const user = await this.userRepo.findOne({
        where: { userData: { id: userData.id }, address },
        relations: { userData: true, wallet: true },
      });

      // forward tfaRequired so a re-minted token keeps the mail-origin 2FA marker (see generateUserToken)
      if (user) return this.authService.generateUserToken(user, ip, tfaRequired);
    }

    return this.authService.generateAccountToken(userData, ip);
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
