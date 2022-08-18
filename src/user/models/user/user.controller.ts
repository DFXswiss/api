import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserService } from './user.service';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { User } from './user.entity';
import { UserDetailDto, UserDto } from './dto/user.dto';
import { CfpVotes } from './dto/cfp-votes.dto';
import { UpdateUserAdminDto } from './dto/update-user-admin.dto';
import { ApiKey } from './dto/api-key.dto';
import { RefInfoQuery } from './dto/ref-info-query.dto';
import { VolumeQuery } from './dto/volume-query.dto';
import { HistoryFilter } from 'src/payment/models/history/dto/history-filter.dto';

@ApiTags('user')
@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  // --- USER --- //
  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getUser(@GetJwt() jwt: JwtPayload): Promise<UserDto> {
    return this.userService.getUserDto(jwt.id, false);
  }

  @Get('detail')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getUserDetail(@GetJwt() jwt: JwtPayload): Promise<UserDetailDto> {
    return this.userService.getUserDto(jwt.id, true);
  }

  @Put()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async updateUser(@GetJwt() jwt: JwtPayload, @Body() newUser: UpdateUserDto): Promise<UserDetailDto> {
    return this.userService.updateUser(jwt.id, newUser);
  }

  // --- API KEYS --- //
  @Post('apiKey/CT')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async createApiKey(@Query() filter: HistoryFilter, @GetJwt() jwt: JwtPayload): Promise<ApiKey> {
    return this.userService.createApiKey(jwt.id, filter);
  }

  @Delete('apiKey/CT')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async deleteApiKey(@GetJwt() jwt: JwtPayload): Promise<void> {
    return this.userService.deleteApiKey(jwt.id);
  }

  @Get('apiKey/filter/CT')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getApiKeyFilter(@GetJwt() jwt: JwtPayload): Promise<HistoryFilter> {
    return this.userService.getApiKeyFilter(jwt.id);
  }

  @Put('apiKey/filter/CT')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async updateApiKeyFilter(@Query() filter: HistoryFilter, @GetJwt() jwt: JwtPayload): Promise<UserDto> {
    return this.userService.updateApiKeyFilter(jwt.id, filter);
  }

  // --- CFP VOTING --- //
  @Get('cfpVotes')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getCfpVotes(@GetJwt() jwt: JwtPayload): Promise<CfpVotes> {
    return this.userService.getCfpVotes(jwt.id);
  }

  @Put('cfpVotes')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async updateCfpVotes(@GetJwt() jwt: JwtPayload, @Body() votes: CfpVotes): Promise<CfpVotes> {
    return this.userService.updateCfpVotes(jwt.id, votes);
  }

  // --- ADMIN --- //
  @Get('ref')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getRefInfo(@Query() query: RefInfoQuery): Promise<{ activeUser: number; volume?: number }> {
    return this.userService.getRefInfo(query);
  }

  @Get('volumes')
  @ApiBearerAuth()
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
