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
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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
import { CountryDtoMapper } from 'src/shared/models/country/dto/country-dto.mapper';
import { CountryDto } from 'src/shared/models/country/dto/country.dto';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { IdentStatus } from '../dto/ident.dto';
import { IdentResultDto } from '../dto/input/ident-result.dto';
import { KycContactData, KycPersonalData } from '../dto/input/kyc-data.dto';
import { KycFinancialInData } from '../dto/input/kyc-financial-in.dto';
import { LimitRequestDto } from '../dto/input/limit-request.dto';
import { Verify2faDto } from '../dto/input/verify-2fa.dto';
import { KycFinancialOutData } from '../dto/output/kyc-financial-out.dto';
import { KycLevelDto, KycSessionDto } from '../dto/output/kyc-info.dto';
import { MergedDto } from '../dto/output/kyc-merged.dto';
import { KycResultDto } from '../dto/output/kyc-result.dto';
import { Setup2faDto } from '../dto/output/setup-2fa.dto';
import { KycService } from '../services/kyc.service';
import { LimitRequestService } from '../services/limit-request.service';
import { TfaService } from '../services/tfa.service';

const CodeHeaderName = 'x-kyc-code';
const MergedResponse = {
  description: 'User is merged, reload the user or switch to the KYC code provided in the response',
  type: MergedDto,
};
const TfaResponse = { description: '2FA is required' };

@ApiTags('KYC')
@Controller({ path: 'kyc', version: [GetConfig().kycVersion] })
export class KycController {
  private readonly logger = new DfxLogger(KycController);

  constructor(
    private readonly kycService: KycService,
    private readonly tfaService: TfaService,
    private readonly limitService: LimitRequestService,
  ) {}

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
  async addKycClient(
    @Headers(CodeHeaderName) code: string,
    @GetJwt() jwt: JwtPayload,
    @Query('client') walletName: string,
  ) {
    return this.kycService.addKycClient(jwt.account, walletName);
  }

  @Delete('transfer')
  @ApiExcludeEndpoint()
  async removeKycClient(
    @Headers(CodeHeaderName) code: string,
    @GetJwt() jwt: JwtPayload,
    @Query('client') walletName: string,
  ) {
    return this.kycService.removeKycClient(jwt.account, walletName);
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

  @Post('ident/:type')
  @ApiExcludeEndpoint()
  async identWebhook(@RealIP() ip: string, @Body() data: IdentResultDto) {
    this.checkWebhookIp(ip, data);

    try {
      await this.kycService.updateIdent(data);
    } catch (e) {
      this.logger.error(`Failed to handle ident webhook call for session ${data.identificationprocess.id}:`, e);
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

  @Put('document/:id')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOkResponse({ type: KycResultDto })
  @ApiUnauthorizedResponse(MergedResponse)
  async uploadDocument(
    @Headers(CodeHeaderName) code: string,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<KycResultDto> {
    return this.kycService.uploadDocument(code, +id, file);
  }

  // --- 2FA --- //
  @Post('2fa')
  @ApiCreatedResponse({ type: Setup2faDto })
  @ApiUnauthorizedResponse(MergedResponse)
  async createSecret(@Headers(CodeHeaderName) code: string): Promise<Setup2faDto> {
    return this.tfaService.setup(code);
  }

  @Post('2fa/verify')
  @ApiCreatedResponse({ description: '2FA successful' })
  @ApiUnauthorizedResponse(MergedResponse)
  @ApiForbiddenResponse({ description: 'Invalid or expired 2FA token' })
  async verifyToken(
    @Headers(CodeHeaderName) code: string,
    @RealIP() ip: string,
    @Body() dto: Verify2faDto,
  ): Promise<void> {
    return this.tfaService.verify(code, dto.token, ip);
  }

  // --- LIMIT INCREASE --- //
  @Post('limit')
  @ApiCreatedResponse({ description: 'Limit request initiated' })
  @ApiUnauthorizedResponse(MergedResponse)
  async increaseLimit(@Headers(CodeHeaderName) code: string, @Body() request: LimitRequestDto): Promise<void> {
    return this.limitService.increaseLimit(request, code);
  }

  // --- HELPER METHODS --- //
  private checkWebhookIp(ip: string, data: IdentResultDto) {
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
}
