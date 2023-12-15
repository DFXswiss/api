import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { generateSecret, generateToken, verifyToken } from 'node-2fa';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { KycLogType } from 'src/subdomains/generic/kyc/enums/kyc.enum';
import { TfaLogRepository } from 'src/subdomains/generic/kyc/repositories/tfa-log.repository';
import { UserData } from '../user-data/user-data.entity';
import { UserDataRepository } from '../user-data/user-data.repository';

export interface SecretCacheDto {
  kycHash: string;
  creationTime: number;
  totp: {
    secret: string;
    uri: string;
    qr: string;
  };
}

@Injectable()
export class AuthTotpService {
  private secretCache: Map<string, SecretCacheDto> = new Map();

  constructor(private readonly tfaLogRepo: TfaLogRepository, private readonly userDataRepository: UserDataRepository) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  @Lock()
  processCleanupSecretCache() {
    if (DisabledProcess(Process.TFA_CACHE)) return;

    const before5MinTime = Util.minutesBefore(5).getTime();

    const keysToBeDeleted = [...this.secretCache.entries()]
      .filter((s) => s[1].creationTime < before5MinTime)
      .map((s) => s[0]);

    keysToBeDeleted.forEach((s) => this.secretCache.delete(s));
  }

  async createSecret(kycHash: string): Promise<{ secret: string; uri: string }> {
    const secretCacheEntry = this.secretCache.get(kycHash);
    if (secretCacheEntry) throw new ConflictException('totp secret already cached');

    const userData = await this.getUserData(kycHash);
    if (userData.totpSecret) throw new ConflictException('totp secret already exists');

    const issuer = 'DFX.swiss';
    const secret = generateSecret({ name: issuer, account: userData.mail ?? '' });
    if (!secret.secret) throw new NotFoundException('secret not found');

    this.secretCache.set(kycHash, {
      kycHash: kycHash,
      creationTime: Date.now(),
      totp: secret,
    });

    return {
      secret: secret.secret,
      uri: secret.uri,
    };
  }

  async deleteSecret(kycHash: string, ip: string): Promise<void> {
    await this.userDataRepository.update({ kycHash: kycHash }, { totpSecret: null });

    await this.createTotpAuthLog(kycHash, ip, 'deleted');
  }

  async createToken(kycHash: string): Promise<string | undefined> {
    const userData = await this.getUserData(kycHash);
    if (!userData.totpSecret) return;

    const token = generateToken(userData.totpSecret);
    return token ? token.token : null;
  }

  async verifyToken(kycHash: string, token: string, ip: string): Promise<boolean> {
    const secretCacheEntry = this.secretCache.get(kycHash);
    if (secretCacheEntry) return this.verifyFirstTime(kycHash, token, secretCacheEntry, ip);

    const userData = await this.getUserData(kycHash);
    if (!userData.totpSecret) return false;

    return this.verify(userData.totpSecret, token);
  }

  private async verifyFirstTime(
    kycHash: string,
    token: string,
    secretCacheEntry: SecretCacheDto,
    ip: string,
  ): Promise<boolean> {
    const verifyResult = this.verify(secretCacheEntry.totp.secret, token);

    if (verifyResult) {
      await this.userDataRepository.update(
        { kycHash: secretCacheEntry.kycHash },
        { totpSecret: secretCacheEntry.totp.secret },
      );

      this.secretCache.delete(secretCacheEntry.kycHash);

      await this.createTotpAuthLog(kycHash, ip, 'created');
    }

    return verifyResult;
  }

  private verify(secret: string, token: string): boolean {
    const verifyResult = verifyToken(secret, token);
    if (!verifyResult) return false;

    const delta = verifyResult.delta;
    return delta === 0;
  }

  private async getUserData(kycHash: string): Promise<UserData> {
    const userDataEntity = await this.userDataRepository.findOneBy({ kycHash });
    if (!userDataEntity) throw new NotFoundException(`Unknown kyc hash ${kycHash}`);

    return userDataEntity;
  }

  // --- HELPER METHODS --- //
  private async createTotpAuthLog(kycHash: string, ip: string, message: string) {
    const logEntity = this.tfaLogRepo.create({
      type: KycLogType.TFA,
      ipAddress: ip,
      userData: await this.getUserData(kycHash),
      comment: message,
    });

    await this.tfaLogRepo.save(logEntity);
  }
}
