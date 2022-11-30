import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { Log } from './log.entity';
import { CreateLogDto } from './dto/create-log.dto';
import { LogService } from './log.service';

@ApiTags('log')
@Controller('log')
export class LogController {
  constructor(private readonly logService: LogService) {}

  @Post()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.BANKING_BOT))
  async create(@Body() dto: CreateLogDto): Promise<Log> {
    return this.logService.create(dto);
  }
}
