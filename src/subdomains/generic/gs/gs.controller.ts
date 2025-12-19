import { BadRequestException, Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint } from '@nestjs/swagger';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
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
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async getDbData(@GetJwt() jwt: JwtPayload, @Body() query: DbQueryDto): Promise<DbReturnData> {
    try {
      return await this.gsService.getDbData(query, jwt.role);
    } catch (e) {
      this.logger.verbose(`DB data call for ${query.table} in ${query.identifier} failed:`, e);
      throw new BadRequestException(e.message);
    }
  }

  @Post('db/custom')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async getExtendedData(@GetJwt() jwt: JwtPayload, @Body() query: DbQueryBaseDto): Promise<DbReturnData> {
    return this.gsService.getExtendedDbData(query, jwt.role);
  }

  @Get('support')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.SUPPORT), UserActiveGuard())
  async getSupportData(@Query() query: SupportDataQuery): Promise<SupportReturnData> {
    return this.gsService.getSupportData(query);
  }
}
