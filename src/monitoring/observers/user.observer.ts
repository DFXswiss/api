import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { MetricObserver } from 'src/monitoring/metric.observer';
import { MonitoringService } from 'src/monitoring/monitoring.service';
import { Util } from 'src/shared/util';
import { SpiderDataRepository } from 'src/user/models/spider-data/spider-data.repository';
import { KycStatus, IdentCompletedStates } from 'src/user/models/user-data/user-data.entity';
import { UserDataRepository } from 'src/user/models/user-data/user-data.repository';
import { User, UserStatus } from 'src/user/models/user/user.entity';
import { UserRepository } from 'src/user/models/user/user.repository';
import { getCustomRepository, LessThan, IsNull, In } from 'typeorm';

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
  constructor(monitoringService: MonitoringService) {
    super(monitoringService, 'user', 'userData');
  }

  @Interval(60000)
  async fetch() {
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
      kycStatusData[kycStatus] = await getCustomRepository(UserDataRepository).count({
        where: [
          {
            kycStatus,
            kycStatusChangeDate: LessThan(date),
          },
          {
            kycStatus,
            kycStatusChangeDate: IsNull(),
          },
        ],
      });
    }

    return kycStatusData;
  }

  private async getUserWithout(): Promise<UserWithout> {
    return {
      ipCountry: await getCustomRepository(UserRepository).count({ where: { ipCountry: IsNull() } }),
      riskState: await getCustomRepository(UserDataRepository)
        .createQueryBuilder('userData')
        .leftJoin(User, 'user', 'userData.id = user.userDataId')
        .where('user.status != :status', { status: UserStatus.NA })
        .andWhere('userData.riskState is NULL')
        .getCount(),
      pdfUrl: await getCustomRepository(SpiderDataRepository).count({
        where: { identPdf: IsNull(), userData: { kycStatus: In(IdentCompletedStates) } },
        relations: ['userData'],
      }),
    };
  }
}
