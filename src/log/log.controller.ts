import { Body, Controller, Get, Param, UseGuards, Post, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { LogService } from './log.service';
import { CreateLogDto } from './dto/create-log.dto';
import { AuthGuard } from '@nestjs/passport';
import { User, UserRole } from 'src/user/user.entity';
import { GetUser } from 'src/auth/get-user.decorator';
import { CreateVolumeLogDto } from './dto/create-volume-log.dto';

@ApiTags('log')
@Controller('log')
export class LogController {
  constructor(private readonly logService: LogService) {}

  @Get('/id/:key')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @UsePipes(ValidationPipe)
  async getLog(@Param() log: any): Promise<any> {
    return this.logService.getLog(log);
  }

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getAllUserLog(@GetUser() user: User): Promise<any> {
    return this.logService.getAllUserLog(user.address);
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
  @UsePipes(ValidationPipe)
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  createLog(@Body() createLogDto: CreateLogDto): Promise<any> {
    return this.logService.createLog(createLogDto);
  }

  @Post('volume')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UsePipes(ValidationPipe)
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  createVolumeLog(@Body() createLogDto: CreateVolumeLogDto): Promise<any> {
    return this.logService.createVolumeLog(createLogDto);
  }
}
