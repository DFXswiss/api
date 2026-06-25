import { Body, Controller, Delete, Get, Param, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeController, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { PartnerFeeDto } from './dto/partner-fee.dto';
import { PartnerUserInfoDto } from './dto/partner-user-info.dto';
import { SetOnboardingFeeDto } from './dto/set-onboarding-fee.dto';
import { PartnerService } from './partner.service';

@ApiTags('Partner')
@Controller('partner')
@ApiExcludeController()
@ApiBearerAuth()
@UseGuards(AuthGuard(), RoleGuard(UserRole.PARTNER), UserActiveGuard())
export class PartnerController {
  constructor(private readonly partnerService: PartnerService) {}

  @Get('user')
  @ApiOkResponse({ type: PartnerUserInfoDto })
  async findUserByAddress(@GetJwt() jwt: JwtPayload, @Query('address') address: string): Promise<PartnerUserInfoDto> {
    return this.partnerService.findUserByAddress(address, jwt.user);
  }

  @Get('users')
  @ApiOkResponse({ type: PartnerUserInfoDto, isArray: true })
  async getMyReferees(@GetJwt() jwt: JwtPayload): Promise<PartnerUserInfoDto[]> {
    return this.partnerService.getMyReferees(jwt.user);
  }

  @Get('fees')
  @ApiOkResponse({ type: PartnerFeeDto, isArray: true })
  async getAvailableFees(@GetJwt() jwt: JwtPayload): Promise<PartnerFeeDto[]> {
    return this.partnerService.getAvailableFees(jwt.user);
  }

  @Put('user/:userDataId/onboarding')
  async setOnboarding(
    @GetJwt() jwt: JwtPayload,
    @Param('userDataId') userDataId: string,
    @Body() dto: SetOnboardingFeeDto,
  ): Promise<void> {
    return this.partnerService.setOnboarding(+userDataId, dto.feeId, jwt.user);
  }

  @Delete('user/:userDataId/fee')
  async removeFee(
    @GetJwt() jwt: JwtPayload,
    @Param('userDataId') userDataId: string,
    @Query('fee') feeId: string,
  ): Promise<void> {
    return this.partnerService.removeFee(+userDataId, +feeId, jwt.user);
  }
}
