import { Body, Controller, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { UserGuard } from 'src/shared/auth/user.guard';
import { DepositService } from './deposit.service';
import { CreateDepositDto } from './dto/create-deposit.dto';

@ApiTags('deposit')
@Controller('deposit')
export class DepositController {
  constructor(private readonly depositService: DepositService) {}

  @Post()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN), UserGuard)
  async createDeposits(@Body() dto: CreateDepositDto): Promise<void> {
    await this.depositService.createDeposits(dto);
  }

  @Put('lightningWebhook')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN), UserGuard)
  async updateLightningDepositWebhook(): Promise<void> {
    await this.depositService.updateLightningDepositWebhook();
  }
}
