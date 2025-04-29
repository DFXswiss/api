import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
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
import { CustodyAuthDto } from '../dto/output/custody-auth.dto';
import { CustodyBalanceDto } from '../dto/output/custody-balance.dto';
import { CustodyOrderDto } from '../dto/output/custody-order.dto';
import { CustodyOrderService } from '../services/custody-order.service';
import { CustodyService } from '../services/custody.service';

@ApiTags('Custody')
@Controller('custody')
export class CustodyController {
  constructor(private readonly service: CustodyService, private readonly custodyOrderService: CustodyOrderService) {}

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ACCOUNT), UserActiveGuard)
  async getUserCustodyBalance(@GetJwt() jwt: JwtPayload): Promise<CustodyBalanceDto> {
    return this.service.getUserCustodyBalance(jwt.account);
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ACCOUNT), UserActiveGuard)
  async createCustodyAccount(
    @GetJwt() jwt: JwtPayload,
    @Body() dto: CreateCustodyAccountDto,
    @RealIP() ip: string,
  ): Promise<CustodyAuthDto> {
    return this.service.createCustodyAccount(jwt.account, dto, ip);
  }

  @Post('order')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.CUSTODY), UserActiveGuard)
  async createOrder(@GetJwt() jwt: JwtPayload, @Body() dto: CreateCustodyOrderDto): Promise<CustodyOrderDto> {
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
