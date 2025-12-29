import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FrankencoinInfoDto } from '../dto/frankencoin.dto';
import { FrankencoinService } from '../frankencoin.service';

@ApiTags('Frankencoin')
@Controller('frankencoin')
export class FrankencoinController {
  constructor(private readonly service: FrankencoinService) {}

  @Get('info')
  async getInfo(): Promise<FrankencoinInfoDto> {
    return this.service.getFrankencoinInfo();
  }
}
