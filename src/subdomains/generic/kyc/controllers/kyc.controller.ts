import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  InternalServerErrorException,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiExcludeEndpoint,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Response } from 'express';
import { RealIP } from 'nestjs-real-ip';
import { Config, GetConfig } from 'src/config/config';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { CountryDtoMapper } from 'src/shared/models/country/dto/country-dto.mapper';
import { CountryDto } from 'src/shared/models/country/dto/country.dto';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { IdNowResult } from '../dto/ident-result.dto';
import { IdentStatus } from '../dto/ident.dto';
import {
  KycContactData,
  KycFileData,
  KycLegalEntityData,
  KycManualIdentData,
  KycNationalityData,
  KycPersonalData,
  KycSignatoryPowerData,
} from '../dto/input/kyc-data.dto';
import { KycFinancialInData } from '../dto/input/kyc-financial-in.dto';
import { Start2faDto } from '../dto/input/start-2fa.dto';
import { Verify2faDto } from '../dto/input/verify-2fa.dto';
import { FileType } from '../dto/kyc-file.dto';
import { KycFinancialOutData } from '../dto/output/kyc-financial-out.dto';
import { KycLevelDto, KycSessionDto } from '../dto/output/kyc-info.dto';
import { MergedDto } from '../dto/output/kyc-merged.dto';
import { KycResultDto } from '../dto/output/kyc-result.dto';
import { Setup2faDto } from '../dto/output/setup-2fa.dto';
import { SumSubWebhookResult } from '../dto/sum-sub.dto';
import { SumsubService } from '../services/integration/sum-sub.service';
import { KycService } from '../services/kyc.service';
import { TfaService } from '../services/tfa.service';

const CodeHeaderName = 'x-kyc-code';
const MergedResponse = {
  description: 'User is merged, switch to the KYC code provided in the response',
  type: MergedDto,
};
const TfaResponse = { description: '2FA is required' };

@ApiTags('KYC')
@Controller({ path: 'kyc', version: [GetConfig().kycVersion] })
export class KycController {
  private readonly logger = new DfxLogger(KycController);

  constructor(private readonly kycService: KycService, private readonly tfaService: TfaService) {}

  // --- 2FA --- //
  @Get('2fa')
  @ApiOkResponse({ description: '2FA active' })
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ACCOUNT))
  async check2fa(@GetJwt() jwt: JwtPayload, @RealIP() ip: string, @Query() { level }: Start2faDto): Promise<void> {
    return this.tfaService.check(jwt.account, ip, level);
  }

  @Post('2fa')
  @ApiCreatedResponse({ type: Setup2faDto })
  @ApiUnauthorizedResponse(MergedResponse)
  async start2fa(@Headers(CodeHeaderName) code: string, @Query() { level }: Start2faDto): Promise<Setup2faDto> {
    return this.tfaService.setup(code, level);
  }

  @Post('2fa/verify')
  @ApiCreatedResponse({ description: '2FA successful' })
  @ApiUnauthorizedResponse(MergedResponse)
  @ApiForbiddenResponse({ description: 'Invalid or expired 2FA token' })
  async verify2fa(
    @Headers(CodeHeaderName) code: string,
    @RealIP() ip: string,
    @Body() dto: Verify2faDto,
  ): Promise<void> {
    return this.tfaService.verify(code, dto.token, ip);
  }

  // --- KYC --- //
  @Get()
  @ApiOkResponse({ type: KycLevelDto })
  @ApiUnauthorizedResponse(MergedResponse)
  async getKycLevel(@Headers(CodeHeaderName) code: string): Promise<KycLevelDto> {
    return this.kycService.getInfo(code);
  }

  @Put()
  @ApiOkResponse({ type: KycSessionDto })
  @ApiUnauthorizedResponse(MergedResponse)
  @ApiConflictResponse({ description: 'There is already a verified account with the same mail address' })
  @ApiForbiddenResponse(TfaResponse)
  async continueKyc(
    @Headers(CodeHeaderName) code: string,
    @RealIP() ip: string,
    @Query('autoStep') autoStep?: string,
  ): Promise<KycSessionDto> {
    return this.kycService.continue(code, ip, autoStep !== 'false');
  }

  @Get('countries')
  @ApiOkResponse({ type: CountryDto, isArray: true })
  @ApiUnauthorizedResponse(MergedResponse)
  async getKycCountries(@Headers(CodeHeaderName) code: string): Promise<CountryDto[]> {
    return this.kycService.getCountries(code).then(CountryDtoMapper.entitiesToDto);
  }

  @Get(':step')
  @ApiExcludeEndpoint()
  async initiateStep(
    @Headers(CodeHeaderName) code: string,
    @RealIP() ip: string,
    @Param('step') stepName: string,
    @Query('type') stepType?: string,
    @Query('sequence') sequence?: string,
  ): Promise<KycSessionDto> {
    return this.kycService.getOrCreateStep(code, ip, stepName, stepType, sequence ? +sequence : undefined);
  }

  @Post('transfer')
  @ApiExcludeEndpoint()
  async addKycClient(@Headers(CodeHeaderName) code: string, @Query('client') walletName: string) {
    return this.kycService.addKycClient(code, walletName);
  }

  @Delete('transfer')
  @ApiExcludeEndpoint()
  async removeKycClient(@Headers(CodeHeaderName) code: string, @Query('client') walletName: string) {
    return this.kycService.removeKycClient(code, walletName);
  }

  // --- UPDATE ENDPOINTS --- //
  @Put('data/contact/:id')
  @ApiOkResponse({ type: KycResultDto })
  @ApiUnauthorizedResponse(MergedResponse)
  async updateContactData(
    @Headers(CodeHeaderName) code: string,
    @Param('id') id: string,
    @Body() data: KycContactData,
  ): Promise<KycResultDto> {
    return this.kycService.updateContactData(code, +id, data);
  }

  @Put('data/personal/:id')
  @ApiOkResponse({ type: KycResultDto })
  @ApiUnauthorizedResponse(MergedResponse)
  async updatePersonalData(
    @Headers(CodeHeaderName) code: string,
    @Param('id') id: string,
    @Body() data: KycPersonalData,
  ): Promise<KycResultDto> {
    return this.kycService.updatePersonalData(code, +id, data);
  }

  @Put('data/legal/:id')
  @ApiOkResponse({ type: KycResultDto })
  @ApiUnauthorizedResponse(MergedResponse)
  async updateLegalEntityData(
    @Headers(CodeHeaderName) code: string,
    @Param('id') id: string,
    @Body() data: KycLegalEntityData,
  ): Promise<KycResultDto> {
    return this.kycService.updateKycStep(code, +id, data, false);
  }

  @Put('data/stock/:id')
  @ApiOkResponse({ type: KycResultDto })
  @ApiUnauthorizedResponse(MergedResponse)
  async updateStockRegisterData(
    @Headers(CodeHeaderName) code: string,
    @Param('id') id: string,
    @Body() data: KycFileData,
  ): Promise<KycResultDto> {
    data.fileName = this.fileName('stock-register', data.fileName);
    return this.kycService.updateFileData(code, +id, data, FileType.STOCK_REGISTER);
  }

  @Put('data/nationality/:id')
  @ApiOkResponse({ type: KycResultDto })
  @ApiUnauthorizedResponse(MergedResponse)
  async updateNationalityData(
    @Headers(CodeHeaderName) code: string,
    @Param('id') id: string,
    @Body() data: KycNationalityData,
  ): Promise<KycResultDto> {
    return this.kycService.updateKycStep(code, +id, data, true);
  }

  @Put('data/commercial/:id')
  @ApiOkResponse({ type: KycResultDto })
  @ApiUnauthorizedResponse(MergedResponse)
  async updateCommercialRegisterData(
    @Headers(CodeHeaderName) code: string,
    @Param('id') id: string,
    @Body() data: KycFileData,
  ): Promise<KycResultDto> {
    data.fileName = this.fileName('commercial-register', data.fileName);
    return this.kycService.updateFileData(code, +id, data, FileType.COMMERCIAL_REGISTER);
  }

  @Put('data/residence/:id')
  @ApiOkResponse({ type: KycResultDto })
  @ApiUnauthorizedResponse(MergedResponse)
  async updateResidencePermitData(
    @Headers(CodeHeaderName) code: string,
    @RealIP() ip: string,
    @Param('id') id: string,
    @Body() data: KycFileData,
  ): Promise<KycResultDto> {
    data.fileName = this.fileName('residence-permit', data.fileName);
    return this.kycService.updateFileData(code, +id, data, FileType.RESIDENCE_PERMIT);
  }

  @Put('data/additional/:id')
  @ApiOkResponse({ type: KycResultDto })
  @ApiUnauthorizedResponse(MergedResponse)
  async updateAdditionalDocumentsData(
    @Headers(CodeHeaderName) code: string,
    @RealIP() ip: string,
    @Param('id') id: string,
    @Body() data: KycFileData,
  ): Promise<KycResultDto> {
    data.fileName = this.fileName('additional-documents', data.fileName);
    return this.kycService.updateFileData(code, +id, data, FileType.ADDITIONAL_DOCUMENTS);
  }

  @Put('data/signatory/:id')
  @ApiOkResponse({ type: KycResultDto })
  @ApiUnauthorizedResponse(MergedResponse)
  async updateSignatoryPowerData(
    @Headers(CodeHeaderName) code: string,
    @Param('id') id: string,
    @Body() data: KycSignatoryPowerData,
  ): Promise<KycResultDto> {
    return this.kycService.updateKycStep(code, +id, data, true);
  }

  @Put('data/authority/:id')
  @ApiOkResponse({ type: KycResultDto })
  @ApiUnauthorizedResponse(MergedResponse)
  async updateAuthorityData(
    @Headers(CodeHeaderName) code: string,
    @Param('id') id: string,
    @Body() data: KycFileData,
  ): Promise<KycResultDto> {
    data.fileName = this.fileName('authority', data.fileName);
    return this.kycService.updateFileData(code, +id, data, FileType.AUTHORITY);
  }

  @Get('data/financial/:id')
  @ApiOkResponse({ type: KycFinancialOutData })
  @ApiUnauthorizedResponse(MergedResponse)
  @ApiForbiddenResponse(TfaResponse)
  async getFinancialData(
    @Headers(CodeHeaderName) code: string,
    @RealIP() ip: string,
    @Param('id') id: string,
    @Query('lang') lang: string,
  ): Promise<KycFinancialOutData> {
    return this.kycService.getFinancialData(code, ip, +id, lang);
  }

  @Put('data/financial/:id')
  @ApiOkResponse({ type: KycResultDto })
  @ApiUnauthorizedResponse(MergedResponse)
  @ApiForbiddenResponse(TfaResponse)
  async updateFinancialData(
    @Headers(CodeHeaderName) code: string,
    @RealIP() ip: string,
    @Param('id') id: string,
    @Body() data: KycFinancialInData,
  ): Promise<KycResultDto> {
    return this.kycService.updateFinancialData(code, ip, +id, data);
  }

  @Post('ident/sumsub')
  @ApiExcludeEndpoint()
  async sumsubWebhook(@Req() req: Request, @Body() data: any) {
    if (!SumsubService.checkWebhook(req, req.body)) {
      this.logger.error(`Received invalid sumsub webhook: ${data}`);
      throw new ForbiddenException('Invalid key');
    }

    try {
      await this.kycService.updateSumsubIdent(JSON.parse(data) as SumSubWebhookResult);
    } catch (e) {
      this.logger.error(`Failed to handle sumsub ident webhook call for applicant ${data.applicantId}:`, e);
      throw new InternalServerErrorException(e.message);
    }
  }

  @Put('ident/manual/:id')
  @ApiOkResponse({ type: KycResultDto })
  @ApiUnauthorizedResponse(MergedResponse)
  async updateIdentData(
    @Headers(CodeHeaderName) code: string,
    @Param('id') id: string,
    @Body() data: KycManualIdentData,
  ): Promise<KycResultDto> {
    return this.kycService.updateIdentManual(code, +id, data);
  }

  @Post('ident/:type')
  @ApiExcludeEndpoint()
  async identWebhook(@RealIP() ip: string, @Body() data: IdNowResult) {
    this.checkWebhookIp(ip, data);

    try {
      await this.kycService.updateIntrumIdent(data);
    } catch (e) {
      this.logger.error(`Failed to handle intrum ident webhook call for session ${data.identificationprocess?.id}:`, e);
      throw new InternalServerErrorException(e.message);
    }
  }

  @Get('ident/:type/:channel/:status')
  @ApiExcludeEndpoint()
  async identRedirect(
    @Res() res: Response,
    @Param('status') status: IdentStatus,
    @Query('transactionId') transactionId: string,
  ): Promise<void> {
    const redirectUri = await this.kycService.updateIdentStatus(transactionId, status);
    this.allowFrameIntegration(res);
    res.redirect(307, redirectUri);
  }

  // --- HELPER METHODS --- //
  private checkWebhookIp(ip: string, data: IdNowResult) {
    if (!Config.kyc.allowedWebhookIps.includes('*') && !Config.kyc.allowedWebhookIps.includes(ip)) {
      this.logger.error(`Received webhook call from invalid IP ${ip}: ${JSON.stringify(data)}`);
      throw new ForbiddenException('Invalid source IP');
    }
  }

  private allowFrameIntegration(res: Response) {
    res.removeHeader('X-Frame-Options');

    const contentPolicy = res.getHeader('Content-Security-Policy') as string;
    const updatedPolicy = contentPolicy
      ?.split(';')
      .filter((p) => !p.includes('frame-ancestors'))
      .join(';');
    res.setHeader('Content-Security-Policy', updatedPolicy);
  }

  private fileName(type: string, file: string): string {
    return `${Util.isoDateTime(new Date())}_${type}_user-upload_${Util.randomId()}_${file}`;
  }
}
