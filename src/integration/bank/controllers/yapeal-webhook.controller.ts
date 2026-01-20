import { Body, Controller, Delete, ForbiddenException, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiExcludeEndpoint, ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { Config } from 'src/config/config';
import { YapealWebhookService } from '../services/yapeal-webhook.service';
import { YapealSubscription } from '../dto/yapeal.dto';
import { YapealService } from '../services/yapeal.service';

@ApiTags('Bank')
@Controller('bank/yapeal')
export class YapealWebhookController {
  constructor(
    private readonly yapealWebhookService: YapealWebhookService,
    private readonly yapealService: YapealService,
  ) {}

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
    if (!expectedKey) return;

    if (!apiKey || apiKey !== expectedKey) {
      throw new ForbiddenException('Invalid API key');
    }
  }

  // --- SUBSCRIPTION MANAGEMENT (Admin only) --- //

  @Get('subscription')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN))
  async getSubscriptions(): Promise<YapealSubscription[]> {
    return this.yapealService.getTransactionSubscriptions();
  }

  @Post('subscription/:iban')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN))
  async createSubscription(@Param('iban') iban: string): Promise<YapealSubscription> {
    return this.yapealService.createTransactionSubscription(iban);
  }

  @Delete('subscription/:iban')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN))
  async deleteSubscription(@Param('iban') iban: string): Promise<void> {
    return this.yapealService.deleteTransactionSubscription(iban);
  }
}
