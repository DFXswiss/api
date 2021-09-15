import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { KycService } from './kyc.service';

@Injectable()
export class SchedulerService {
  constructor(private kycService: KycService) {}
  private readonly logger = new Logger(SchedulerService.name);

  @Interval(5000)
  async handleCron() {
    await this.kycService.chatBotCheck();
  }
}
