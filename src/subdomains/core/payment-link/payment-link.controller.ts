import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { CreatePaymentLinkPaymentDto } from './dto/create-payment-link-payment.dto';
import { CreatePaymentLinkDto } from './dto/create-payment-link.dto';
import { PaymentLinkDtoMapper } from './dto/payment-link-dto.mapper';
import { PaymentLinkDto } from './dto/payment-link.dto';
import { UpdatePaymentLinkDto } from './dto/update-payment-link.dto';
import { PaymentLinkService } from './services/payment-link.services';

@ApiTags('Payment Link')
@Controller('paymentLink')
export class PaymentLinkController {
  constructor(private readonly paymentLinkService: PaymentLinkService) {}

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiOkResponse({ type: PaymentLinkDto, isArray: true })
  async getAllPaymentLinks(@GetJwt() jwt: JwtPayload): Promise<PaymentLinkDto[]> {
    return this.paymentLinkService.getAll(+jwt.user).then(PaymentLinkDtoMapper.entitiesToDto);
  }

  @Get(':id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiOkResponse({ type: PaymentLinkDto })
  async getPaymentLink(@GetJwt() jwt: JwtPayload, @Param('id') id: string): Promise<PaymentLinkDto> {
    return this.paymentLinkService.get(+jwt.user, +id).then(PaymentLinkDtoMapper.entityToDto);
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiCreatedResponse({ type: PaymentLinkDto })
  async createPaymentLink(@GetJwt() jwt: JwtPayload, @Body() dto: CreatePaymentLinkDto): Promise<PaymentLinkDto> {
    return this.paymentLinkService.create(+jwt.user, dto).then(PaymentLinkDtoMapper.entityToDto);
  }

  @Put(':id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiOkResponse({ type: PaymentLinkDto })
  async updatePaymentLink(
    @GetJwt() jwt: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdatePaymentLinkDto,
  ): Promise<PaymentLinkDto> {
    return this.paymentLinkService.update(+jwt.user, +id, dto).then(PaymentLinkDtoMapper.entityToDto);
  }

  @Post(':id/payment')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiOkResponse({ type: PaymentLinkDto })
  async createPayment(
    @GetJwt() jwt: JwtPayload,
    @Param('id') id: string,
    @Body() dto: CreatePaymentLinkPaymentDto,
  ): Promise<PaymentLinkDto> {
    return this.paymentLinkService.createPayment(+jwt.user, +id, dto).then(PaymentLinkDtoMapper.entityToDto);
  }

  @Delete(':id/payment')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async cancelPayment(@GetJwt() jwt: JwtPayload, @Param('id') id: string): Promise<void> {
    return this.paymentLinkService.cancelPayment(+jwt.user, +id);
  }
}
