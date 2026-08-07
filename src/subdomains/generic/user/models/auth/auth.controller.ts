import {
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiExcludeEndpoint,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { AllowTfaPending } from 'src/shared/auth/allow-tfa-pending.decorator';
import { RealIP } from 'src/shared/auth/real-ip.decorator';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { IpCountryGuard } from 'src/shared/auth/ip-country.guard';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { OptionalJwtAuthGuard } from 'src/shared/auth/optional.guard';
import { RateLimitGuard } from 'src/shared/auth/rate-limit.guard';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { Util } from 'src/shared/utils/util';
import { Start2faDto } from 'src/subdomains/generic/kyc/dto/input/start-2fa.dto';
import { Verify2faDto } from 'src/subdomains/generic/kyc/dto/input/verify-2fa.dto';
import { Setup2faDto } from 'src/subdomains/generic/kyc/dto/output/setup-2fa.dto';
import { TfaService } from 'src/subdomains/generic/kyc/services/tfa.service';
import { JobDtoMapper } from 'src/subdomains/supporting/job/dto/job-dto.mapper';
import { JobDto } from 'src/subdomains/supporting/job/dto/job.dto';
import { Job } from 'src/subdomains/supporting/job/entities/job.entity';
import { JobGroup, JobStatus } from 'src/subdomains/supporting/job/enums';
import { JobDispatcherService } from 'src/subdomains/supporting/job/services/job-dispatcher.service';
import { JobService } from 'src/subdomains/supporting/job/services/job.service';
import { AccountMergeJobOutput } from '../account-merge/account-merge-job.handler';
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

// A confirmation link is a one-time ticket, not a standing credential: once the merge is complete,
// its result (and the fresh access token that comes with it) may only be collected within this
// window. A polling client re-hits this endpoint every few seconds and gives up after at most ten
// minutes; fifteen minutes covers that fully. Past the window the link behaves exactly as it did
// before this asynchronous path existed — already completed, nothing more to hand out.
const MERGE_RESULT_WINDOW_MINUTES = 15;

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
    private readonly jobService: JobService,
    private readonly jobDispatcher: JobDispatcherService,
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
  @AllowTfaPending()
  @ApiBearerAuth()
  @ApiOkResponse({ description: '2FA active' })
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT), UserActiveGuard())
  async check2fa(@GetJwt() jwt: JwtPayload, @RealIP() ip: string, @Query() { level }: Start2faDto): Promise<void> {
    return this.tfaService.check(jwt.account, ip, level);
  }

  @Post('2fa')
  @AllowTfaPending()
  @ApiBearerAuth()
  @ApiCreatedResponse({ type: Setup2faDto })
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT), UserActiveGuard())
  async setup2fa(@GetJwt() jwt: JwtPayload, @Query() { level }: Start2faDto): Promise<Setup2faDto> {
    const { kycHash } = await this.userDataService.getUserData(jwt.account);
    // A wallet-signature login has no tfaRequired marker (trusted); a mail-elevated staff token has it (not trusted).
    // Trusted origin = a wallet-signature login: no tfaRequired marker AND a real wallet address on the token.
    // The account-token fallback (staff enforcement off, or a wallet-less staff user) carries neither, so it
    // cannot self-enroll a staff TOTP factor from a mail inbox.
    return this.tfaService.setup(kycHash, level, !jwt.tfaRequired && !!jwt.address);
  }

  @Post('2fa/verify')
  @AllowTfaPending()
  @ApiBearerAuth()
  @ApiCreatedResponse({ description: '2FA successful' })
  @UseGuards(RateLimitGuard, AuthGuard(), RoleGuard(UserRole.ACCOUNT), UserActiveGuard())
  @Throttle(10, 60)
  async verify2fa(@GetJwt() jwt: JwtPayload, @RealIP() ip: string, @Body() dto: Verify2faDto): Promise<void> {
    const { kycHash } = await this.userDataService.getUserData(jwt.account);
    return this.tfaService.verify(kycHash, dto.token, ip, !jwt.tfaRequired && !!jwt.address);
  }

  @Get('mail/confirm')
  @ApiBearerAuth()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiExcludeEndpoint()
  @ApiOkResponse({ type: MergeResponseDto })
  @ApiAcceptedResponse({ type: JobDto })
  async executeMerge(
    @GetJwt() jwt: JwtPayload | undefined,
    @Query('code') code: string,
    @RealIP() ip: string,
    @Headers('traceparent') traceparent: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MergeResponseDto | JobDto> {
    // 404/400 are a contract with existing clients and must come back synchronously, before any
    // job is enqueued.
    const request = await this.mergeService.validateForExecution(code);
    const master = this.mergeService.getMaster(request);

    // The request id is the idempotency key: the same confirmation link never enqueues twice, and
    // a polling client always hits the same job.
    const idempotencyKey = `merge:${request.id}`;
    const existingJob = await this.jobService.findByIdempotencyKey(JobGroup.ACCOUNT_MERGE, idempotencyKey);
    if (existingJob) {
      if (
        existingJob.status === JobStatus.COMPLETE &&
        Util.minutesDiff(existingJob.finishedAt) > MERGE_RESULT_WINDOW_MINUTES
      ) {
        throw new ConflictException('Merge request is already completed');
      }

      return this.waitForJobResult(existingJob, master, jwt, ip, res);
    }

    // Completed before this job mechanism existed: no job row was ever written, so there is no
    // result to return — a genuine conflict for that legacy case.
    if (request.isCompleted) {
      throw new ConflictException('Merge request is already completed');
    }

    const job = await this.jobService.enqueue(
      JobGroup.ACCOUNT_MERGE,
      idempotencyKey,
      { code },
      { userData: master, traceparent },
    );
    this.jobDispatcher.kick(JobGroup.ACCOUNT_MERGE);

    return this.waitForJobResult(job, master, jwt, ip, res);
  }

  private async waitForJobResult(
    job: Job,
    master: UserData,
    jwt: JwtPayload | undefined,
    ip: string,
    res: Response,
  ): Promise<MergeResponseDto | JobDto> {
    // Bounded well under the second that is the response-time target: most merges still get
    // today's synchronous-looking answer, only the long tail turns into a ticket.
    const pollDeadline = Date.now() + 900;
    let current = job;
    while (!current.isFinished && Date.now() < pollDeadline) {
      await Util.delay(100);
      const found = await this.jobService.getByUid(job.uid);
      if (!found) throw new Error(`Job ${job.uid} not found during poll`);
      current = found;
    }

    if (current.status === JobStatus.COMPLETE) {
      const output = current.outputData as AccountMergeJobOutput;
      const accessToken = jwt
        ? await this.createAccessTokenAfterMerge(master, jwt.address, ip, jwt.tfaRequired)
        : undefined;

      res.status(HttpStatus.OK);
      return { kycHash: output.kycHash, accessToken };
    }

    // Still running, or ended FAILED/DEAD_LETTER: the status code marks that the job was
    // accepted, the DTO's own status field carries the outcome.
    const config = await this.jobService.getConfig(JobGroup.ACCOUNT_MERGE);
    res.status(HttpStatus.ACCEPTED);
    return JobDtoMapper.mapJob(current, config);
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
