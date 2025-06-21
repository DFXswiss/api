import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiExcludeEndpoint,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';
import { BinancePayWebhookDto } from 'src/integration/c2b-payment-link/dto/binance.dto';
import { BinancePayWebhookGuard } from 'src/integration/c2b-payment-link/guards/binance-pay-webhook.guard';
import { C2BPaymentProvider } from 'src/integration/c2b-payment-link/share/providers.enum';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { SellService } from 'src/subdomains/core/sell-crypto/route/sell.service';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { CreateInvoicePaymentDto } from '../dto/create-invoice-payment.dto';
import { CreatePaymentLinkPaymentDto } from '../dto/create-payment-link-payment.dto';
import { CreatePaymentLinkDto } from '../dto/create-payment-link.dto';
import { GetPaymentLinkHistoryDto } from '../dto/get-payment-link-history.dto';
import { PaymentLinkConfigDto, UpdatePaymentLinkConfigDto } from '../dto/payment-link-config.dto';
import { PaymentLinkDtoMapper } from '../dto/payment-link-dto.mapper';
import { PaymentLinkDto, PaymentLinkHistoryDto, PaymentLinkPayRequestDto } from '../dto/payment-link.dto';
import { PaymentRecipientMapper } from '../dto/payment-recipient-mapper';
import { PaymentRecipientDto } from '../dto/payment-recipient.dto';
import { UpdatePaymentLinkPaymentDto } from '../dto/update-payment-link-payment.dto';
import { UpdatePaymentLinkDto, UpdatePaymentLinkInternalDto } from '../dto/update-payment-link.dto';
import { PaymentLinkPayment } from '../entities/payment-link-payment.entity';
import { PaymentLink } from '../entities/payment-link.entity';
import { JwtOrPaymentLinkKeyGuard } from '../guards/jwt-or-payment-link-key.guard';
import { PaymentLinkPaymentService } from '../services/payment-link-payment.service';
import { PaymentLinkService } from '../services/payment-link.service';

@ApiTags('Payment Link')
@Controller('paymentLink')
export class PaymentLinkController {
  private readonly logger = new DfxLogger(PaymentLinkController);
  constructor(
    private readonly userDataService: UserDataService,
    private readonly paymentLinkService: PaymentLinkService,
    private readonly paymentLinkPaymentService: PaymentLinkPaymentService,
    private readonly sellService: SellService,
  ) {}

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER), UserActiveGuard())
  @ApiOkResponse({ type: PaymentLinkDto, isArray: true })
  @ApiQuery({ name: 'linkId', description: 'Link ID', required: false })
  @ApiQuery({ name: 'externalLinkId', description: 'External link ID', required: false })
  @ApiQuery({ name: 'externalPaymentId', description: 'External payment ID', required: false })
  async getAllPaymentLinks(
    @GetJwt() jwt: JwtPayload,
    @Query('linkId') linkId: string,
    @Query('externalLinkId') externalLinkId: string,
    @Query('externalPaymentId') externalPaymentId: string,
  ): Promise<PaymentLinkDto | PaymentLinkDto[]> {
    if (linkId || externalLinkId || externalPaymentId)
      return this.paymentLinkService
        .getOrThrow(+jwt.user, +linkId, externalLinkId, externalPaymentId)
        .then(PaymentLinkDtoMapper.toLinkDto);

    return this.paymentLinkService.getAll(+jwt.user).then(PaymentLinkDtoMapper.toLinkDtoList);
  }

  @Get('history')
  @ApiBearerAuth()
  @UseGuards(JwtOrPaymentLinkKeyGuard)
  @ApiOkResponse({ type: PaymentLinkHistoryDto, isArray: true })
  @ApiQuery({ name: 'externalLinkId', description: 'External link ID', required: false })
  @ApiQuery({ name: 'key', description: 'Payment link access key', required: false })
  async getPaymentHistory(
    @GetJwt() jwt: JwtPayload,
    @Query() dto: GetPaymentLinkHistoryDto,
    @Query('externalLinkId') externalLinkId: string,
    @Query('key') key: string,
  ): Promise<PaymentLinkHistoryDto[]> {
    return this.paymentLinkService
      .getHistoryByStatus(+jwt?.user, dto.status, dto.from, dto.to, key, externalLinkId)
      .then(PaymentLinkDtoMapper.toLinkHistoryDtoList);
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER), UserActiveGuard())
  @ApiCreatedResponse({ type: PaymentLinkDto })
  async createPaymentLink(@GetJwt() jwt: JwtPayload, @Body() dto: CreatePaymentLinkDto): Promise<PaymentLinkDto> {
    await this.checkPaymentLinksAllowed(jwt.account);

    return this.paymentLinkService.create(+jwt.user, dto).then(PaymentLinkDtoMapper.toLinkDto);
  }

  @Put()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER), UserActiveGuard())
  @ApiOkResponse({ type: PaymentLinkDto })
  @ApiQuery({ name: 'linkId', description: 'Link ID', required: false })
  @ApiQuery({ name: 'externalLinkId', description: 'External link ID', required: false })
  @ApiQuery({ name: 'externalPaymentId', description: 'External payment ID', required: false })
  async updatePaymentLink(
    @GetJwt() jwt: JwtPayload,
    @Query('linkId') linkId: string,
    @Query('externalLinkId') externalLinkId: string,
    @Query('externalPaymentId') externalPaymentId: string,
    @Body() dto: UpdatePaymentLinkDto,
  ): Promise<PaymentLinkDto> {
    await this.checkPaymentLinksAllowed(jwt.account);

    return this.paymentLinkService
      .update(+jwt.user, dto, +linkId, externalLinkId, externalPaymentId)
      .then(PaymentLinkDtoMapper.toLinkDto);
  }

  // -- CONFIG --- //

  @Get('config')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT), UserActiveGuard())
  @ApiOkResponse({ type: PaymentLinkConfigDto })
  async getUserPaymentLinksConfig(@GetJwt() jwt: JwtPayload): Promise<PaymentLinkConfigDto> {
    return this.paymentLinkService.getUserPaymentLinksConfig(jwt.account);
  }

  @Put('config')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT), UserActiveGuard())
  @ApiOkResponse()
  async updateUserPaymentLinksConfig(
    @GetJwt() jwt: JwtPayload,
    @Body() dto: UpdatePaymentLinkConfigDto,
  ): Promise<void> {
    return this.paymentLinkService.updateUserPaymentLinksConfig(jwt.account, dto);
  }

  // --- PAYMENT --- //

  @Get('recipient')
  @ApiExcludeEndpoint()
  @ApiQuery({ name: 'id', description: 'Route ID or label', required: true })
  async getPaymentRecipient(@Query('id') id: string): Promise<PaymentRecipientDto> {
    const sellRoute = await this.sellService.getPaymentRoute(id);
    return PaymentRecipientMapper.toDto(sellRoute);
  }

  @Get('payment')
  @ApiExcludeEndpoint()
  async createInvoicePayment(@Query() dto: CreateInvoicePaymentDto): Promise<PaymentLinkPayRequestDto> {
    if (dto.r) {
      const isRouteId = !isNaN(+dto.r);
      if (isRouteId) {
        dto.routeId ??= dto.r;
      } else {
        dto.route ??= dto.r;
      }
    }
    dto.externalId ??= dto.e;
    dto.note ??= dto.n;
    dto.message ??= dto.m;
    dto.label ??= dto.l;
    dto.amount ??= dto.a;
    dto.currency ??= dto.c;
    dto.expiryDate ??= dto.d;
    dto.standard ??= dto.s;
    dto.webhookUrl ??= dto.w;
    dto.externalId ??= `${dto.message}/${dto.amount}${dto.currency ?? ''}`;

    const link = await this.paymentLinkService.createInvoice(dto);
    return this.paymentLinkService.createPayRequestWithCompletionCheck(link.uniqueId, dto.standard);
  }

  @Post('payment')
  @UseGuards(JwtOrPaymentLinkKeyGuard)
  @ApiCreatedResponse({ type: PaymentLinkDto })
  @ApiQuery({ name: 'linkId', description: 'Link ID', required: false })
  @ApiQuery({ name: 'externalLinkId', description: 'External link ID', required: false })
  @ApiQuery({ name: 'key', description: 'Payment link access key', required: false })
  @ApiQuery({ name: 'route', description: 'Route label', required: false })
  async createPayment(
    @GetJwt() jwt: JwtPayload,
    @Query('linkId') linkId: string,
    @Query('externalLinkId') externalLinkId: string,
    @Query('key') key: string,
    @Query('route') route: string,
    @Body() dto: CreatePaymentLinkPaymentDto,
  ): Promise<PaymentLinkDto> {
    if (key) {
      if (!externalLinkId) throw new BadRequestException('External Link ID is required');

      return this.paymentLinkService
        .createPaymentForRouteWithAccessKey(dto, key, externalLinkId, route)
        .then(PaymentLinkDtoMapper.toLinkDto);
    }

    return this.paymentLinkService
      .createPayment(+jwt.user, dto, +linkId, externalLinkId)
      .then(PaymentLinkDtoMapper.toLinkDto);
  }

  @Get('payment/wait')
  @ApiBearerAuth()
  @UseGuards(JwtOrPaymentLinkKeyGuard)
  @ApiOkResponse({ type: PaymentLinkDto })
  @ApiQuery({ name: 'linkId', description: 'Link ID', required: false })
  @ApiQuery({ name: 'externalLinkId', description: 'External link ID', required: false })
  @ApiQuery({ name: 'externalPaymentId', description: 'External payment ID', required: false })
  @ApiQuery({ name: 'key', description: 'Payment link access key', required: false })
  async waitForPayment(
    @GetJwt() jwt: JwtPayload,
    @Query('linkId') linkId: string,
    @Query('externalLinkId') externalLinkId: string,
    @Query('externalPaymentId') externalPaymentId: string,
    @Query('key') key: string,
  ): Promise<PaymentLinkDto> {
    return this.paymentLinkService
      .waitForPayment(+jwt?.user, +linkId, externalLinkId, externalPaymentId, key)
      .then(PaymentLinkDtoMapper.toLinkDto);
  }

  @Put('payment/confirm')
  @ApiBearerAuth()
  @UseGuards(JwtOrPaymentLinkKeyGuard)
  @ApiOkResponse({ type: PaymentLinkDto })
  @ApiQuery({ name: 'linkId', description: 'Link ID', required: false })
  @ApiQuery({ name: 'externalLinkId', description: 'External link ID', required: false })
  @ApiQuery({ name: 'externalPaymentId', description: 'External payment ID', required: false })
  @ApiQuery({ name: 'key', description: 'Payment link access key', required: false })
  async confirmPayment(
    @GetJwt() jwt: JwtPayload,
    @Query('linkId') linkId: string,
    @Query('externalLinkId') externalLinkId: string,
    @Query('externalPaymentId') externalPaymentId: string,
    @Query('key') key: string,
  ): Promise<PaymentLinkDto> {
    return this.paymentLinkService
      .confirmPayment(+jwt?.user, +linkId, externalLinkId, externalPaymentId, key)
      .then(PaymentLinkDtoMapper.toLinkDto);
  }

  @Delete('payment')
  @ApiBearerAuth()
  @UseGuards(JwtOrPaymentLinkKeyGuard)
  @ApiOkResponse({ type: PaymentLinkDto })
  @ApiQuery({ name: 'linkId', description: 'Link ID', required: false })
  @ApiQuery({ name: 'externalLinkId', description: 'External link ID', required: false })
  @ApiQuery({ name: 'externalPaymentId', description: 'External payment ID', required: false })
  @ApiQuery({ name: 'key', description: 'Payment link access key', required: false })
  async cancelPayment(
    @GetJwt() jwt: JwtPayload,
    @Query('linkId') linkId: string,
    @Query('externalLinkId') externalLinkId: string,
    @Query('externalPaymentId') externalPaymentId: string,
    @Query('key') key: string,
  ): Promise<PaymentLinkDto> {
    return this.paymentLinkService
      .cancelPayment(+jwt?.user, +linkId, externalLinkId, externalPaymentId, key)
      .then(PaymentLinkDtoMapper.toLinkDto);
  }

  // --- ADMIN --- //

  @Put('payment/:id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async updatePaymentLinkPayment(
    @Param('id') id: string,
    @Body() dto: UpdatePaymentLinkPaymentDto,
  ): Promise<PaymentLinkPayment> {
    return this.paymentLinkPaymentService.updatePayment(+id, dto);
  }

  @Put(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async updatePaymentLinkAdmin(
    @Param('id') id: string,
    @Body() dto: UpdatePaymentLinkInternalDto,
  ): Promise<PaymentLink> {
    return this.paymentLinkService.updatePaymentLinkAdmin(+id, dto);
  }

  @Get('stickers')
  @ApiExcludeEndpoint()
  @ApiOkResponse({ type: StreamableFile })
  @ApiQuery({ name: 'route', description: 'Route ID or label', required: true })
  @ApiQuery({ name: 'externalIds', description: 'Comma-separated external IDs', required: false })
  @ApiQuery({ name: 'ids', description: 'Comma-separated payment link IDs', required: false })
  @ApiQuery({ name: 'lang', description: 'Language code', required: false })
  async generateOcpStickers(
    @Query('route') route: string,
    @Query('externalIds') externalIds: string,
    @Query('ids') ids: string,
    @Query('lang') lang: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    if (!externalIds && !ids) {
      throw new BadRequestException('Either externalIds or ids parameter must be provided');
    }

    const idArray = ids?.split(',').map((id) => +id);
    const externalIdArray = externalIds?.split(',').map((id) => id.trim());
    const pdfBuffer = await this.paymentLinkService.generateOcpStickersPdf(route, externalIdArray, idArray, lang);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="DFX_OCP_stickers_${Util.filenameDate()}.pdf"`,
    });

    return new StreamableFile(pdfBuffer);
  }

  // --- INTEGRATION --- //
  @Post('integration/binance/webhook')
  @ApiExcludeEndpoint()
  @UseGuards(BinancePayWebhookGuard)
  async binancePayWebhook(@Body() dto: BinancePayWebhookDto): Promise<{ returnCode: string; returnMessage: string }> {
    void this.paymentLinkPaymentService.handleWebhook(C2BPaymentProvider.BINANCE_PAY, dto).catch((error) => {
      this.logger.error('Error handling Binance Pay webhook', error);
    });
    return { returnCode: 'SUCCESS', returnMessage: null };
  }

  @Post('integration/binance/activate/:id')
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async activateBinancePay(@Param('id') id: string): Promise<void> {
    await this.paymentLinkService.activateC2BPaymentLink(id, C2BPaymentProvider.BINANCE_PAY);
  }

  // --- HELPER METHODS --- //

  private async checkPaymentLinksAllowed(userDataId: number): Promise<void> {
    const userData = await this.userDataService.getUserData(userDataId);
    if (!userData.paymentLinksAllowed) throw new ForbiddenException('Permission denied');
  }
}

@ApiTags('Payment Link')
@Controller()
export class PaymentLinkShortController {
  constructor(private readonly paymentLinkController: PaymentLinkController) {}

  @Get('plp')
  @ApiExcludeEndpoint()
  async createInvoicePayment(@Query() dto: CreateInvoicePaymentDto): Promise<PaymentLinkPayRequestDto> {
    return this.paymentLinkController.createInvoicePayment(dto);
  }
}
