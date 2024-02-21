import { BadRequestException, Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DbQueryBaseDto, DbQueryDto, DbReturnData } from './dto/db-query.dto';
import { SupportDataQuery, SupportReturnData } from './dto/support-data.dto';
import { GsService } from './gs.service';

@Controller('gs')
export class GsController {
  private readonly logger = new DfxLogger(GsController);

  constructor(private readonly gsService: GsService) {}

  @Post('db')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getDbData(@Body() query: DbQueryDto): Promise<DbReturnData> {
    try {
      return await this.gsService.getDbData(query);
    } catch (e) {
      this.logger.verbose(`DB data call for ${query.table} failed:`, e);
      throw new BadRequestException(e.message);
    }
  }

  @Post('db/custom')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getExtendedData(@Body() query: DbQueryBaseDto): Promise<DbReturnData> {
    return this.gsService.getExtendedDbData(query);
  }

  @Get('support')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.SUPPORT))
  async getSupportData(@Query() query: SupportDataQuery): Promise<SupportReturnData> {
    return this.gsService.getSupportData(query);
  }
}
