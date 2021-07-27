import {
    Body,
    Controller,
    Get,
    Param,
    Put,
    UseGuards,
    Request,
    ForbiddenException,
    Post,
    UsePipes,
    ValidationPipe,
  } from '@nestjs/common';
  import { ApiBearerAuth, ApiParam, ApiTags } from '@nestjs/swagger';
  import { RoleGuard } from 'src/guards/role.guard';
  import { Payment } from './payment.entity';
  import { PaymentService } from './payment.service';
  import { CreatePaymentDto } from './dto/create-payment.dto';
  import { UpdatePaymentDto } from './dto/update-payment.dto';
  import { User, UserRole } from 'src/user/user.entity';
  import { AuthGuard } from '@nestjs/passport';
  import { GetUser } from 'src/auth/get-user.decorator';
  import { CreateBuyPaymentDto } from './dto/create-buy-payment.dto';
  import { CreateSellPaymentDto } from './dto/create-sell-payment.dto';
  
  @ApiTags('payment')
  @Controller('payment')
  export class PaymentController {
    constructor(private readonly paymentService: PaymentService) {}
  
    @Get('unprocessed')
    @ApiBearerAuth()
    @UsePipes(ValidationPipe)
    @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
    async getUnprocessedPayment(): Promise<any> {
      return this.paymentService.getUnprocessedPayment();
    }

    @Get()
    @ApiBearerAuth()
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
    @UsePipes(ValidationPipe)
    @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
    async getPayment(@Param() id: any): Promise<any> {
      return this.paymentService.getPayment(id);
    }
    
    @Post()
    @ApiBearerAuth()
    @UsePipes(ValidationPipe)
    @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
    createPayment(
      @Body() createSellDto: CreatePaymentDto,
    ): Promise<any> {
      return this.paymentService.createPayment(createSellDto);
    }

    @Post('buy')
    @ApiBearerAuth()
    @UsePipes(ValidationPipe)
    @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
    createBuyPayment(
      @Body() createSellDto: CreateBuyPaymentDto,
    ): Promise<any> {
      return this.paymentService.createBuyPayment(createSellDto);
    }

    @Post('sell')
    @ApiBearerAuth()
    @UsePipes(ValidationPipe)
    @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
    createSellPayment(
      @Body() createSellDto: CreateSellPaymentDto,
    ): Promise<any> {
      return this.paymentService.createSellPayment(createSellDto);
    }
  
    @Put()
    @ApiBearerAuth()
    @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
    async updateSellRoute(
      @Body() updateSellDto: UpdatePaymentDto,
    ): Promise<any> {
      return this.paymentService.updatePayment(updateSellDto);
    }
  }
  