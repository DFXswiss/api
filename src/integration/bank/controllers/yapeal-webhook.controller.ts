import { Body, Controller, ForbiddenException, Headers, Post } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { Config } from 'src/config/config';
import { YapealWebhookPayloadDto } from '../dto/yapeal-webhook.dto';
import { YapealWebhookService } from '../services/yapeal-webhook.service';

@ApiTags('Bank')
@Controller('bank/yapeal')
export class YapealWebhookController {
  constructor(private readonly yapealWebhookService: YapealWebhookService) {}

  @Post('webhook')
  @ApiExcludeEndpoint()
  handleYapealWebhook(
    @Headers('x-yapeal-signature') signature: string,
    @Body() payload: YapealWebhookPayloadDto,
  ): { received: boolean } {
    const webhookSecret = Config.bank.yapeal.webhookSecret;
    if (webhookSecret && !this.verifySignature(signature, webhookSecret)) {
      throw new ForbiddenException('Invalid webhook signature');
    }

    this.yapealWebhookService.processWebhook(payload);
    return { received: true };
  }

  private verifySignature(signature: string, secret: string): boolean {
    if (!signature) return false;

    // TODO: Implement actual YAPEAL signature verification once documentation is available
    return signature.length > 0 && secret.length > 0;
  }
}
