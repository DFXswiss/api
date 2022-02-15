import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UserService } from './user.service';
import { UpdateStatusDto } from './dto/update-status.dto';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { CfpVotes } from './dto/cfp-votes.dto';

@ApiTags('user')
@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  // --- USER --- //
  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getUser(@GetJwt() jwt: JwtPayload): Promise<any> {
    return this.userService.getUser(jwt.id, false);
  }

  @Get('detail')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getUserDetail(@GetJwt() jwt: JwtPayload): Promise<any> {
    return this.userService.getUser(jwt.id, true);
  }

  @Put()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async updateUser(@GetJwt() jwt: JwtPayload, @Body() newUser: UpdateUserDto): Promise<any> {
    return this.userService.updateUser(jwt.id, newUser);
  }

  // --- REF --- //
  @Get('ref')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getUserRefData(@GetJwt() jwt: JwtPayload): Promise<any> {
    return this.userService.getRefDataForId(jwt.id);
  }

  @Put('ref')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async updateRef(@GetJwt() jwt: JwtPayload, @Body() { fee }: { fee: number }): Promise<number> {
    return this.userService.updateRefFee(jwt.id, fee);
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
  @Get('all')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getAllUser(): Promise<any> {
    return this.userService.getAllUser();
  }

  @Put('role')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async updateRole(@Body() user: UpdateRoleDto): Promise<any> {
    return this.userService.updateRole(user);
  }

  @Put(':id/status')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async updateStatus(@Param('id') id: string, @Body() dto: UpdateStatusDto): Promise<void> {
    return this.userService.updateStatus(+id, dto.status);
  }
}
