import { Controller, Get, Param } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { PaymentStandardDto } from '../dto/payment-standard.dto';
import { PaymentStandard } from '../enums';
import { PaymentStandardService } from '../services/payment-standard.service';

@ApiTags('Payment Link')
@Controller('paymentLink/standard')
export class PaymentStandardController {
  constructor(private readonly paymentStandardService: PaymentStandardService) {}

  @Get()
  @ApiOkResponse({ type: PaymentStandardDto, isArray: true })
  getAll(): PaymentStandardDto[] {
    return this.paymentStandardService.getAll();
  }

  @Get(':id')
  @ApiOkResponse({ type: PaymentStandardDto })
  getById(@Param('id') id: PaymentStandard): PaymentStandardDto {
    return this.paymentStandardService.getById(id);
  }
}
