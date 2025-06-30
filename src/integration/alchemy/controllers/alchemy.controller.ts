import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  InternalServerErrorException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { DfxLogger } from 'src/logger/dfx-logger.service';
import { LoggerFactory } from 'src/logger/logger.factory';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { AlchemySyncTransactionsDto } from '../dto/alchemy-sync-transactions.dto';
import { AlchemyWebhookDto } from '../dto/alchemy-webhook.dto';
import { AlchemyWebhookService } from '../services/alchemy-webhook.service';
import { AlchemyService } from '../services/alchemy.service';

@ApiTags('Alchemy')
@Controller('alchemy')
export class AlchemyController {
  private readonly logger: DfxLogger;

  constructor(
    readonly loggerFactory: LoggerFactory,
    private readonly alchemyWebhookService: AlchemyWebhookService,
    private readonly alchemyService: AlchemyService,
  ) {
    this.logger = loggerFactory.create(AlchemyController);
  }

  @Post('addressWebhook')
  @ApiExcludeEndpoint()
  async addressWebhook(@Headers('X-Alchemy-Signature') alchemySignature: string, @Req() req: Request): Promise<void> {
    try {
      const dto = JSON.parse(req.body) as AlchemyWebhookDto;

      if (!this.alchemyWebhookService.isValidWebhookSignature(alchemySignature, dto.webhookId, req.body)) {
        this.logger.warn(`Received Alchemy webhook with invalid signature '${alchemySignature}': ${req.body}`);
        throw new BadRequestException('Invalid signature');
      }

      return this.alchemyWebhookService.processAddressWebhook(dto);
    } catch (e) {
      if (e instanceof BadRequestException) throw e;

      this.logger.error('addressWebhook failed:', e);
      throw new InternalServerErrorException('addressWebhook failed');
    }
  }

  @Post('syncTransactions')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async syncTransactions(@Body() dto: AlchemySyncTransactionsDto) {
    return this.alchemyService.syncTransactions(dto);
  }

  @Get('addresses/:webhookId')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async addresses(@Param('webhookId') webhookId: string): Promise<string[]> {
    const limit = 100;
    let addressActivityResponse = await this.alchemyWebhookService.getWebhookAddresses(webhookId, { limit });
    let pageKey = addressActivityResponse.pageKey;

    const allAddresses = addressActivityResponse.addresses;

    while (pageKey) {
      addressActivityResponse = await this.alchemyWebhookService.getWebhookAddresses(webhookId, { pageKey, limit });
      pageKey = addressActivityResponse.pageKey;

      allAddresses.push(...addressActivityResponse.addresses);
    }

    return allAddresses;
  }
}
