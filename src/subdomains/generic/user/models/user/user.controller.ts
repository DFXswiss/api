import { Body, Controller, Delete, Get, HttpStatus, Param, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiCreatedResponse, ApiExcludeEndpoint, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { RealIP } from 'nestjs-real-ip';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { HistoryFilter, HistoryFilterKey } from 'src/subdomains/core/history/dto/history-filter.dto';
import { FeeService } from 'src/subdomains/supporting/payment/services/fee.service';
import { AuthService } from '../auth/auth.service';
import { AuthResponseDto } from '../auth/dto/auth-response.dto';
import { KycInfo } from '../kyc/dto/kyc-info.dto';
import { KycUserDataDto } from '../kyc/dto/kyc-user-data.dto';
import { KycService } from '../kyc/kyc.service';
import { ApiKeyDto } from './dto/api-key.dto';
import { LinkedUserInDto } from './dto/linked-user.dto';
import { RefInfoQuery } from './dto/ref-info-query.dto';
import { UpdateUserAdminDto } from './dto/update-user-admin.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserDetailDto, UserDto } from './dto/user.dto';
import { VolumeQuery } from './dto/volume-query.dto';
import { User } from './user.entity';
import { UserService } from './user.service';
import { KycDataDto } from 'src/subdomains/generic/kyc/dto/input/kyc-data.dto';

@ApiTags('User')
@Controller('user')
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly authService: AuthService,
    private readonly feeService: FeeService,
    private readonly kycService: KycService,
  ) {}

  // --- USER --- //
  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiOkResponse({ type: UserDto })
  async getUser(@GetJwt() jwt: JwtPayload): Promise<UserDto> {
    return this.userService.getUserDto(jwt.id, false);
  }

  @Get('detail')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiOkResponse({ type: UserDetailDto })
  async getUserDetail(@GetJwt() jwt: JwtPayload): Promise<UserDetailDto> {
    return this.userService.getUserDto(jwt.id, true);
  }

  @Put()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiOkResponse({ type: UserDetailDto })
  async updateUser(
    @GetJwt() jwt: JwtPayload,
    @Body() newUser: UpdateUserDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<UserDetailDto> {
    const { user, isKnownUser } = await this.userService.updateUser(jwt.id, newUser);
    if (isKnownUser) res.status(HttpStatus.ACCEPTED);

    return user;
  }

  @Put('discountCodes')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiOkResponse()
  async addDiscountCode(@GetJwt() jwt: JwtPayload, @Query('code') code: string): Promise<void> {
    const user = await this.userService.getUser(jwt.id, { userData: true, wallet: true });

    return this.feeService.addDiscountCodeUser(user, code);
  }

  @Post('change')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiOkResponse({ type: AuthResponseDto })
  async changeUser(
    @GetJwt() jwt: JwtPayload,
    @Body() changeUser: LinkedUserInDto,
    @RealIP() ip: string,
  ): Promise<AuthResponseDto> {
    return this.authService.changeUser(jwt.id, changeUser, ip);
  }

  @Post('data')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiCreatedResponse({ type: KycInfo })
  async updateKycData(@GetJwt() jwt: JwtPayload, @Body() data: KycDataDto): Promise<KycInfo> {
    return this.kycService.updateKycData('', data, jwt.id);
  }

  @Delete()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiOkResponse()
  async deleteUser(@GetJwt() jwt: JwtPayload): Promise<void> {
    return this.userService.blockUser(jwt.id);
  }

  @Delete('account')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiOkResponse()
  async deleteUserAccount(@GetJwt() jwt: JwtPayload): Promise<void> {
    return this.userService.blockUser(jwt.id, true);
  }

  // --- API KEYS --- //
  @Post('apiKey/CT')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiCreatedResponse({ type: ApiKeyDto })
  async createApiKey(@GetJwt() jwt: JwtPayload, @Query() filter: HistoryFilter): Promise<ApiKeyDto> {
    return this.userService.createApiKey(jwt.id, filter);
  }

  @Delete('apiKey/CT')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiOkResponse()
  async deleteApiKey(@GetJwt() jwt: JwtPayload): Promise<void> {
    return this.userService.deleteApiKey(jwt.id);
  }

  @Put('apiFilter/CT')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiOkResponse({ type: String, isArray: true })
  async updateApiFilter(@GetJwt() jwt: JwtPayload, @Query() filter: HistoryFilter): Promise<HistoryFilterKey[]> {
    return this.userService.updateApiFilter(jwt.id, filter);
  }

  // --- ADMIN --- //
  @Get('ref')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getRefInfo(
    @Query() query: RefInfoQuery,
  ): Promise<{ activeUser: number; passiveUser: number; fiatVolume?: number; cryptoVolume?: number }> {
    return this.userService.getRefInfo(query);
  }

  @Get('volumes')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getVolumes(@Query() query: VolumeQuery): Promise<{ buy: number; sell: number }> {
    return this.userService.getUserVolumes(query);
  }

  @Put(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async updateUserAdmin(@Param('id') id: string, @Body() dto: UpdateUserAdminDto): Promise<User> {
    return this.userService.updateUserInternal(+id, dto);
  }
}
