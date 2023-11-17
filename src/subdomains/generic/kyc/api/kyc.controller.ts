import { Controller, Get, Param, Put, Query } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { KycInfoDto, KycStepDto } from '../dto/kyc-info.dto';
import { KycStepName, KycStepType } from '../enums/kyc.enum';
import { KycService } from '../services/kyc.service';

@ApiTags('KYC')
@Controller({ path: 'kyc', version: ['2'] })
export class KycController {
  constructor(private readonly kycService: KycService) {}

  // TODO: use code in header?

  @Get(':code')
  @ApiOkResponse({ type: KycInfoDto })
  async getKycInfo(@Param('code') code: string): Promise<KycInfoDto> {
    return this.kycService.getInfo(code);
  }

  @Get(':code/next')
  @ApiOkResponse({ type: KycStepDto })
  async getNextStep(@Param('code') code: string): Promise<KycStepDto> {
    return this.kycService.getNextStep(code);
  }

  @Get(':code/:step')
  @ApiExcludeEndpoint()
  async getStep(
    @Param('code') code: string,
    @Param('step') stepName: KycStepName,
    @Query('type') stepType?: KycStepType,
  ): Promise<KycStepDto> {
    return this.kycService.getOrCreateStep(code, stepName, stepType);
  }

  // update endpoints
  // TODO: request/response DTOs
  @Put(':code/data/personal/:id')
  @ApiOkResponse()
  async updatePersonalData(@Param('code') code: string): Promise<void> {
    return this.kycService.updatePersonalData(code);
  }

  @Put(':code/data/financial/:id')
  @ApiOkResponse()
  async updateFinancialData(@Param('code') code: string): Promise<void> {
    return this.kycService.updateFinancialData(code);
  }

  @Put(':code/document/:id')
  @ApiOkResponse()
  async uploadDocument(@Param('code') code: string): Promise<void> {
    return this.kycService.uploadDocument(code);
  }
}
