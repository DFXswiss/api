import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { EurocoinInfoDto } from '../dto/eurocoin.dto';
import { EurocoinService } from '../eurocoin.service';

@ApiTags('Eurocoin')
@Controller('eurocoin')
export class EurocoinController {
  constructor(private readonly service: EurocoinService) {}

  @Get('info')
  async getInfo(): Promise<EurocoinInfoDto> {
    return this.service.getEurocoinInfo();
  }
}
