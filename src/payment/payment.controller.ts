import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  UseGuards,
  Post,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExcludeEndpoint,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { RoleGuard } from 'src/guards/role.guard';
import { PaymentService } from './payment.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { UserRole } from 'src/user/user.entity';
import { AuthGuard } from '@nestjs/passport';
import { CreateBuyPaymentDto } from './dto/create-buy-payment.dto';
import { CreateSellPaymentDto } from './dto/create-sell-payment.dto';

@ApiTags('payment')
@Controller('payment')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Get('unprocessed')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UsePipes(ValidationPipe)
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getUnprocessedPayment(): Promise<any> {
    return this.paymentService.getUnprocessedPayment();
  }

  @Get()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UsePipes(ValidationPipe)
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getAllPayment(): Promise<any> {
    return this.paymentService.getAllPayment();
  }

  @Get(':key')
  @ApiBearerAuth()
  @ApiParam({
    name: 'id',
    required: true,
    description: 'integer for the sell id',
    schema: { type: 'integer' },
  })
  @ApiExcludeEndpoint()
  @UsePipes(ValidationPipe)
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getPayment(@Param() id: any): Promise<any> {
    return this.paymentService.getPayment(id);
  }

  @Post()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UsePipes(ValidationPipe)
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  createPayment(@Body() createSellDto: CreatePaymentDto): Promise<any> {
    return this.paymentService.createPayment(createSellDto);
  }

  @Post('buy')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UsePipes(ValidationPipe)
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  createBuyPayment(@Body() createSellDto: CreateBuyPaymentDto): Promise<any> {
    return this.paymentService.createBuyPayment(createSellDto);
  }

  @Post('sell')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UsePipes(ValidationPipe)
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  createSellPayment(@Body() createSellDto: CreateSellPaymentDto): Promise<any> {
    return this.paymentService.createSellPayment(createSellDto);
  }

  @Put()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async updateSellRoute(@Body() updateSellDto: UpdatePaymentDto): Promise<any> {
    return this.paymentService.updatePayment(updateSellDto);
  }
}
