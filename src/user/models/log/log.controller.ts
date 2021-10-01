import { Body, Controller, Get, Param, UseGuards, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { LogService } from './log.service';
import { CreateLogDto } from './dto/create-log.dto';
import { AuthGuard } from '@nestjs/passport';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { CreateVolumeLogDto } from './dto/create-volume-log.dto';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { UpdateLogDto } from './dto/update-log.dto';

@ApiTags('log')
@Controller('log')
export class LogController {
  constructor(private readonly logService: LogService) {}

  @Get('/id/:key')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getLog(@Param() log: any): Promise<any> {
    return this.logService.getLog(log);
  }

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getAllUserLog(@GetJwt() jwt: JwtPayload): Promise<any> {
    return this.logService.getAllUserLog(jwt.address);
  }

  @Get('all')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getAllLog(): Promise<any> {
    return this.logService.getAllLog();
  }

  @Post()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  createLog(@Body() createLogDto: CreateLogDto): Promise<any> {
    return this.logService.createLog(createLogDto);
  }

  @Post('volume')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  createVolumeLog(@Body() createLogDto: CreateVolumeLogDto): Promise<any> {
    return this.logService.createVolumeLog(createLogDto);
  }

  @Put()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  updateLog(@Body() updateLogDto: UpdateLogDto): Promise<any> {
    return this.logService.updateLog(updateLogDto);
  }
}
