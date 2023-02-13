import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { MonitoringService } from './monitoring.service';
import { SystemState, SubsystemState, Metric } from './system-state-snapshot.entity';

@ApiTags('monitoring')
@Controller('monitoring')
export class MonitoringController {
  constructor(private monitoringService: MonitoringService) {}

  @Get('data')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getSystemState(
    @Query('subsystem') subsystem: string,
    @Query('metric') metric: string,
  ): Promise<SystemState | SubsystemState | Metric> {
    return this.monitoringService.getState(subsystem, metric);
  }

  @Post('data')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async onWebhook(
    @Query('subsystem') subsystem: string,
    @Query('metric') metric: string,
    @Body() data: unknown,
  ): Promise<void> {
    return this.monitoringService.onWebhook(subsystem, metric, data);
  }
}
