import { Controller, Get, Headers, Param, Put, Query, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiExcludeEndpoint, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { KycInfoDto, KycStepDto } from '../dto/kyc-info.dto';
import { KycResultDto } from '../dto/kyc-result.dto';
import { KycStepName, KycStepType } from '../enums/kyc.enum';
import { KycService } from '../services/kyc.service';

const CodeHeaderName = 'x-kyc-code';

@ApiTags('KYC')
@Controller({ path: 'kyc', version: ['2'] })
export class KycController {
  constructor(private readonly kycService: KycService) {}

  @Get()
  @ApiOkResponse({ type: KycInfoDto })
  async getKycStatus(@Headers(CodeHeaderName) code: string): Promise<KycInfoDto> {
    return this.kycService.getInfo(code);
  }

  @Put()
  @ApiOkResponse({ type: KycStepDto })
  async continueKyc(@Headers(CodeHeaderName) code: string): Promise<KycInfoDto> {
    return this.kycService.continue(code);
  }

  @Get(':step')
  @ApiExcludeEndpoint()
  async getStep(
    @Headers(CodeHeaderName) code: string,
    @Param('step') stepName: KycStepName,
    @Query('type') stepType?: KycStepType,
  ): Promise<KycStepDto> {
    return this.kycService.getOrCreateStep(code, stepName, stepType);
  }

  // update endpoints
  // TODO: request DTOs
  @Put('data/personal/:id')
  @ApiOkResponse()
  async updatePersonalData(@Headers(CodeHeaderName) code: string, @Param('id') id: string): Promise<KycResultDto> {
    return this.kycService.updatePersonalData(code, +id);
  }

  @Get('data/financial/:id')
  @ApiOkResponse()
  async getFinancialData(@Headers(CodeHeaderName) code: string, @Param('id') id: string): Promise<void> {
    // TODO: response DTO
    return this.kycService.getFinancialData(code, +id);
  }

  @Put('data/financial/:id')
  @ApiOkResponse()
  async updateFinancialData(@Headers(CodeHeaderName) code: string, @Param('id') id: string): Promise<KycResultDto> {
    return this.kycService.updateFinancialData(code, +id);
  }

  @Put('document/:id')
  @UseInterceptors(FilesInterceptor('files'))
  @ApiOkResponse()
  async uploadDocument(
    @Headers(CodeHeaderName) code: string,
    @Param('id') id: string,
    @UploadedFiles() files: Express.Multer.File[],
  ): Promise<KycResultDto> {
    return this.kycService.uploadDocument(code, +id, files[0]);
  }
}
