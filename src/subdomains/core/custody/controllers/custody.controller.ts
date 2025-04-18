import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeController, ApiTags } from '@nestjs/swagger';
import { RealIP } from 'nestjs-real-ip';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { CreateCustodyAccountDto } from '../dto/input/create-custody-account.dto';
import { CreateCustodyOrderDto } from '../dto/input/create-custody-order.dto';
import { CustodyAuthResponseDto } from '../dto/output/create-custody-account-output.dto';
import { CustodyOrderResponseDto } from '../dto/output/create-custody-order-output.dto';
import { CustodyOrderService } from '../services/custody-order.service';
import { CustodyService } from '../services/custody.service';

@ApiTags('Custody')
@Controller('custody')
export class CustodyController {
  constructor(private readonly service: CustodyService, private readonly custodyOrderService: CustodyOrderService) {}

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ACCOUNT), UserActiveGuard)
  async createCustodyAccount(
    @GetJwt() jwt: JwtPayload,
    @Body() dto: CreateCustodyAccountDto,
    @RealIP() ip: string,
  ): Promise<CustodyAuthResponseDto> {
    return this.service.createCustodyAccount(jwt.account, dto, ip);
  }

  @Post('order')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.CUSTODY), UserActiveGuard)
  async createOrder(@GetJwt() jwt: JwtPayload, @Body() dto: CreateCustodyOrderDto): Promise<CustodyOrderResponseDto> {
    return this.custodyOrderService.createOrder(jwt, dto);
  }

  @Post('order/:id/confirm')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.CUSTODY), UserActiveGuard)
  async confirmOrder(@GetJwt() jwt: JwtPayload, @Param('id') id: string): Promise<void> {
    await this.custodyOrderService.confirmOrder(jwt.user, +id);
  }
}

@ApiExcludeController()
@Controller('custody/admin')
export class CustodyAdminController {
  constructor(private readonly custodyOrderService: CustodyOrderService) {}

  @Post('order/:id/approve')
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN), UserActiveGuard)
  async approveOrder(@Param() id: string): Promise<void> {
    return this.custodyOrderService.approveOrder(+id);
  }
}
