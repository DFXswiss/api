import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { JuiceService } from '../juice.service';
import { JuiceInfoDto } from '../dto/juice.dto';

@ApiTags('Juice')
@Controller('juice')
export class JuiceController {
  constructor(private readonly service: JuiceService) {}

  @Get('info')
  async getInfo(): Promise<JuiceInfoDto> {
    return this.service.getJuiceInfo();
  }
}
