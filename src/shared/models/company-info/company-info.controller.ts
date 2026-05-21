import { Controller, Get, Param } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CompanyInfoDtoMapper } from './dto/company-info-dto.mapper';
import { CompanyInfoDto } from './dto/company-info.dto';
import { CompanyInfoService } from './company-info.service';

@ApiTags('CompanyInfo')
@Controller('company-info')
export class CompanyInfoController {
  constructor(private readonly service: CompanyInfoService) {}

  @Get(':brand')
  @ApiOkResponse({ type: CompanyInfoDto })
  async getForBrand(@Param('brand') brand: string): Promise<CompanyInfoDto> {
    const info = await this.service.getForBrand(brand);
    return CompanyInfoDtoMapper.entityToDto(info);
  }
}
