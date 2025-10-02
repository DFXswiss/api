import { Controller, Get, Param } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { PaymentStandardDto, PaymentStandardType } from '../dto/payment-standard.dto';
import { PaymentStandardService } from '../services/payment-standard.service';

@ApiTags('Payment Standards')
@Controller('paymentStandards')
export class PaymentStandardController {
  constructor(private readonly paymentStandardService: PaymentStandardService) {}

  @Get()
  @ApiOkResponse({ type: PaymentStandardDto, isArray: true })
  getAll(): PaymentStandardDto[] {
    return this.paymentStandardService.getAll();
  }

  @Get(':id')
  @ApiOkResponse({ type: PaymentStandardDto })
  getById(@Param('id') id: PaymentStandardType): PaymentStandardDto {
    return this.paymentStandardService.getById(id);
  }
}
