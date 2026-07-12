import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { AcceptRealUnitLegalDto, RealUnitLegalInfoDto } from '../dto/real-unit-legal.dto';
import { RealUnitLegalService } from '../real-unit-legal.service';

@ApiTags('Realunit')
@Controller('realunit/legal')
export class RealUnitLegalController {
  constructor(
    private readonly realUnitLegalService: RealUnitLegalService,
    private readonly userService: UserService,
  ) {}

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER), UserActiveGuard())
  @ApiOperation({
    summary: 'Get RealUnit legal acceptance status',
    description:
      'Returns, per RealUnit legal agreement, the current version, the version the caller last accepted (if any), and whether the current version is accepted. `allAccepted` is true only when every agreement is on its current version.',
  })
  @ApiOkResponse({ type: RealUnitLegalInfoDto })
  async getLegal(@GetJwt() jwt: JwtPayload): Promise<RealUnitLegalInfoDto> {
    const user = await this.userService.getUser(jwt.user, { userData: true });
    return this.realUnitLegalService.getLegalInfo(user.userData);
  }

  @Put()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER), UserActiveGuard())
  @ApiOperation({
    summary: 'Accept RealUnit legal agreements',
    description:
      "Records the caller's acceptance of the given agreements, each stamped with the current server-side version (a client-sent version is never trusted). Idempotent: re-accepting a version already on record is a no-op. Returns the updated legal acceptance status.",
  })
  @ApiOkResponse({ type: RealUnitLegalInfoDto })
  async acceptLegal(@GetJwt() jwt: JwtPayload, @Body() dto: AcceptRealUnitLegalDto): Promise<RealUnitLegalInfoDto> {
    const user = await this.userService.getUser(jwt.user, { userData: true });
    return this.realUnitLegalService.acceptLegal(user.userData, dto.agreements);
  }
}
