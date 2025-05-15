import { BadRequestException, Body, Controller, Headers, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
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
  async addressWebhook(@Headers('X-Alchemy-Signature') alchemySignature: string, @Req() req: Request): Promise<void> {
    const dto = JSON.parse(req.body) as AlchemyWebhookDto;

    if (!this.alchemyWebhookService.isValidWebhookSignature(alchemySignature, dto.webhookId, req.body)) {
      this.logger.warn(`Received Alchemy webhook with invalid signature '${alchemySignature}': ${JSON.stringify(dto)}`);
      throw new BadRequestException('Invalid signature');
    }

    return this.alchemyWebhookService.processAddressWebhook(dto);
  }

  @Post('syncTransactions')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard)
  async syncTransactions(@Body() dto: AlchemySyncTransactionsDto) {
    return this.alchemyService.syncTransactions(dto);
  }
}
