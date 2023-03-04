import { Controller, Post, UseGuards, Body, Get, Query } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { DbQueryBaseDto, DbQueryDto } from './dto/db-query.dto';
import { SupportDataQuery, SupportReturnData } from './dto/support-data.dto';
import { GsService } from './gs.service';

@Controller('gs')
export class GsController {
  constructor(private readonly gsService: GsService) {}

  @Post('db')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getRawData(@Body() query: DbQueryDto): Promise<{
    keys: string[];
    values: any;
  }> {
    return this.gsService.getRawData(query);
  }

  @Post('db/custom')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getExtendedData(@Body() query: DbQueryBaseDto): Promise<{
    keys: string[];
    values: any;
  }> {
    return this.gsService.getExtendedData(query);
  }

  @Get('support')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.SUPPORT))
  async getSupportData(@Query() query: SupportDataQuery): Promise<SupportReturnData> {
    return this.gsService.getSupportData(query);
  }
}
