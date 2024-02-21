import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { AlchemySyncTransactionsDto } from '../dto/alchemy-sync-transactions.dto';
import { AlchemyWebhookDto } from '../dto/alchemy-webhook.dto';
import { AlchemyWebhookService } from '../services/alchemy-webhook.service';
import { AlchemyService } from '../services/alchemy.service';

@ApiTags('Alchemy')
@Controller('alchemy')
export class AlchemyController {
  private readonly logger = new DfxLogger(AlchemyController);

  constructor(
    private readonly alchemyWebhookService: AlchemyWebhookService,
    private readonly alchemyService: AlchemyService,
  ) {}

  @Post('addressWebhook')
  @ApiExcludeEndpoint()
  async addressWebhook(@Body() dto: AlchemyWebhookDto): Promise<void> {
    this.alchemyWebhookService.processAddressWebhook(dto);
  }

  @Post('syncTransactions')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async syncTransactions(@Body() dto: AlchemySyncTransactionsDto) {
    return this.alchemyService.syncTransactions(dto);
  }
}
