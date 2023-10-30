import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AddressActivityResponse, GetAllWebhooksResponse } from 'alchemy-sdk';
import fs from 'fs';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { CreateWebhookDto } from '../dto/alchemy-create-webhook.dto';
import { AlchemyService } from '../services/alchemy.service';

@ApiTags('Alchemy')
@Controller('alchemy')
export class AlchemyController {
  private readonly logger = new DfxLogger(AlchemyController);

  constructor(private readonly alchemyService: AlchemyService) {}

  @Get('webhooks')
  async getAllWebhooks(): Promise<GetAllWebhooksResponse> {
    return this.alchemyService.getAllWebhooks();
  }

  @Get('webhookAddresses/:id')
  async getWebhookAddresses(@Param('id') id: string): Promise<AddressActivityResponse> {
    return this.alchemyService.getWebhookAddresses(id);
  }

  @Post('createAddressWebhook')
  async createAddressWebhook(@Body() dto: CreateWebhookDto) {
    return this.alchemyService.createAddressWebhook(dto);
  }

  @Post('addressWebhook')
  async addressWebhook(@Body() webhookData: any) {
    this.logger.info('alchemyAddressWebhook()');
    this.logger.info(JSON.stringify(webhookData));

    const timestamp = Date.now();

    fs.writeFileSync(
      `C:/Data/Entwicklung/workspace-2022/tmp/addressWebhook-${timestamp}.json`,
      JSON.stringify(webhookData),
    );
  }
}
