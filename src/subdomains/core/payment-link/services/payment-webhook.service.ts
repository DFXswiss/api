import { Injectable } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { HttpService } from 'src/shared/services/http.service';
import { QueueHandler } from 'src/shared/utils/queue-handler';
import { PaymentLinkDtoMapper } from '../dto/payment-link-dto.mapper';
import { PaymentLink } from '../entities/payment-link.entity';

@Injectable()
export class PaymentWebhookService {
  private readonly logger = new DfxLogger(PaymentWebhookService);

  private webhookSendQueue: QueueHandler;

  constructor(private readonly http: HttpService) {
    this.webhookSendQueue = new QueueHandler();
  }

  async sendWebhook(paymentLink: PaymentLink): Promise<void> {
    this.webhookSendQueue
      .handle<void>(async () => this.doSendWebhook(paymentLink))
      .catch((e) => {
        this.logger.error(`Exception during webhook for payment link ${paymentLink.uniqueId}:`, e);
      });
  }

  private async doSendWebhook(paymentLink: PaymentLink) {
    const dto = PaymentLinkDtoMapper.toLinkDto(paymentLink);

    if (dto.webhookUrl) {
      await this.http.post(dto.webhookUrl, dto, {
        retryDelay: 5000,
        tryCount: 12,
      });
    }
  }
}
