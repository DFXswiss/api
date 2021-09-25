import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { CfpService } from './cfp.service';
import { KycService } from './kyc.service';

@Injectable()
export class SchedulerService {
  constructor(private kycService: KycService, private cfpService: CfpService) {}

  @Interval(300000)
  async chatBot() {
    await this.kycService.doChatBotCheck();
    await this.kycService.doAddressCheck();
    await this.kycService.doOnlineIdCheck();
  }

  @Interval(600000)
  async updateCfp() {
    this.cfpService.doUpdate();
  }
}
