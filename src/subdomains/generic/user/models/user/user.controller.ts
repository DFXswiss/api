import { Body, Controller, Delete, ForbiddenException, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiExcludeEndpoint,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RealIP } from 'nestjs-real-ip';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { HistoryFilter, HistoryFilterKey } from 'src/subdomains/core/history/dto/history-filter.dto';
import { KycInputDataDto } from 'src/subdomains/generic/kyc/dto/input/kyc-data.dto';
import { FeeService } from 'src/subdomains/supporting/payment/services/fee.service';
import { AuthService } from '../auth/auth.service';
import { AuthResponseDto } from '../auth/dto/auth-response.dto';
import { UserDataService } from '../user-data/user-data.service';
import { ApiKeyDto } from './dto/api-key.dto';
import { LinkedUserInDto } from './dto/linked-user.dto';
import { RefInfoQuery } from './dto/ref-info-query.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import { UpdateUserInternalDto } from './dto/update-user-admin.dto';
import { UpdateUserDto, UpdateUserMailDto } from './dto/update-user.dto';
import { UserNameDto } from './dto/user-name.dto';
import { ReferralDto, UserV2Dto } from './dto/user-v2.dto';
import { UserDetailDto, UserDto } from './dto/user.dto';
import { VerifyMailDto } from './dto/verify-mail.dto';
import { VolumeQuery } from './dto/volume-query.dto';
import { User, UserSupportUpdateCols } from './user.entity';
import { UserService } from './user.service';

@ApiTags('User')
@Controller('user')
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly authService: AuthService,
    private readonly feeService: FeeService,
    private readonly userDataService: UserDataService,
  ) {}

  // --- USER --- //
  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER), UserActiveGuard())
  @ApiOkResponse({ type: UserDto })
  @ApiOperation({ deprecated: true })
  async getUserV1(@GetJwt() jwt: JwtPayload): Promise<UserDto> {
    return this.userService.getUserDto(jwt.user, false);
  }

  @Get('detail')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER), UserActiveGuard())
  @ApiOkResponse({ type: UserDetailDto })
  @ApiOperation({ deprecated: true })
  async getUserDetailV1(@GetJwt() jwt: JwtPayload): Promise<UserDetailDto> {
    return this.userService.getUserDto(jwt.user, true);
  }

  @Put()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER), UserActiveGuard())
  @ApiOkResponse({ type: UserDetailDto })
  @ApiOperation({ deprecated: true })
  async updateUserV1(@GetJwt() jwt: JwtPayload, @Body() newUser: UpdateUserDto): Promise<UserDetailDto> {
    return this.userService.updateUserV1(jwt.user, newUser);
  }

  @Put('discountCodes')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER), UserActiveGuard())
  @ApiOkResponse()
  @ApiOperation({ deprecated: true, description: 'This endpoint is deprecated, use "specialCodes" instead.' })
  async addDiscountCode(@GetJwt() jwt: JwtPayload, @Query('code') code: string): Promise<void> {
    const user = await this.userService.getUser(jwt.user, { userData: true, wallet: true });

    return this.feeService.addSpecialCodeUser(user, code);
  }

  @Put('specialCodes')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER), UserActiveGuard())
  @ApiOkResponse()
  async addSpecialCode(@GetJwt() jwt: JwtPayload, @Query('code') code: string): Promise<void> {
    const user = await this.userService.getUser(jwt.user, { userData: true, wallet: true });

    return this.feeService.addSpecialCodeUser(user, code);
  }

  @Post('change')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT), UserActiveGuard())
  @ApiOkResponse({ type: AuthResponseDto })
  async changeUser(
    @GetJwt() jwt: JwtPayload,
    @Body() changeUser: LinkedUserInDto,
    @RealIP() ip: string,
  ): Promise<AuthResponseDto> {
    return this.authService.changeUser(jwt.account, changeUser, ip);
  }

  // TODO: temporary CC solution
  @Put('name')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER), UserActiveGuard())
  @ApiExcludeEndpoint()
  async updateUserName(@GetJwt() jwt: JwtPayload, @Body() data: UserNameDto): Promise<void> {
    await this.userService.updateUserName(jwt.user, data);
  }

  @Post('data')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER), UserActiveGuard())
  @ApiCreatedResponse({ type: UserDetailDto })
  @ApiBadRequestResponse({ description: 'KYC already started' })
  @ApiConflictResponse({ description: 'Account already exists' })
  async updateKycData(@GetJwt() jwt: JwtPayload, @Body() data: KycInputDataDto): Promise<UserDetailDto> {
    return this.userService.updateUserData(jwt.user, data);
  }

  @Delete()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER), UserActiveGuard())
  @ApiOkResponse()
  @ApiOperation({ deprecated: true })
  async deleteUser(@GetJwt() jwt: JwtPayload): Promise<void> {
    return this.userService.deactivateUser(jwt.account, jwt.address ?? '');
  }

  @Delete('account')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER), UserActiveGuard())
  @ApiOkResponse()
  @ApiOperation({ deprecated: true })
  async deleteUserAccount(@GetJwt() jwt: JwtPayload): Promise<void> {
    return this.userService.deactivateUser(jwt.account);
  }

  // --- API KEYS --- //
  @Post('apiKey/CT')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT))
  @ApiCreatedResponse({ type: ApiKeyDto })
  async createApiKey(@GetJwt() jwt: JwtPayload, @Query() filter: HistoryFilter): Promise<ApiKeyDto> {
    return this.userDataService.createApiKey(jwt.account, filter);
  }

  @Delete('apiKey/CT')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT))
  @ApiOkResponse()
  async deleteApiKey(@GetJwt() jwt: JwtPayload): Promise<void> {
    if (jwt.user) await this.userService.deleteApiKey(jwt.user);
    return this.userDataService.deleteApiKey(jwt.account);
  }

  @Put('apiFilter/CT')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT))
  @ApiOkResponse({ type: String, isArray: true })
  async updateApiFilter(@GetJwt() jwt: JwtPayload, @Query() filter: HistoryFilter): Promise<HistoryFilterKey[]> {
    if (jwt.user) await this.userService.updateApiFilter(jwt.user, filter);
    return this.userDataService.updateApiFilter(jwt.account, filter);
  }

  // --- ADMIN --- //
  @Get('ref')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async getRefInfo(
    @Query() query: RefInfoQuery,
  ): Promise<{ activeUser: number; passiveUser: number; fiatVolume?: number; cryptoVolume?: number }> {
    return this.userService.getRefInfo(query);
  }

  @Get('volumes')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async getVolumes(@Query() query: VolumeQuery): Promise<{ buy: number; sell: number }> {
    return this.userService.getUserVolumes(query);
  }

  @Put(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.SUPPORT), UserActiveGuard())
  async updateUserAdmin(
    @GetJwt() jwt: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateUserInternalDto,
  ): Promise<User> {
    if (
      [UserRole.SUPPORT, UserRole.COMPLIANCE].includes(jwt.role) &&
      Object.keys(dto).some((k) => !UserSupportUpdateCols.includes(k))
    )
      throw new ForbiddenException('Support/Compliance is not allowed to update this value');

    return this.userService.updateUserInternal(+id, dto);
  }
}

@ApiTags('User')
@Controller({ path: 'user', version: ['2'] })
export class UserV2Controller {
  constructor(private readonly userService: UserService) {}

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT), UserActiveGuard())
  @ApiOkResponse({ type: UserV2Dto })
  async getUser(@GetJwt() jwt: JwtPayload): Promise<UserV2Dto> {
    return this.userService.getUserDtoV2(jwt.account, jwt.user);
  }

  @Put()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT), UserActiveGuard())
  @ApiOkResponse({ type: UserV2Dto })
  async updateUser(@GetJwt() jwt: JwtPayload, @Body() newUser: UpdateUserDto): Promise<UserV2Dto> {
    return this.userService.updateUser(jwt.account, newUser, jwt.user);
  }

  @Put('mail')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT), UserActiveGuard())
  @ApiOkResponse({ description: 'Verification code sent' })
  @ApiForbiddenResponse({ description: 'Missing 2FA' })
  @ApiConflictResponse({ description: 'Account already exists' })
  async updateUserMail(
    @GetJwt() jwt: JwtPayload,
    @Body() newMail: UpdateUserMailDto,
    @RealIP() ip: string,
  ): Promise<void> {
    return this.userService.updateUserMail(jwt.account, newMail, ip);
  }

  @Post('mail/verify')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT), UserActiveGuard())
  @ApiCreatedResponse({ description: 'Email verification successful' })
  @ApiForbiddenResponse({ description: 'Invalid or expired mail verification token' })
  async verifyMail(@GetJwt() jwt: JwtPayload, @Body() dto: VerifyMailDto): Promise<UserV2Dto> {
    return this.userService.verifyMail(jwt.account, dto.token, jwt.user);
  }

  @Put('addresses/:address')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT), UserActiveGuard())
  @ApiOkResponse({ type: UserV2Dto })
  async updateAddress(
    @GetJwt() jwt: JwtPayload,
    @Body() newAddress: UpdateAddressDto,
    @Param('address') address: string,
  ): Promise<UserV2Dto> {
    return this.userService.updateAddress(jwt.account, address, newAddress);
  }

  @Delete('addresses/:address')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT), UserActiveGuard())
  @ApiOkResponse()
  async deleteAddress(@GetJwt() jwt: JwtPayload, @Param('address') address: string): Promise<void> {
    return this.userService.deactivateUser(jwt.account, address);
  }

  @Delete()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT), UserActiveGuard())
  @ApiOkResponse()
  async deleteAccount(@GetJwt() jwt: JwtPayload): Promise<void> {
    return this.userService.deactivateUser(jwt.account);
  }

  @Get('ref')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER), UserActiveGuard())
  @ApiOkResponse({ type: ReferralDto })
  async getRef(@GetJwt() jwt: JwtPayload): Promise<ReferralDto> {
    return this.userService.getRefDtoV2(jwt.user);
  }
}
