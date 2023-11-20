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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiExcludeEndpoint, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { RealIP } from 'nestjs-real-ip';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { IdentResultDto } from '../../user/models/ident/dto/ident-result.dto';
import { KycContactData } from '../dto/input/kyc-contact-data.dto';
import { KycPersonalData } from '../dto/input/kyc-personal-data.dto';
import { KycInfoDto, KycStepDto } from '../dto/output/kyc-info.dto';
import { KycResultDto } from '../dto/output/kyc-result.dto';
import { KycStepName, KycStepType } from '../enums/kyc.enum';
import { IdentService } from '../services/integration/ident.service';
import { KycService } from '../services/kyc.service';

const CodeHeaderName = 'x-kyc-code';

@ApiTags('KYC')
@Controller({ path: 'kyc', version: ['2'] })
export class KycController {
  private readonly logger = new DfxLogger(KycController);

  constructor(private readonly kycService: KycService, private readonly identService: IdentService) {}

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

  private checkWebhookIp(ip: string, data: IdentResultDto) {
    if (!Config.kyc.allowedWebhookIps.includes('*') && !Config.kyc.allowedWebhookIps.includes(ip)) {
      this.logger.error(`Received webhook call from invalid IP ${ip}: ${JSON.stringify(data)}`);
      throw new ForbiddenException('Invalid source IP');
    }
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
  // TODO: should we merge the contact/personal endpoints?
  @Put('data/contact/:id')
  @ApiOkResponse()
  async updateContactData(
    @Headers(CodeHeaderName) code: string,
    @Param('id') id: string,
    @Body() data: KycContactData,
  ): Promise<KycResultDto> {
    return this.kycService.updateContactData(code, +id, data);
  }

  @Put('data/personal/:id')
  @ApiOkResponse()
  async updatePersonalData(
    @Headers(CodeHeaderName) code: string,
    @Param('id') id: string,
    @Body() data: KycPersonalData,
  ): Promise<KycResultDto> {
    return this.kycService.updatePersonalData(code, +id, data);
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

  @Post('ident/online')
  @ApiExcludeEndpoint()
  async onlineIdWebhook(@RealIP() ip: string, @Body() data: IdentResultDto) {
    this.checkWebhookIp(ip, data);
    await this.kycService.updateIdent(data);
  }

  @Post('ident/video')
  @ApiExcludeEndpoint()
  async videoIdWebhook(@RealIP() ip: string, @Body() data: IdentResultDto) {
    this.checkWebhookIp(ip, data);
    await this.kycService.updateIdent(data);
  }

  @Put('document/:id')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOkResponse()
  async uploadDocument(
    @Headers(CodeHeaderName) code: string,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<KycResultDto> {
    return this.kycService.uploadDocument(code, +id, file);
  }
}
