import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { secp256k1 } from '@noble/curves/secp256k1';
import { randomBytes } from 'crypto';
import { Config } from 'src/config/config';
import { LightningHelper } from 'src/integration/lightning/lightning-helper';
import { IpLogService } from 'src/shared/models/ip-log/ip-log.service';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { AuthService } from 'src/subdomains/generic/user/models/auth/auth.service';
import {
  AuthLnurlCreateLoginResponseDto,
  AuthLnurlResponseStatus,
  AuthLnurlSignInResponseDto,
  AuthLnurlSignupDto,
  AuthLnurlStatusResponseDto,
} from 'src/subdomains/generic/user/models/auth/dto/auth-lnurl.dto';

export interface AuthCacheDto {
  servicesIp: string;
  servicesUrl: string;
  k1: string;
  k1CreationTime: number;
  accessToken?: string;
  accessTokenCreationTime?: number;
}

@Injectable()
export class AuthLnUrlService {
  private authCache: Map<string, AuthCacheDto> = new Map();

  constructor(private readonly authService: AuthService, private readonly ipLogService: IpLogService) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  @Lock()
  processCleanupAccessToken() {
    if (DisabledProcess(Process.LNURL_AUTH_CACHE)) return;

    const before30SecTime = Util.secondsBefore(30).getTime();

    const keysToBeDeleted = [...this.authCache.entries()]
      .filter((k) => k[1].accessTokenCreationTime < before30SecTime)
      .map((k) => k[0]);

    keysToBeDeleted.forEach((k) => this.authCache.delete(k));
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  @Lock()
  processCleanupAuthCache() {
    if (DisabledProcess(Process.LNURL_AUTH_CACHE)) return;

    const before5MinTime = Util.minutesBefore(5).getTime();

    const keysToBeDeleted = [...this.authCache.entries()]
      .filter((k) => k[1].k1CreationTime < before5MinTime)
      .map((k) => k[0]);

    keysToBeDeleted.forEach((k) => this.authCache.delete(k));
  }

  create(servicesIp: string, servicesUrl: string): AuthLnurlCreateLoginResponseDto {
    const k1 = Util.createHash(randomBytes(32));

    this.authCache.set(k1, {
      servicesIp: servicesIp,
      servicesUrl: servicesUrl,
      k1: k1,
      k1CreationTime: Date.now(),
    });

    const url = new URL(`${Config.url()}/lnurla`);
    url.searchParams.set('tag', 'login');
    url.searchParams.set('action', 'login');
    url.searchParams.set('k1', k1);

    return { k1: k1, lnurl: LightningHelper.encodeLnurl(url.toString()) };
  }

  async login(signupDto: AuthLnurlSignupDto, userIp: string): Promise<AuthLnurlSignInResponseDto> {
    const checkSignupResponse = this.checkSignupDto(signupDto);

    if (checkSignupResponse) {
      this.authCache.delete(signupDto.k1);
      return checkSignupResponse;
    }

    const { k1, sig, key, address } = signupDto;

    const authCacheEntry = this.authCache.get(k1);
    const { servicesIp, servicesUrl } = authCacheEntry;

    const ipLog = await this.ipLogService.create(servicesIp, servicesUrl, address, signupDto.specialCode);

    if (!ipLog.result) {
      this.authCache.delete(k1);
      throw new ForbiddenException('The country of IP address is not allowed');
    }

    try {
      const verifyResult = secp256k1.verify(sig, k1, key);
      if (!verifyResult) return AuthLnurlSignInResponseDto.createError('invalid auth signature');

      authCacheEntry.accessToken = await this.signIn(signupDto, servicesIp, userIp);
      authCacheEntry.accessTokenCreationTime = Date.now();

      return AuthLnurlSignInResponseDto.createOk();
    } catch (e) {
      return { status: AuthLnurlResponseStatus.ERROR, reason: e.message ?? 'invalid signup' };
    }
  }

  private checkSignupDto(signupDto: AuthLnurlSignupDto): AuthLnurlSignInResponseDto | undefined {
    if ('login' !== signupDto.tag) return AuthLnurlSignInResponseDto.createError('invalid tag');
    if ('login' !== signupDto.action) return AuthLnurlSignInResponseDto.createError('invalid action');

    const authCacheEntry = this.authCache.get(signupDto.k1);
    if (!authCacheEntry) return AuthLnurlSignInResponseDto.createError('invalid challenge');

    const checkBeforeTime = Util.minutesBefore(5).getTime();
    if (authCacheEntry.k1CreationTime < checkBeforeTime)
      return AuthLnurlSignInResponseDto.createError('challenge expired');
  }

  async signIn(signupDto: AuthLnurlSignupDto, servicesIp: string, userIp: string): Promise<string> {
    const session = { address: signupDto.address, signature: signupDto.signature };

    const { accessToken } = await this.authService.signIn(session, userIp, true).catch((e) => {
      if (e instanceof NotFoundException)
        return this.authService.signUp(
          { ...session, usedRef: signupDto.usedRef, wallet: signupDto.wallet ?? 'DFX Bitcoin' },
          servicesIp,
        );
      throw e;
    });

    return accessToken;
  }

  status(k1: string): AuthLnurlStatusResponseDto {
    const authCacheEntry = this.authCache.get(k1);
    if (!authCacheEntry) throw new NotFoundException('k1 not found');

    const accessToken = authCacheEntry.accessToken;
    if (!accessToken) return { isComplete: false };

    this.authCache.delete(k1);

    return { isComplete: true, accessToken: accessToken };
  }
}
