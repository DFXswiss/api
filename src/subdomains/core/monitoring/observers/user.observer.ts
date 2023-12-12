import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RepositoryFactory } from 'src/shared/repositories/repository.factory';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { MetricObserver } from 'src/subdomains/core/monitoring/metric.observer';
import { MonitoringService } from 'src/subdomains/core/monitoring/monitoring.service';
import { IdentCompletedStates, KycStatus } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { User, UserStatus } from 'src/subdomains/generic/user/models/user/user.entity';
import { In, IsNull, LessThan } from 'typeorm';

interface UserData {
  kycStatus: {
    all: Record<KycStatus, number>;
    longer24h: Record<KycStatus, number>;
  };
  userWithout: UserWithout;
}

interface UserWithout {
  ipCountry: number;
  riskState: number;
  pdfUrl: number;
}

@Injectable()
export class UserObserver extends MetricObserver<UserData> {
  protected readonly logger = new DfxLogger(UserObserver);

  constructor(monitoringService: MonitoringService, private readonly repos: RepositoryFactory) {
    super(monitoringService, 'user', 'kyc');
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  @Lock(1800)
  async fetch(): Promise<UserData> {
    if (DisabledProcess(Process.MONITORING)) return;

    const data = await this.getUser();

    this.emit(data);

    return data;
  }

  // *** HELPER METHODS *** //

  private async getUser(): Promise<UserData> {
    return {
      kycStatus: {
        all: await this.getKycStatusData(),
        longer24h: await this.getKycStatusData(Util.daysBefore(1)),
      },
      userWithout: await this.getUserWithout(),
    };
  }

  private async getKycStatusData(date: Date = new Date()): Promise<any> {
    const kycStatusData = {};
    for (const kycStatus of Object.values(KycStatus)) {
      kycStatusData[kycStatus] = await this.repos.userData.countBy([
        {
          kycStatus,
          kycStatusChangeDate: LessThan(date),
        },
        {
          kycStatus,
          kycStatusChangeDate: IsNull(),
        },
      ]);
    }

    return kycStatusData;
  }

  private async getUserWithout(): Promise<UserWithout> {
    return {
      ipCountry: await this.repos.user.countBy({ ipCountry: IsNull() }),
      riskState: await this.repos.userData
        .createQueryBuilder('userData')
        .leftJoin(User, 'user', 'userData.id = user.userDataId')
        .where('user.status != :status', { status: UserStatus.NA })
        .andWhere('userData.riskState is NULL')
        .getCount(),
      pdfUrl: await this.repos.spiderData.count({
        where: { identPdf: IsNull(), userData: { kycStatus: In(IdentCompletedStates) } },
        relations: ['userData'],
      }),
    };
  }
}
