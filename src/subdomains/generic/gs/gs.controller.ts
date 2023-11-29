import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { DbFileQueryDto, DbQueryBaseDto, DbQueryDto, DbReturnData } from './dto/db-query.dto';
import { SupportDataQuery, SupportReturnData } from './dto/support-data.dto';
import { GsService } from './gs.service';

@Controller('gs')
export class GsController {
  constructor(private readonly gsService: GsService) {}

  @Post('db')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getDbData(@Body() query: DbQueryDto): Promise<DbReturnData> {
    return this.gsService.getDbData(query);
  }

  @Post('db/files')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getDbUserFileData(@Body() query: DbFileQueryDto): Promise<DbReturnData> {
    return this.gsService.getDbUserFileData(query);
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
