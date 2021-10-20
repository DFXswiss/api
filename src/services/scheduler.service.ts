import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { NodeService } from 'src/ain/node/node.service';
import { MailService } from 'src/shared/services/mail.service';
import { CfpService } from '../statistic/cfp.service';
import { KycService } from '../user/services/kyc.service';

@Injectable()
export class SchedulerService {
  constructor(
    private readonly kycService: KycService,
    private readonly cfpService: CfpService,
    private readonly nodeService: NodeService,
    private readonly mailService: MailService,
  ) {}

  @Interval(300000)
  async chatBot() {
    try {
      await this.kycService.doChatBotCheck();
      await this.kycService.doAddressCheck();
      await this.kycService.doOnlineIdCheck();
      await this.kycService.doVideoIdentCheck();
    } catch (e) {
      console.error('Exception during KYC checks:', e);
    }
  }

  @Interval(600000)
  async updateCfp() {
    this.cfpService.doUpdate();
  }

  @Interval(3600000)
  async checkNodes() {
    const errors = await this.nodeService.checkNodes();
    if (errors.length > 0) {
      console.error(`Node errors: ${errors}`);
      await this.mailService.sendNodeErrorMail(errors);
    }
  }
}
