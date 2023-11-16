import { Controller, Get, Param } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { KycInfoDto, KycStepDto } from '../dto/kyc-info.dto';
import { KycStepName } from '../enums/kyc.enum';
import { KycService } from '../services/kyc.service';

@ApiTags('KYC')
@Controller({ path: 'kyc', version: ['2'] })
export class KycController {
  constructor(private readonly kycService: KycService) {}

  // TODO: use code in body? Query param?

  @Get(':code')
  @ApiOkResponse({ type: KycInfoDto })
  async getKycInfo(@Param('code') code: string): Promise<KycInfoDto> {
    return this.kycService.getInfo(code);
  }

  @Get(':code/:step')
  @ApiExcludeEndpoint()
  async getStep(@Param('code') code: string, @Param('step') stepName: KycStepName): Promise<KycStepDto> {
    // TODO: return more step info (different DTOs: ident -> URL, financial -> questions)
    return this.kycService.getOrCreateStep(code, stepName);
  }
}
