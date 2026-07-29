import { BadRequestException, Body, Controller, ForbiddenException, Get, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint } from '@nestjs/swagger';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Util } from 'src/shared/utils/util';
import { DbQueryBaseDto, DbQueryDto, DbReturnData } from './dto/db-query.dto';
import { DebugQueryDto, DebugQueryResult } from './dto/debug-query.dto';
import { SupportDataQuery, SupportReturnData } from './dto/support-data.dto';
import { GsService } from './gs.service';

@Controller('gs')
export class GsController {
  private readonly logger = new DfxLogger(GsController);

  constructor(
    private readonly gsService: GsService,
    private readonly settingService: SettingService,
  ) {}

  @Post('db')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async getDbData(@GetJwt() jwt: JwtPayload, @Body() query: DbQueryDto): Promise<DbReturnData> {
    if (DisabledProcess(Process.GS_DB)) throw new ForbiddenException('Endpoint disabled');

    await this.logAndCheckTrigger(query, jwt);

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

    await this.logAndCheckTrigger(query, jwt);

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
  // group/order/limit) and emits hand-built SQL with bound parameters via `dataSource.query` —
  // no raw SQL is accepted, parsed, or interpolated.

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

  // Logs every `/gs/db*` call (table, identifier, trigger, caller role) as the measurement
  // baseline for the trigger-type rollout, then — only once the `gsTriggerEnforcement` setting
  // is explicitly enabled — rejects calls that don't declare whether they were triggered
  // manually or by an automation. The setting is default-off so a forgotten config entry can
  // never self-activate enforcement. `identifier`/`trigger` use the `missing` label (not a
  // value fallback) so omissions stay visible in the log instead of going blank.
  // The setting lookup (`getObjCached`) is cached because this path is hot. A change to
  // `gsTriggerEnforcement` therefore takes effect only after up to 5 minutes (the
  // `CachedRepository` cache-reset period; see `EVERY_5_MINUTES` in
  // `src/shared/repositories/cached.repository.ts`) — relevant when turning enforcement
  // back off during an incident.
  private async logAndCheckTrigger(query: DbQueryBaseDto, jwt: JwtPayload): Promise<void> {
    const table = Util.sanitizeLogValue(query.table, 64);
    const identifier = query.identifier ? Util.sanitizeLogValue(query.identifier, 64) : 'missing';

    this.logger.verbose(
      `GS db call: table=${table}, identifier=${identifier}, trigger=${query.trigger ?? 'missing'}, role=${jwt.role}`,
    );

    const enforced = await this.settingService.getObjCached<boolean>('gsTriggerEnforcement', false);
    if (enforced && !query.trigger) throw new BadRequestException('Trigger type is required');
  }
}
