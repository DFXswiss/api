import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { KycService } from './kyc.service';

@Injectable()
export class SchedulerService {
  constructor(private kycService: KycService) {}

  @Interval(300000)
  async handleCron() {
    await this.kycService.chatBotCheck();
  }
}
