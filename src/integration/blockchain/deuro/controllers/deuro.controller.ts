import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DEuroService } from '../deuro.service';
import { DEuroInfoDto } from '../dto/deuro.dto';

@ApiTags('DEuro')
@Controller('deuro')
export class DEuroController {
  constructor(private readonly service: DEuroService) {}

  @Get('info')
  async getInfo(): Promise<DEuroInfoDto> {
    return this.service.getDEuroInfo();
  }
}
