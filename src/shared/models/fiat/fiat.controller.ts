import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { FiatService } from './fiat.service';
import { FiatDto } from './dto/fiat.dto';
import { FiatDtoMapper } from './dto/fiat-dto.mapper';

@ApiTags('Fiat')
@Controller('fiat')
export class FiatController {
  constructor(private readonly fiatService: FiatService) {}

  @Get()
  @ApiOkResponse({ type: FiatDto, isArray: true })
  async getAllFiat(): Promise<FiatDto[]> {
    return this.fiatService.getAllFiat().then(FiatDtoMapper.entitiesToDto);
  }
}
