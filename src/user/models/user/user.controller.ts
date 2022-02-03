import { Body, Controller, Get, Post, Put, Query, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
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

@ApiTags('user')
@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

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

  @Post('kyc')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async requestKyc(
    @GetJwt() jwt: JwtPayload,
    @Query('depositLimit') depositLimit?: string,
  ): Promise<boolean | { url: string }> {
    return { url: await this.userService.requestKyc(jwt.id, depositLimit) };
  }

  @Post('incorporationCertificate')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @UseInterceptors(FilesInterceptor('files'))
  async uploadIncorporationCertificate(
    @GetJwt() jwt: JwtPayload,
    @UploadedFiles() files: Express.Multer.File[],
  ): Promise<boolean | Error> {
    return this.userService.uploadIncorporationCertificate(jwt.id, files[0]);
  }

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

  @Put('status')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async updateStatus(@Body() user: UpdateStatusDto): Promise<any> {
    return this.userService.updateStatus(user);
  }
}
