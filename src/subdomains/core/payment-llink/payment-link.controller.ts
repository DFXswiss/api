import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeController, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { CreatePaymentLinkPaymentDto } from './dto/create-payment-link-payment.dto';
import { UpdatePaymentLinkDto } from './dto/update-payment-link.dto';
import { PaymentLinkPayment } from './entities/payment-link-payment.entity';
import { PaymentLink } from './entities/payment-link.entity';
import { PaymentLinkService } from './services/payment-link.services';

@ApiTags('PaymentLink')
@Controller('paymentLink')
@ApiExcludeController()
export class PaymentLinkController {
  constructor(private readonly paymentLinkService: PaymentLinkService) {}
  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiOkResponse({ type: PaymentLink, isArray: true })
  async getAllPaymentLinks(@GetJwt() jwt: JwtPayload): Promise<PaymentLink[]> {
    return this.paymentLinkService.getAll(+jwt.user);
  }

  @Get(':id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiOkResponse({ type: PaymentLink })
  async getSell(@GetJwt() jwt: JwtPayload, @Param('id') id: string): Promise<PaymentLink> {
    return this.paymentLinkService.get(+jwt.user, +id);
  }

  @Put(':id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiOkResponse({ type: PaymentLink })
  async updatePaymentLink(
    @GetJwt() jwt: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdatePaymentLinkDto,
  ): Promise<PaymentLink> {
    return this.paymentLinkService.updatePaymentLink(+jwt.user, +id, dto);
  }

  @Post(':id/payment')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiOkResponse({ type: PaymentLink })
  async createPayment(
    @GetJwt() jwt: JwtPayload,
    @Param('id') id: string,
    @Body() dto: CreatePaymentLinkPaymentDto,
  ): Promise<PaymentLinkPayment> {
    return this.paymentLinkService.createPayment(+jwt.user, +id, dto);
  }

  @Delete(':id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiOkResponse({ type: PaymentLink })
  async cancelPaymentLinkPayment(@GetJwt() jwt: JwtPayload, @Param('id') id: string): Promise<PaymentLink> {
    return this.paymentLinkService.cancelPaymentLinkPayment(+jwt.user, id);
  }
}
