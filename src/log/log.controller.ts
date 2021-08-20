import {
  Body,
  Controller,
  Get,
  Param,
  UseGuards,
  Post,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/guards/role.guard';
import { LogService } from './log.service';
import { CreateLogDto } from './dto/create-log.dto';
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from 'src/user/user.entity';

@ApiTags('log')
@Controller('log')
export class LogController {
  constructor(private readonly logService: LogService) {}

  @Get(':key')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @UsePipes(ValidationPipe)
  async getLog(@Param() log: any): Promise<any> {
    return this.logService.getLog(log);
  }

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
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
}
