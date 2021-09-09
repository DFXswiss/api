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
  import { AuthGuard } from '@nestjs/passport';
  import { ApiBearerAuth, ApiExcludeEndpoint, ApiParam, ApiTags } from '@nestjs/swagger';
  import { RoleGuard } from 'src/guards/role.guard';
  import { UserRole } from 'src/user/user.entity';
  import { BlockchainPaymentService } from './blockchainPayment.service';
  import { CreateBlockchainPaymentDto } from './dto/create-blockchainPayment.dto';
  import { UpdateBlockchainPaymentDto } from './dto/update-blockchainPayment.dto';
  
  @ApiTags('blockchainPayment')
  @Controller('blockchainPayment')
  export class CountryController {
    constructor(private readonly blockchainPaymentService: BlockchainPaymentService) {}
  
    @Get(':key')
    @ApiParam({
      name: 'key',
      required: true,
      description:
        'either an integer for the country id or a string for the country symbol',
      schema: { oneOf: [{ type: 'string' }, { type: 'integer' }] },
    })
    @ApiBearerAuth()
    @ApiExcludeEndpoint()
    @UsePipes(ValidationPipe)
    @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
    async getBlockchainPayment(@Param() blockchainPayment: any): Promise<any> {
      return this.blockchainPaymentService.getBlockchainPayment(blockchainPayment);
    }
  
    @Get()
    @ApiBearerAuth()
    @ApiExcludeEndpoint()
    @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
    async getAllBlockchainPayment(): Promise<any> {
      return this.blockchainPaymentService.getAllBlockchainPayment();
    }
  
    @Post()
    @ApiBearerAuth()
    @ApiExcludeEndpoint()
    @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
    @UsePipes(ValidationPipe)
    createBlockchainPayment(@Body() createBlockchainPaymentDto: CreateBlockchainPaymentDto): Promise<any> {
      return this.blockchainPaymentService.createBlockchainPayment(createBlockchainPaymentDto);
    }
  
    @Put()
    @ApiBearerAuth()
    @ApiExcludeEndpoint()
    @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
    @UsePipes(ValidationPipe)
    async updateBlockchainPayment(@Body() blockchainPayment: UpdateBlockchainPaymentDto) {
      return this.blockchainPaymentService.updateBlockchainPayment(blockchainPayment);
    }
  }