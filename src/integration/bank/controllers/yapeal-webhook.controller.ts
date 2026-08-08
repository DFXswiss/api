import { Body, Controller, ForbiddenException, Headers, Post } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { Config } from 'src/config/config';
import { YapealWebhookService } from '../services/yapeal-webhook.service';

@ApiTags('Bank')
@Controller('bank/yapeal')
export class YapealWebhookController {
  constructor(private readonly yapealWebhookService: YapealWebhookService) {}

  @Post('webhook')
  @ApiExcludeEndpoint()
  async handleYapealWebhook(
    @Headers('x-api-key') apiKey: string,
    @Body() payload: any,
  ): Promise<{ received: boolean }> {
    this.validateApiKey(apiKey);

    await this.yapealWebhookService.processWebhook(payload);

    return { received: true };
  }

  private validateApiKey(apiKey: string): void {
    const expectedKey = Config.bank.yapeal.webhookApiKey;

    // fail closed: a missing expected key must reject every request, not wave them all through —
    // this endpoint marks bank payments as received, so any unauthenticated path is forgeable
    if (!expectedKey || !apiKey || apiKey !== expectedKey) {
      throw new ForbiddenException('Invalid API key');
    }
  }
}
