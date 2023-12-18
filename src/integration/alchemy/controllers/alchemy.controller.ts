import { Body, Controller, Post } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { AlchemyWebhookDto } from '../dto/alchemy-webhook.dto';
import { AlchemyWebhookService } from '../services/alchemy-webhook.service';

@ApiTags('Alchemy')
@Controller('alchemy')
export class AlchemyController {
  private readonly logger = new DfxLogger(AlchemyController);

  constructor(private readonly alchemyWebhookService: AlchemyWebhookService) {}

  @Post('addressWebhook')
  @ApiExcludeEndpoint()
  async addressWebhook(@Body() dto: AlchemyWebhookDto): Promise<void> {
    this.alchemyWebhookService.processAddressWebhook(dto);
  }
}
