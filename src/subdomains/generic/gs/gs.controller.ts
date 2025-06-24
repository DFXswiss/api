import { BadRequestException, Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { DfxLoggerService } from 'src/shared/services/dfx-logger.service';
import { DbQueryBaseDto, DbQueryDto, DbReturnData } from './dto/db-query.dto';
import { SupportDataQuery, SupportReturnData } from './dto/support-data.dto';
import { GsService } from './gs.service';

@Controller('gs')
export class GsController {
  constructor(private readonly gsService: GsService, private readonly logger: DfxLoggerService) {
    this.logger.create(GsController);
  }

  @Post('db')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async getDbData(@Body() query: DbQueryDto): Promise<DbReturnData> {
    const startTime = Date.now();

    try {
      return await this.gsService.getDbData(query);
    } catch (e) {
      this.logger.verbose(`DB data call for ${query.table} in ${query.identifier} failed:`, e);
      throw new BadRequestException(e.message);
    } finally {
      const runTime = Date.now() - startTime;

      if (runTime > 1000 * 3) {
        this.logger.info(`Endpoint Runtime: ${runTime} with query ${JSON.stringify(query)}`);
      }
    }
  }

  @Post('db/custom')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async getExtendedData(@Body() query: DbQueryBaseDto): Promise<DbReturnData> {
    return this.gsService.getExtendedDbData(query);
  }

  @Get('support')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.SUPPORT), UserActiveGuard())
  async getSupportData(@Query() query: SupportDataQuery): Promise<SupportReturnData> {
    return this.gsService.getSupportData(query);
  }
}
