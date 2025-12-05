import { Body, Controller, ForbiddenException, Headers, Post } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { Config } from 'src/config/config';
import { YapealWebhookPayloadDto } from 'src/integration/bank/dto/yapeal-webhook.dto';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { YapealBankTxService } from '../services/yapeal-bank-tx.service';

@ApiTags('Webhook')
@Controller('webhook')
export class YapealWebhookController {
  private readonly logger = new DfxLogger(YapealWebhookController);

  constructor(private readonly yapealBankTxService: YapealBankTxService) {}

  @Post('yapeal')
  @ApiExcludeEndpoint()
  async handleYapealWebhook(
    @Headers('x-yapeal-signature') signature: string,
    @Body() payload: YapealWebhookPayloadDto,
  ): Promise<{ received: boolean }> {
    // Verify webhook signature if secret is configured
    const webhookSecret = Config.bank.yapeal.webhookSecret;
    if (webhookSecret && !this.verifySignature(payload, signature, webhookSecret)) {
      this.logger.warn('Invalid YAPEAL webhook signature');
      throw new ForbiddenException('Invalid webhook signature');
    }

    this.logger.info(`Received YAPEAL webhook: ${payload.eventType} - ${payload.eventUid}`);

    try {
      await this.yapealBankTxService.processWebhook(payload);
      return { received: true };
    } catch (e) {
      this.logger.error('Failed to process YAPEAL webhook:', e);
      throw e;
    }
  }

  private verifySignature(payload: YapealWebhookPayloadDto, signature: string, secret: string): boolean {
    if (!signature) return false;

    // TODO: Implement actual YAPEAL signature verification once documentation is available
    // This is a placeholder - YAPEAL likely uses HMAC-SHA256 or similar
    // For now, just check that a signature is present
    return signature.length > 0 && secret.length > 0;
  }
}
