import { Body, Controller, Get, Param, Put, UseGuards, Post } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { BlockchainPaymentService } from './blockchain-payment.service';
import { CreateBlockchainPaymentDto } from './dto/create-blockchain-payment.dto';
import { UpdateBlockchainPaymentDto } from './dto/update-blockchain-payment.dto';

@ApiTags('blockchainPayment')
@Controller('blockchainPayment')
export class CountryController {
  constructor(private readonly blockchainPaymentService: BlockchainPaymentService) {}

  @Get(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getBlockchainPayment(@Param('id') id: string): Promise<any> {
    return this.blockchainPaymentService.getBlockchainPayment(+id);
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
  createBlockchainPayment(@Body() createBlockchainPaymentDto: CreateBlockchainPaymentDto): Promise<any> {
    return this.blockchainPaymentService.createBlockchainPayment(createBlockchainPaymentDto);
  }

  @Put()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async updateBlockchainPayment(@Body() blockchainPayment: UpdateBlockchainPaymentDto) {
    return this.blockchainPaymentService.updateBlockchainPayment(blockchainPayment);
  }
}
