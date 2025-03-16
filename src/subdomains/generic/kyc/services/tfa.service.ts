import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  forwardRef
} from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import {
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import base64url from 'base64url';
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

interface SecretCacheEntry {
  type: TfaType;
  secret: string;
  expiryDate: Date;
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
  ) { }

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
    let type: TfaType;
    let secret: string;
    let uri: string;
    if (user.mail && (level === TfaLevel.BASIC || user.users.length > 0)) {
      // mail 2FA
      type = TfaType.MAIL;
      secret = Util.randomId().toString().slice(0, 6);
      const codeExpiryMinutes = 30;

      this.secretCache.set(user.id, {
        type,
        secret,
        expiryDate: Util.minutesAfter(codeExpiryMinutes),
      });

      // send mail
      await this.sendVerificationMail(user, secret, codeExpiryMinutes, MailContext.VERIFICATION_MAIL);

      return { type };
    } else {
      // 2FA app or passkey
      const generated = generateSecret({ name: 'DFX.swiss', account: user.mail ?? '' });

      if (user.publicPasskey) {
        // passkey already set up
        type = TfaType.PASSKEY;
        secret = generated.secret;
        this.secretCache.set(user.id, {
          type,
          secret,
          expiryDate: Util.hoursAfter(3),
        });
      } else if (user.totpSecret) {
        // 2FA already set up
        type = TfaType.APP;
      } else {
        type = TfaType.UNDEFINED;
        secret = generated.secret;
        uri = generated.uri;
        this.secretCache.set(user.id, {
          type,
          secret,
          expiryDate: Util.hoursAfter(3),
        });
      }
    }

    return { type, secret, uri };
  }

  async verify(kycHash: string, token: string, ip: string): Promise<void> {
    const user = await this.getUser(kycHash);

    let level: TfaLevel;
    let type: TfaType;

    const cacheEntry = this.secretCache.get(user.id);

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

  async setupPasskey(kycHash: string, creds: {
    id: string;
    rawId: string;
    attestationObject: string;
    clientDataJSON: string;
  }): Promise<void> {
    const user = await this.getUser(kycHash);
    const expectedChallenge = this.secretCache.get(user.id);

    const verification = await verifyRegistrationResponse({
      response: {
        id: creds.id,
        rawId: creds.rawId,
        response: {
          attestationObject: creds.attestationObject,
          clientDataJSON: creds.clientDataJSON,
        },
        type: 'public-key',
        clientExtensionResults: {},
      },
      expectedChallenge: expectedChallenge.secret,
      expectedOrigin: 'https://dfx.swiss',
      expectedRPID: 'dfx.swiss',
    });

    if (!verification.verified) {
      throw new ForbiddenException('Passkey setup failed');
    }

    const { credential } = verification.registrationInfo!;

    user.publicPasskey = base64url.encode(Buffer.from(credential.publicKey));
    user.signCount = credential.counter;

    await this.userDataService.updateUserData(user.id, user);
  }

  async verifyPasskey(kycHash: string, credential: {
    id: string;
    rawId: string;
    authenticatorData: string;
    clientDataJSON: string;
    signature: string;
    userHandle: string | null;
  }): Promise<void> {
    const user = await this.getUser(kycHash);
    const expectedChallenge = this.secretCache.get(user.id);

    const verification = await verifyAuthenticationResponse({
      response: {
        id: credential.id,
        rawId: credential.rawId,
        response: {
          authenticatorData: credential.authenticatorData,
          clientDataJSON: credential.clientDataJSON,
          signature: credential.signature,
          userHandle: credential.userHandle ? credential.userHandle : undefined,
        },
        type: 'public-key',
        clientExtensionResults: {},
      },
      expectedChallenge: expectedChallenge.secret,
      expectedOrigin: 'https://dfx.swiss',
      expectedRPID: 'dfx.swiss',
      credential: {
        id: credential.rawId,
        publicKey: base64url.toBuffer(user.publicPasskey),
        counter: user.signCount,
      },
    });

    if (!verification.verified) {
      throw new ForbiddenException('Invalid or expired passkey');
    }

    // Update counter to prevent replay attacks
    user.signCount = verification.authenticationInfo!.newCounter;
    await this.userDataService.updateUserData(user.id, user);
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
          type: MailType.USER,
          context,
          input: {
            userData: userData,
            wallet: userData.wallet,
            title: `${MailTranslationKey.VERIFICATION_CODE}.${tag}.title`,
            salutation: {
              key: `${MailTranslationKey.VERIFICATION_CODE}.${tag}.salutation`,
            },
            suffix: [
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
