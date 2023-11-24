import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Param,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiExcludeEndpoint, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { RealIP } from 'nestjs-real-ip';
import { Config } from 'src/config/config';
import { CountryDtoMapper } from 'src/shared/models/country/dto/country-dto.mapper';
import { CountryDto } from 'src/shared/models/country/dto/country.dto';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { IdentResultDto } from '../../user/models/ident/dto/ident-result.dto';
import { KycContactData } from '../dto/input/kyc-contact-data.dto';
import { KycFinancialInData } from '../dto/input/kyc-financial-in.dto';
import { KycPersonalData } from '../dto/input/kyc-personal-data.dto';
import { KycFinancialOutData } from '../dto/output/kyc-financial-out.dto';
import { KycInfoDto, KycStepDto } from '../dto/output/kyc-info.dto';
import { KycResultDto } from '../dto/output/kyc-result.dto';
import { IdentStatus, KycStepName, KycStepType } from '../enums/kyc.enum';
import { KycService } from '../services/kyc.service';

const CodeHeaderName = 'x-kyc-code';

@ApiTags('KYC')
@Controller({ path: 'kyc', version: ['2'] })
export class KycController {
  private readonly logger = new DfxLogger(KycController);

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

  @Get(':code/countries')
  @ApiOkResponse({ type: CountryDto, isArray: true })
  async getKycCountriesByCode(@Param('code') code: string): Promise<CountryDto[]> {
    return this.kycService.getKycCountries(code).then(CountryDtoMapper.entitiesToDto);
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

  // --- UPDATE ENDPOINTS --- //
  @Put('data/contact/:id')
  @ApiOkResponse({ type: KycResultDto })
  async updateContactData(
    @Headers(CodeHeaderName) code: string,
    @Param('id') id: string,
    @Body() data: KycContactData,
  ): Promise<KycResultDto> {
    return this.kycService.updateContactData(code, +id, data);
  }

  @Put('data/personal/:id')
  @ApiOkResponse({ type: KycResultDto })
  async updatePersonalData(
    @Headers(CodeHeaderName) code: string,
    @Param('id') id: string,
    @Body() data: KycPersonalData,
  ): Promise<KycResultDto> {
    return this.kycService.updatePersonalData(code, +id, data);
  }

  @Get('data/financial/:id')
  @ApiOkResponse({ type: KycFinancialOutData })
  async getFinancialData(
    @Headers(CodeHeaderName) code: string,
    @Param('id') id: string,
    @Query('lang') lang: string,
  ): Promise<KycFinancialOutData> {
    return this.kycService.getFinancialData(code, +id, lang);
  }

  @Put('data/financial/:id')
  @ApiOkResponse({ type: KycResultDto })
  async updateFinancialData(
    @Headers(CodeHeaderName) code: string,
    @Param('id') id: string,
    @Body() data: KycFinancialInData,
  ): Promise<KycResultDto> {
    return this.kycService.updateFinancialData(code, +id, data);
  }

  @Post('ident/:type')
  @ApiExcludeEndpoint()
  async autoIdWebhook(@RealIP() ip: string, @Body() data: IdentResultDto) {
    this.checkWebhookIp(ip, data);
    await this.kycService.updateIdent(data);
  }

  @Get('ident/:type/:status')
  @ApiExcludeEndpoint()
  async identRedirectSuccess(
    @Res() res,
    @Param('status') status: IdentStatus,
    @Query('transactionId') transactionId: string,
  ): Promise<void> {
    const kycStep = await this.kycService.updateIdentStatus(transactionId, status);
    res.redirect(307, `${Config.frontend.services}/iframe-message?status=${kycStep.status}`);
  }

  @Put('document/:id')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOkResponse({ type: KycResultDto })
  async uploadDocument(
    @Headers(CodeHeaderName) code: string,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<KycResultDto> {
    return this.kycService.uploadDocument(code, +id, file);
  }

  // --- HELPER METHODS --- //
  private checkWebhookIp(ip: string, data: IdentResultDto) {
    if (!Config.kyc.allowedWebhookIps.includes('*') && !Config.kyc.allowedWebhookIps.includes(ip)) {
      this.logger.error(`Received webhook call from invalid IP ${ip}: ${JSON.stringify(data)}`);
      throw new ForbiddenException('Invalid source IP');
    }
  }
}
