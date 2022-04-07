import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CryptoStakingService } from 'src/payment/models/crypto-staking/crypto-staking.service';
import { MasternodeService } from 'src/payment/models/masternode/masternode.service';

@Injectable()
export class MonitoringService {
  constructor(private cryptoStakingService: CryptoStakingService, private masternodeService: MasternodeService) {}
  // --- VOLUMES --- //
  @Cron('0****')
  async checkBalance(): Promise<void> {
    this.cryptoStakingService.update({ annualVolume: Not(0) }, { annualVolume: 0 });
  }
}
