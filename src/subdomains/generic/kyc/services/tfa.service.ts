import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  forwardRef,
} from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { generateSecret, verifyToken } from 'node-2fa';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { TfaLogRepository } from 'src/subdomains/generic/kyc/repositories/tfa-log.repository';
import { MailContext, MailType } from 'src/subdomains/supporting/notification/enums';
import { MailKey, MailTranslationKey } from 'src/subdomains/supporting/notification/factories/mail.factory';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { MoreThan } from 'typeorm';
import { UserData } from '../../user/models/user-data/user-data.entity';
import { UserDataService } from '../../user/models/user-data/user-data.service';
import { Setup2faDto, TfaType } from '../dto/output/setup-2fa.dto';

const TfaValidityHours = 24;
const TfaMaxTryCount = 5;

interface SecretCacheEntry {
  type: TfaType;
  secret: string;
  expiryDate: Date;
  tryCount: number;
}

export enum TfaLevel {
  BASIC = 'Basic',
  STRICT = 'Strict',
}

@Injectable()
export class TfaService {
  private readonly logger = new DfxLogger(TfaService);

  private readonly secretCache: Map<number, SecretCacheEntry> = new Map();

  constructor(
    private readonly tfaRepo: TfaLogRepository,
    @Inject(forwardRef(() => UserDataService)) private readonly userDataService: UserDataService,
    private readonly notificationService: NotificationService,
  ) {}

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.TFA_CACHE })
  processCleanupSecretCache() {
    const now = new Date();

    const keysToBeDeleted = Array.from(this.secretCache.entries())
      .filter(([_, v]) => v.expiryDate < now)
      .map(([k, _]) => k);

    keysToBeDeleted.forEach((k) => this.secretCache.delete(k));
  }

  async setup(kycHash: string, level: TfaLevel): Promise<Setup2faDto> {
    const user = await this.getUser(kycHash);
    if (user.isBlockedOrDeactivated) throw new ForbiddenException('Account is blocked/deactivated');

    if (user.mail && (level === TfaLevel.BASIC || user.users.length > 0)) {
      // mail 2FA
      const type = TfaType.MAIL;
      const secret = Util.randomId().toString().slice(0, 6);
      const codeExpiryMinutes = 30;

      this.secretCache.set(user.id, {
        type,
        secret,
        expiryDate: Util.minutesAfter(codeExpiryMinutes),
        tryCount: 0,
      });

      // send mail
      await this.sendVerificationMail(user, secret, codeExpiryMinutes, MailContext.VERIFICATION_MAIL);

      return { type };
    } else {
      // app 2FA
      if (user.totpSecret) throw new ConflictException('2FA already set up');

      const type = TfaType.APP;
      const { secret, uri } = generateSecret({ name: 'DFX.swiss', account: user.mail ?? '' });

      this.secretCache.set(user.id, {
        type,
        secret,
        expiryDate: Util.hoursAfter(3),
        tryCount: 0,
      });

      return { type, secret, uri };
    }
  }

  async verify(kycHash: string, token: string, ip: string): Promise<void> {
    const user = await this.getUser(kycHash);

    let level: TfaLevel;
    let type: TfaType;

    const cacheEntry = this.secretCache.get(user.id);

    if (cacheEntry?.tryCount >= TfaMaxTryCount) {
      this.secretCache.delete(user.id);
      throw new ForbiddenException('Invalid or expired 2FA token');
    }

    try {
      if (cacheEntry?.type === TfaType.MAIL) {
        if (token !== cacheEntry.secret) throw new ForbiddenException('Invalid or expired 2FA token');

        level = user.users.length > 0 ? TfaLevel.STRICT : TfaLevel.BASIC;
        type = TfaType.MAIL;
      } else {
        const secret = user.totpSecret ?? cacheEntry?.secret;
        if (!secret) throw new NotFoundException('2FA not set up');

        this.verifyOrThrow(secret, token);

        if (!user.totpSecret) await this.userDataService.updateTotpSecret(user, secret);

        level = TfaLevel.STRICT;
        type = TfaType.APP;
      }
    } catch (e) {
      if (cacheEntry) cacheEntry.tryCount++;

      throw e;
    }

    this.secretCache.delete(user.id);
    await this.createTfaLog(user, ip, level, type);
  }

  async check(userDataId: number, ip: string, level?: TfaLevel): Promise<void> {
    const userData = await this.userDataService.getUserData(userDataId);
    if (!userData) throw new NotFoundException('User data not found');

    await this.checkVerification(userData, ip, level);
  }

  async checkVerification(user: UserData, ip: string, level?: TfaLevel) {
    const allowedLevels = level === TfaLevel.STRICT ? [TfaLevel.STRICT] : [TfaLevel.BASIC, TfaLevel.STRICT];
    const logs = await this.tfaRepo.findBy({
      userData: { id: user.id },
      ipAddress: ip,
      created: MoreThan(Util.hoursBefore(TfaValidityHours)),
    });

    const isVerified = logs.some(
      (log) => allowedLevels.some((l) => log.comment.includes(l)) || log.comment === 'Verified', // TODO: remove compatibility code
    );
    if (!isVerified) throw new ForbiddenException(`2FA required${level ? ` (${level.toLowerCase()})` : ''}`);
  }

  // --- HELPER METHODS --- //
  async sendVerificationMail(
    userData: UserData,
    code: string,
    expirationMinutes: number,
    context: MailContext.VERIFICATION_MAIL | MailContext.EMAIL_VERIFICATION,
  ): Promise<void> {
    try {
      const tag = context === MailContext.VERIFICATION_MAIL ? 'default' : 'email';

      if (userData.mail)
        await this.notificationService.sendMail({
          type: MailType.USER_V2,
          context,
          input: {
            userData: userData,
            wallet: userData.wallet,
            title: `${MailTranslationKey.VERIFICATION_CODE}.${tag}.title`,
            salutation: {
              key: `${MailTranslationKey.VERIFICATION_CODE}.${tag}.salutation`,
            },
            texts: [
              {
                key: `${MailTranslationKey.VERIFICATION_CODE}.message`,
                params: { code },
              },
              { key: MailKey.SPACE, params: { value: '2' } },
              {
                key: `${MailTranslationKey.VERIFICATION_CODE}.closing`,
                params: { expiration: `${expirationMinutes}` },
              },
              { key: MailKey.SPACE, params: { value: '4' } },
              { key: MailKey.DFX_TEAM_CLOSING },
            ],
          },
        });
    } catch (e) {
      this.logger.error(`Failed to send verification mail ${userData.id}:`, e);
      throw new ServiceUnavailableException('Failed to send verification mail');
    }
  }

  private verifyOrThrow(secret: string, token: string): void {
    const result = verifyToken(secret, token);
    if (!result || ![0, -1].includes(result.delta)) {
      this.logger.verbose(`2FA verify failed, ${!result ? 'token mismatch' : 'delta is ' + result.delta}`);
      throw new ForbiddenException('Invalid or expired 2FA token');
    }
  }

  private async createTfaLog(userData: UserData, ipAddress: string, level: TfaLevel, type: TfaType) {
    const logEntity = this.tfaRepo.create({
      ipAddress,
      userData,
      comment: `${level} (${type})`,
    });

    await this.tfaRepo.save(logEntity);
  }

  private async getUser(kycHash: string): Promise<UserData> {
    return this.userDataService.getByKycHashOrThrow(kycHash, { users: true });
  }
}
