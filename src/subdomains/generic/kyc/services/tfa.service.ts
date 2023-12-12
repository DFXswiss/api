import { ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { generateSecret, verifyToken } from 'node-2fa';
import { Config, Process } from 'src/config/config';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { KycLogType } from 'src/subdomains/generic/kyc/enums/kyc.enum';
import { TfaLogRepository } from 'src/subdomains/generic/kyc/repositories/tfa-log.repository';
import { UserData } from '../../user/models/user-data/user-data.entity';
import { UserDataService } from '../../user/models/user-data/user-data.service';
import { Setup2faDto } from '../dto/output/setup-2fa.dto';

export interface SecretCacheEntry {
  secret: string;
  creationTime: number;
}

@Injectable()
export class TfaService {
  private secretCache: Map<number, SecretCacheEntry> = new Map();

  constructor(private readonly tfaRepo: TfaLogRepository, private readonly userDataService: UserDataService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  @Lock()
  processCleanupSecretCache() {
    if (Config.processDisabled(Process.TFA_CACHE)) return;

    const before5MinTime = Util.minutesBefore(5).getTime();

    const keysToBeDeleted = Array.from(this.secretCache.entries())
      .filter(([_, v]) => v.creationTime < before5MinTime)
      .map(([k, _]) => k);

    keysToBeDeleted.forEach((k) => this.secretCache.delete(k));
  }

  async setup(kycHash: string): Promise<Setup2faDto> {
    const user = await this.getUser(kycHash);
    if (user.totpSecret || this.secretCache.has(user.id)) throw new ConflictException('2FA already set up');

    const { secret, uri } = generateSecret({ name: 'DFX.swiss', account: user.mail ?? '' });

    this.secretCache.set(user.id, {
      secret,
      creationTime: Date.now(),
    });

    return { secret, uri };
  }

  async delete(kycHash: string, ip: string): Promise<void> {
    const user = await this.getUser(kycHash);
    await this.userDataService.updateTotpSecret(user, null);

    await this.createTfaLog(user, ip, 'deleted');
  }

  async verify(kycHash: string, token: string, ip: string): Promise<void> {
    const user = await this.getUser(kycHash);

    const secret = user.totpSecret ?? this.secretCache.get(user.id)?.secret;
    if (!secret) throw new NotFoundException('2FA not set up');

    this.verifyOrThrow(user.totpSecret, token);

    if (!user.totpSecret) {
      await this.userDataService.updateTotpSecret(user, secret);
      this.secretCache.delete(user.id);
    }

    await this.createTfaLog(user, ip, 'verified');
  }

  private verifyOrThrow(secret: string, token: string): void {
    const result = verifyToken(secret, token);
    if (!result || result.delta !== 0) throw new UnauthorizedException('Invalid or expired 2FA token');
  }

  // --- HELPER METHODS --- //
  private async createTfaLog(user: UserData, ip: string, message: string) {
    const logEntity = this.tfaRepo.create({
      type: KycLogType.TFA,
      ipAddress: ip,
      userData: user,
      comment: message,
    });

    await this.tfaRepo.save(logEntity);
  }

  private async getUser(kycHash: string): Promise<UserData> {
    return this.userDataService.getByKycHashOrThrow(kycHash, { users: true });
  }
}
