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
  handleYapealWebhook(@Headers('x-api-key') apiKey: string, @Body() payload: any): { received: boolean } {
    this.validateApiKey(apiKey);

    this.yapealWebhookService.processWebhook(payload);

    return { received: true };
  }

  private validateApiKey(apiKey: string): void {
    const expectedKey = Config.bank.yapeal.webhookApiKey;
    if (!expectedKey) return;

    if (!apiKey || apiKey !== expectedKey) {
      throw new ForbiddenException('Invalid API key');
    }
  }
}
