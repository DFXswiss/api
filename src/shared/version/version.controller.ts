import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { VersionDto } from './version.dto';
import { VersionService } from './version.service';

@ApiTags('version')
@Controller('version')
export class VersionController {
  constructor(private readonly versionService: VersionService) {}

  @Get()
  @ApiOkResponse({ type: VersionDto })
  getVersion(): VersionDto {
    return this.versionService.getVersion();
  }
}
