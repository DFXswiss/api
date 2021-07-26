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
  
  @ApiTags('payment')
  @Controller('payment')
  export class PaymentController {
    constructor(private readonly paymentService: PaymentService) {}
  
    @Get('id/:key')
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
  
    @Get()
    @ApiBearerAuth()
    @UsePipes(ValidationPipe)
    @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
    async getAllPayment(): Promise<any> {
      return this.paymentService.getAllPayment();
    }

    @Get('unprocessed')
    @ApiBearerAuth()
    @UsePipes(ValidationPipe)
    @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
    async getUnprocessedPayment(): Promise<any> {
      return this.paymentService.getUnprocessedPayment();
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
  
    @Put()
    @ApiBearerAuth()
    @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
    async updateSellRoute(
      @Body() updateSellDto: UpdatePaymentDto,
    ): Promise<any> {
      return this.paymentService.updatePayment(updateSellDto);
    }
  }
  