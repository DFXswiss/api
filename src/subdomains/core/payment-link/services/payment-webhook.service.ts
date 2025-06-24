import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { DfxLoggerService } from 'src/shared/services/dfx-logger.service';
import { HttpService } from 'src/shared/services/http.service';
import { QueueHandler } from 'src/shared/utils/queue-handler';
import { Util } from 'src/shared/utils/util';
import { PaymentLinkDtoMapper } from '../dto/payment-link-dto.mapper';
import { PaymentLink } from '../entities/payment-link.entity';

@Injectable()
export class PaymentWebhookService {
  private readonly webhookSendQueue: QueueHandler;

  constructor(private readonly http: HttpService, private readonly logger: DfxLoggerService) {
    this.webhookSendQueue = QueueHandler.createParallelQueueHandler(10);
    this.logger.create(PaymentWebhookService);
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
      const payload = JSON.stringify(dto);
      const signature = this.createSignature(payload);

      await this.http.post(dto.webhookUrl, dto, {
        retryDelay: 5000,
        tryCount: 12,
        headers: {
          'X-Payload-Signature': signature,
          'Content-Type': 'application/json',
        },
      });
    }
  }

  private createSignature(payload: string): string {
    const privateKey = Config.payment.webhookPrivateKey;
    if (!privateKey) {
      throw new Error('Webhook private key is not configured');
    }

    const payloadHash = Util.createHash(payload);
    return Util.createSign(payloadHash, privateKey);
  }
}
