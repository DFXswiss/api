import { Body, Controller, Get, Param, Post, Put, Query, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
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
import { FilesInterceptor } from '@nestjs/platform-express';
import { KycDocument } from 'src/user/services/kyc/dto/kyc.dto';
import { CfpVotes } from './dto/cfp-votes.dto';
import { KycResult } from '../userData/userData.service';
import { LimitRequestService } from '../limit-request/limit-request.service';
import { LimitRequestDto } from '../limit-request/dto/limit-request.dto';
import { LimitRequest } from '../limit-request/limit-request.entity';

@ApiTags('user')
@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService, private readonly limitRequestService: LimitRequestService) {}

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

  @Get('ref')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getUserRefData(@GetJwt() jwt: JwtPayload): Promise<any> {
    return this.userService.getRefDataForId(jwt.id);
  }

  @Put()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async updateUser(@GetJwt() jwt: JwtPayload, @Body() newUser: UpdateUserDto): Promise<any> {
    return this.userService.updateUser(jwt.id, newUser);
  }

  @Put('ref')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async updateRef(@GetJwt() jwt: JwtPayload, @Body() { fee }: { fee: number }): Promise<number> {
    return this.userService.updateRefFee(jwt.id, fee);
  }

  @Get('kyc')
  async getKycProgress(@Query('code') code: string): Promise<KycResult> {
    return await this.userService.getKycProgress(code);
  }

  @Post('kyc')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async requestKyc(@GetJwt() jwt: JwtPayload): Promise<string> {
    return await this.userService.requestKyc(jwt.id).then(JSON.stringify);
  }

  @Post('limit')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async increaseLimit(@GetJwt() jwt: JwtPayload, @Body() request: LimitRequestDto): Promise<LimitRequest> {
    return await this.limitRequestService.increaseLimit(jwt.id, request);
  }

  @Post('incorporationCertificate')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @UseInterceptors(FilesInterceptor('files'))
  async uploadIncorporationCertificate(
    @GetJwt() jwt: JwtPayload,
    @UploadedFiles() files: Express.Multer.File[],
  ): Promise<boolean> {
    return this.userService.uploadDocument(jwt.id, files[0], KycDocument.INCORPORATION_CERTIFICATE);
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
