import { Controller, Post, UseGuards, Body, Get, Query } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { DbQueryDto } from './dto/db-query.dto';
import { SupportReturnData } from './dto/support-return-data.dto';
import { GsService } from './gs.service';

@Controller('gs')
export class GsController {
  constructor(private readonly gsService: GsService) {}

  @Post('db')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.SUPPORT))
  async getRawData(@Body() query: DbQueryDto): Promise<any> {
    return await this.gsService.getRawData(query);
  }

  @Get('support')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.SUPPORT))
  async getSupportData(@Query('id') id: string): Promise<SupportReturnData> {
    return await this.gsService.getSupportData(+id);
  }
}
