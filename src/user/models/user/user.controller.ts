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
import { ActiveRefUserQuery } from './dto/active-ref-user-query.dto';

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

  @Get('ref')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getActiveRefUser(
    @Query() query: ActiveRefUserQuery,
  ): Promise<{ activeUser: number; cryptoBuyVolume?: number; buyCryptoVolume?: number }> {
    return this.userService.getActiveRefUser(query);
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
  async createApiKey(@GetJwt() jwt: JwtPayload): Promise<ApiKey> {
    return this.userService.createApiKey(jwt.id);
  }

  @Delete('apiKey/CT')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async deleteApiKey(@GetJwt() jwt: JwtPayload): Promise<void> {
    return this.userService.deleteApiKey(jwt.id);
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
  @Put(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async updateUserAdmin(@Param('id') id: string, @Body() dto: UpdateUserAdminDto): Promise<User> {
    return this.userService.updateUserInternal(+id, dto);
  }
}
