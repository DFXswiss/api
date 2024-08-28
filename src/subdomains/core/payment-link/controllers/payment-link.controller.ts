import { Body, Controller, Delete, ForbiddenException, Get, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiExcludeEndpoint,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { LnUrlForwardService } from 'src/subdomains/generic/forwarding/services/lnurl-forward.service';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { CreateInvoicePaymentDto } from '../dto/create-invoice-payment.dto';
import { CreatePaymentLinkPaymentDto } from '../dto/create-payment-link-payment.dto';
import { CreatePaymentLinkDto } from '../dto/create-payment-link.dto';
import { PaymentLinkDtoMapper } from '../dto/payment-link-dto.mapper';
import { PaymentLinkDto, PaymentLinkPayRequestDto } from '../dto/payment-link.dto';
import { UpdatePaymentLinkDto } from '../dto/update-payment-link.dto';
import { PaymentLinkService } from '../services/payment-link.service';

@ApiTags('Payment Link')
@Controller('paymentLink')
export class PaymentLinkController {
  constructor(
    private readonly userDataService: UserDataService,
    private readonly paymentLinkService: PaymentLinkService,
    private readonly lnurlForwardService: LnUrlForwardService,
  ) {}

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
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
    await this.checkPaymentLinksAllowed(jwt.account);

    if (linkId || externalLinkId || externalPaymentId)
      return this.paymentLinkService
        .getOrThrow(+jwt.user, +linkId, externalLinkId, externalPaymentId)
        .then(PaymentLinkDtoMapper.toLinkDto);

    return this.paymentLinkService.getAll(+jwt.user).then(PaymentLinkDtoMapper.toLinkDtoList);
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiCreatedResponse({ type: PaymentLinkDto })
  async createPaymentLink(@GetJwt() jwt: JwtPayload, @Body() dto: CreatePaymentLinkDto): Promise<PaymentLinkDto> {
    await this.checkPaymentLinksAllowed(jwt.account);

    return this.paymentLinkService.create(+jwt.user, dto).then(PaymentLinkDtoMapper.toLinkDto);
  }

  @Put()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
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

  @Get('payment')
  @ApiExcludeEndpoint()
  async createInvoicePayment(@Query() dto: CreateInvoicePaymentDto): Promise<PaymentLinkPayRequestDto> {
    dto.routeId ??= dto.r;
    dto.externalId ??= dto.e;
    dto.message ??= dto.m;
    dto.amount ??= dto.a;
    dto.currency ??= dto.c;
    dto.expiryDate ??= dto.d;

    dto.externalId ??= `${dto.message}/${dto.amount}${dto.currency ?? ''}`;

    const link = await this.paymentLinkService.createInvoice(dto);
    return this.lnurlForwardService.createPaymentLinkPayRequest(link.uniqueId);
  }

  @Post('payment')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiCreatedResponse({ type: PaymentLinkDto })
  @ApiQuery({ name: 'linkId', description: 'Link ID', required: false })
  @ApiQuery({ name: 'externalLinkId', description: 'External link ID', required: false })
  async createPayment(
    @GetJwt() jwt: JwtPayload,
    @Query('linkId') linkId: string,
    @Query('externalLinkId') externalLinkId: string,
    @Body() dto: CreatePaymentLinkPaymentDto,
  ): Promise<PaymentLinkDto> {
    await this.checkPaymentLinksAllowed(jwt.account);

    return this.paymentLinkService
      .createPayment(+jwt.user, dto, +linkId, externalLinkId)
      .then(PaymentLinkDtoMapper.toLinkDto);
  }

  @Get('payment/wait')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiOkResponse({ type: PaymentLinkDto })
  @ApiQuery({ name: 'linkId', description: 'Link ID', required: false })
  @ApiQuery({ name: 'externalLinkId', description: 'External link ID', required: false })
  @ApiQuery({ name: 'externalPaymentId', description: 'External payment ID', required: false })
  async waitForPayment(
    @GetJwt() jwt: JwtPayload,
    @Query('linkId') linkId: string,
    @Query('externalLinkId') externalLinkId: string,
    @Query('externalPaymentId') externalPaymentId: string,
  ): Promise<PaymentLinkDto> {
    await this.checkPaymentLinksAllowed(jwt.account);

    return this.paymentLinkService
      .waitForPayment(+jwt.user, +linkId, externalLinkId, externalPaymentId)
      .then(PaymentLinkDtoMapper.toLinkDto);
  }

  @Delete('payment')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiOkResponse({ type: PaymentLinkDto })
  @ApiQuery({ name: 'linkId', description: 'Link ID', required: false })
  @ApiQuery({ name: 'externalLinkId', description: 'External link ID', required: false })
  @ApiQuery({ name: 'externalPaymentId', description: 'External payment ID', required: false })
  async cancelPayment(
    @GetJwt() jwt: JwtPayload,
    @Query('linkId') linkId: string,
    @Query('externalLinkId') externalLinkId: string,
    @Query('externalPaymentId') externalPaymentId: string,
  ): Promise<PaymentLinkDto> {
    await this.checkPaymentLinksAllowed(jwt.account);

    return this.paymentLinkService
      .cancelPayment(+jwt.user, +linkId, externalLinkId, externalPaymentId)
      .then(PaymentLinkDtoMapper.toLinkDto);
  }

  private async checkPaymentLinksAllowed(userDataId: number): Promise<void> {
    const userData = await this.userDataService.getUserData(userDataId);
    if (!userData.paymentLinksAllowed) throw new ForbiddenException('permission denied');
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
