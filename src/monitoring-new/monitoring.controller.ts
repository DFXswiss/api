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
  async getSystemState(@Query('subsystem') subsystem: string, @Query('metric') metric: string): Promise<any> {
    return await this.monitoringService.getState(subsystem, metric);
  }

  @Post('state')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async onWebhook(
    @Query('subsystem') subsystem: string,
    @Query('metric') metric: string,
    @Body() data: unknown,
  ): Promise<any> {
    return await this.monitoringService.onWebhook(subsystem, metric, data);
  }
}
