import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { MonitoringService } from './monitoring.service';

@ApiTags('monitoring')
@Controller('monitoring')
export class MonitoringController {
  constructor(private monitoringService: MonitoringService) {}

  @Get('state')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getSystemState(
    @Query('subsystem') subsystem: string,
    @Query('metric') metric: string,
    @Query('refresh') refresh: boolean,
  ): Promise<any> {
    return await this.monitoringService.getState(subsystem, metric, refresh);
  }

  @Get('state/history')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getSystemStateHistory(
    @Query('subsystem') subsystem: string,
    @Query('metric') metric: string,
    @Query('from') from: Date,
    @Query('to') to: Date,
  ): Promise<any> {
    return await this.monitoringService.getStateHistory(subsystem, metric, from, to);
  }

  @Post('data')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async recordData(
    @Query('subsystem') subsystem: string,
    @Query('metric') metric: string,
    @Body() data: unknown,
  ): Promise<any> {
    return await this.monitoringService.recordData(subsystem, metric, data);
  }
}
