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
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { UserRole } from 'src/user/user.entity';
import { AuthGuard } from '@nestjs/passport';
import { CreateBuyPaymentDto } from './dto/create-buy-payment.dto';
import { CreateSellPaymentDto } from './dto/create-sell-payment.dto';

@ApiTags('payment')
@Controller('payment')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Get('buy/unprocessed')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UsePipes(ValidationPipe)
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getUnprocessedBuyPayment(): Promise<any> {
    return this.paymentService.getUnprocessedBuyPayment();
  }

  @Get('buy/unprocessed/accepted')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UsePipes(ValidationPipe)
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getUnprocessedAcceptedBuyPayment(): Promise<any> {
    return this.paymentService.getUnprocessedAcceptedBuyPayment();
  }

  @Get('sell/unprocessed')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UsePipes(ValidationPipe)
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getUnprocessedSellPayment(): Promise<any> {
    return this.paymentService.getUnprocessedSellPayment();
  }

  @Get('buy')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UsePipes(ValidationPipe)
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getAllBuyPayment(): Promise<any> {
    return this.paymentService.getAllBuyPayment();
  }

  @Get('sell')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UsePipes(ValidationPipe)
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getAllSellPayment(): Promise<any> {
    return this.paymentService.getAllSellPayment();
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

  @Put('buy')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async updateBuyPayment(
    @Body() updateSellDto: UpdatePaymentDto,
  ): Promise<any> {
    return this.paymentService.updateBuyPayment(updateSellDto);
  }

  @Put('sell')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async updateSellPayment(
    @Body() updateSellDto: UpdatePaymentDto,
  ): Promise<any> {
    return this.paymentService.updateSellPayment(updateSellDto);
  }

  @Get('buy/:key')
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
  async getBuyPayment(@Param() id: any): Promise<any> {
    return this.paymentService.getBuyPayment(id);
  }

  @Get('sell/:key')
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
  async getSellPayment(@Param() id: any): Promise<any> {
    return this.paymentService.getSellPayment(id);
  }
}
