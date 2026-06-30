import { BadRequestException, Body, Controller, ForbiddenException, Get, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint } from '@nestjs/swagger';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { DbQueryBaseDto, DbQueryDto, DbReturnData } from './dto/db-query.dto';
import { DebugQueryDto, DebugQueryResult } from './dto/debug-query.dto';
import { LogQueryDto, LogQueryResult } from './dto/log-query.dto';
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
    if (DisabledProcess(Process.GS_DB)) throw new ForbiddenException('Endpoint disabled');

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
    if (DisabledProcess(Process.GS_DB)) throw new ForbiddenException('Endpoint disabled');

    return this.gsService.getExtendedDbData(query, jwt.role);
  }

  @Get('support')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.SUPPORT), UserActiveGuard())
  async getSupportData(@Query() query: SupportDataQuery): Promise<SupportReturnData> {
    return this.gsService.getSupportData(query);
  }

  // Structured debug endpoint. Takes a JSON description of the query (table, select, where,
  // group/order/limit) and emits SQL via QueryBuilder with parameter binding — no raw SQL is
  // accepted, parsed, or interpolated.
  @Post('debug')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.DEBUG), UserActiveGuard())
  async executeDebugQuery(@GetJwt() jwt: JwtPayload, @Body() dto: DebugQueryDto): Promise<DebugQueryResult> {
    if (DisabledProcess(Process.GS_DEBUG)) throw new ForbiddenException('Endpoint disabled');
    // The WHERE-tree size cap is enforced by `DebugQueryTreeSizeMiddleware` (registered in
    // `GsModule.configure`); it runs before the global `ValidationPipe`, so the body that
    // reaches this handler is small enough to recurse safely through `plainToInstance`,
    // `JSON.stringify` in the audit log, and the service walker.

    return this.gsService.executeDebugQuery(dto, jwt.address ?? `account:${jwt.account}`);
  }

  @Post('debug/logs')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.DEBUG), UserActiveGuard())
  async executeLogQuery(@GetJwt() jwt: JwtPayload, @Body() dto: LogQueryDto): Promise<LogQueryResult> {
    if (DisabledProcess(Process.GS_DEBUG)) throw new ForbiddenException('Endpoint disabled');

    return this.gsService.executeLogQuery(dto, jwt.address ?? `account:${jwt.account}`);
  }
}
