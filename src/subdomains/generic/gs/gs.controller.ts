import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint } from '@nestjs/swagger';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Util } from 'src/shared/utils/util';
import { DbQueryBaseDto, DbQueryDto, DbReturnData } from './dto/db-query.dto';
import { DebugQueryDto, DebugQueryResult } from './dto/debug-query.dto';
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

    this.logAndCheckTrigger(query, jwt);

    try {
      return await this.gsService.getDbData(query, jwt.role);
    } catch (e) {
      const { table, identifier } = this.sanitizeLogFields(query);
      this.logger.verbose(`DB data call for ${table} in ${identifier} failed:`, e);
      throw new BadRequestException(e.message);
    }
  }

  @Post('db/custom')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async getExtendedData(@GetJwt() jwt: JwtPayload, @Body() query: DbQueryBaseDto): Promise<DbReturnData> {
    if (DisabledProcess(Process.GS_DB)) throw new ForbiddenException('Endpoint disabled');

    this.logAndCheckTrigger(query, jwt);

    try {
      return await this.gsService.getExtendedDbData(query, jwt.role);
    } catch (e) {
      const { table, identifier } = this.sanitizeLogFields(query);
      this.logger.verbose(`Custom DB data call for ${table} in ${identifier} failed:`, e);
      throw new BadRequestException(e.message);
    }
  }

  // Disabled on purpose: the `key` query parameter is not restricted to a known set of columns
  // before it reaches the query builders behind `GsService.getSupportData`. Do not re-enable this
  // route — and do not add another caller for that service method — until `key` is validated
  // against an allowlist of the target entity's columns.
  @Get('support')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.SUPPORT), UserActiveGuard())
  async getSupportData(): Promise<never> {
    throw new ServiceUnavailableException('Endpoint disabled');
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

  // Logs every `/gs/db*` handler invocation that passes the guards and the endpoint kill
  // switch (table, identifier, trigger, caller role), then rejects calls that don't declare
  // whether they were triggered manually or by an automation. Keep this check synchronous:
  // the previous DB-backed feature-flag lookup put one uncached SELECT on every request and a
  // burst of legacy callers made even the rejection path take multiple seconds. The trigger
  // stays optional in the DTO so this helper can emit the audit line before rejecting it.
  // `identifier`/`trigger` use the `missing` label (not a value fallback) so omissions stay
  // visible in the log instead of going blank.
  private logAndCheckTrigger(query: DbQueryBaseDto, jwt: JwtPayload): void {
    const { table, identifier } = this.sanitizeLogFields(query);

    this.logger.verbose(
      `GS db call: table=${table}, identifier=${identifier}, trigger=${query.trigger ?? 'missing'}, role=${jwt.role}`,
    );

    if (!query.trigger) throw new BadRequestException('Trigger type is required');
  }

  // Client-controlled values must never land raw in any log line.
  private sanitizeLogFields(query: DbQueryBaseDto): { table: string; identifier: string } {
    return {
      table: Util.sanitizeLogValue(query.table, 64),
      identifier: query.identifier ? Util.sanitizeLogValue(query.identifier, 64) : 'missing',
    };
  }
}
