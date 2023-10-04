import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { secp256k1 } from '@noble/curves/secp256k1';
import { randomBytes } from 'crypto';
import { Config, Process } from 'src/config/config';
import { LightningHelper } from 'src/integration/lightning/lightning-helper';
import { IpLogService } from 'src/shared/models/ip-log/ip-log.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { AuthService } from 'src/subdomains/generic/user/models/auth/auth.service';
import {
  AuthLnurlResponseDto,
  AuthLnurlResponseStatus,
  AuthLnurlSignupDto,
} from 'src/subdomains/generic/user/models/auth/dto/auth-lnurl.dto';

export interface AuthCacheDto {
  k1: string;
  k1CreationTime: number;
  accessToken?: string;
  accessTokenCreationTime?: number;
}

@Injectable()
export class AuthLnUrlService {
  private readonly logger = new DfxLogger(AuthLnUrlService);

  private authCache: Map<string, AuthCacheDto> = new Map();

  constructor(private readonly authService: AuthService, private readonly ipLogService: IpLogService) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  @Lock()
  processCleanupAccessToken() {
    if (Config.processDisabled(Process.LNURL_AUTH_CACHE)) return;

    const before30SecTime = Util.secondsBefore(30).getTime();

    const entriesToBeUpdated = [...this.authCache.entries()].filter(
      (k) => k[1].accessTokenCreationTime < before30SecTime,
    );

    entriesToBeUpdated.forEach((e) => {
      e[1].accessToken = undefined;
      e[1].accessTokenCreationTime = undefined;
    });
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  @Lock()
  processCleanupAuthCache() {
    if (Config.processDisabled(Process.LNURL_AUTH_CACHE)) return;

    const before5MinTime = Util.minutesBefore(5).getTime();

    const keysToBeDeleted = [...this.authCache.entries()]
      .filter((k) => k[1].k1CreationTime < before5MinTime)
      .map((k) => k[0]);

    keysToBeDeleted.forEach((k) => this.authCache.delete(k));
  }

  createLoginLnurl(): string {
    const k1 = Util.createHash(randomBytes(32));
    this.authCache.set(k1, { k1: k1, k1CreationTime: Date.now() });

    return LightningHelper.encodeLnurl(`${Config.url}/lnurla?tag=login&k1=${k1}&action=login`);
  }

  async checkSignature(
    userIp: string,
    requestUrl: string,
    signupDto: AuthLnurlSignupDto,
  ): Promise<AuthLnurlResponseDto> {
    const ipLog = await this.ipLogService.create(userIp, requestUrl, signupDto.address);
    if (!ipLog.result) throw new ForbiddenException('The country of IP address is not allowed');

    const checkSignupResponse = this.checkSignupDto(signupDto);
    if (checkSignupResponse) return checkSignupResponse;

    try {
      const k1 = signupDto.k1;
      const signature = signupDto.sig;
      const key = signupDto.key;

      const verifyResult = secp256k1.verify(signature, k1, key);
      if (!verifyResult) return AuthLnurlResponseDto.createError('invalid auth signature');

      const authCacheEntry = this.authCache.get(k1);
      authCacheEntry.accessToken = await this.signIn(signupDto, userIp);
      authCacheEntry.accessTokenCreationTime = Date.now();

      return AuthLnurlResponseDto.createOk();
    } catch (e) {
      this.logger.error('Failed to login with LNURL auth:', e);
      return { status: AuthLnurlResponseStatus.ERROR, reason: 'invalid signature' };
    }
  }

  private checkSignupDto(signupDto: AuthLnurlSignupDto): AuthLnurlResponseDto | undefined {
    if ('login' !== signupDto.tag) return AuthLnurlResponseDto.createError('tag not found');
    if ('login' !== signupDto.action) return AuthLnurlResponseDto.createError('action not found');

    const k1 = signupDto.k1;
    if (!k1) return AuthLnurlResponseDto.createError('challenge not found');

    const signature = signupDto.sig;
    if (!signature) return AuthLnurlResponseDto.createError('auth signature not found');

    const key = signupDto.key;
    if (!key) return AuthLnurlResponseDto.createError('key not found');

    const authCacheEntry = this.authCache.get(k1);
    if (!authCacheEntry) return AuthLnurlResponseDto.createError('challenge invalid');

    const checkBeforeTime = Util.minutesBefore(5).getTime();
    if (authCacheEntry.k1CreationTime < checkBeforeTime) return AuthLnurlResponseDto.createError('challenge expired');
  }

  async signIn(signupDto: AuthLnurlSignupDto, userIp: string): Promise<string> {
    signupDto.wallet = 'DFX Bitcoin';

    const session = { address: signupDto.address, signature: signupDto.signature };

    const { accessToken } = await this.authService.signIn(session, true).catch((e) => {
      if (e instanceof NotFoundException) return this.authService.signUp({ ...signupDto, ...session }, userIp, true);
      throw e;
    });

    return accessToken;
  }

  getStatus(k1: string, signature: string, key: string): string {
    const authCacheEntry = this.authCache.get(k1);
    if (!authCacheEntry) return '';

    const verifyResult = secp256k1.verify(signature, k1, key);
    if (!verifyResult) return '';

    return authCacheEntry.accessToken ?? '';
  }
}
