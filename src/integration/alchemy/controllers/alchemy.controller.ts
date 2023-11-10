import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AddressActivityResponse, GetAllWebhooksResponse } from 'alchemy-sdk';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { CreateWebhookDto } from '../dto/alchemy-create-webhook.dto';
import { AlchemyWebhookDto } from '../dto/alchemy-webhook.dto';
import { AlchemyWebhookService } from '../services/alchemy-webhook.service';

@ApiTags('Alchemy')
@Controller('alchemy')
export class AlchemyController {
  private readonly logger = new DfxLogger(AlchemyController);

  constructor(private readonly alchemyWebhookService: AlchemyWebhookService) {}

  @Get('webhooks')
  async getAllWebhooks(): Promise<GetAllWebhooksResponse> {
    return this.alchemyWebhookService.getAllWebhooks();
  }

  @Get('webhookAddresses/:id')
  async getWebhookAddresses(@Param('id') id: string): Promise<AddressActivityResponse> {
    return this.alchemyWebhookService.getWebhookAddresses(id);
  }

  @Post('createAddressWebhook')
  async createAddressWebhook(@Body() dto: CreateWebhookDto) {
    return this.alchemyWebhookService.createAddressWebhook(dto);
  }

  @Post('addressWebhook')
  //@ApiExcludeEndpoint()
  async addressWebhook(@Body() dto: AlchemyWebhookDto): Promise<void> {
    this.alchemyWebhookService.processAddressWebhook(dto);
  }
}
