import { Body, Controller, Get, NotFoundException, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeController, ApiTags } from '@nestjs/swagger';
import { RealIP } from 'nestjs-real-ip';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { CreateCustodyAccountDto } from '../dto/input/create-custody-account.dto';
import { CreateCustodyOrderDto } from '../dto/input/create-custody-order.dto';
import { CustodyAuthDto } from '../dto/output/custody-auth.dto';
import { CustodyBalanceDto, CustodyHistoryDto } from '../dto/output/custody-balance.dto';
import { CustodyOrderDto } from '../dto/output/custody-order.dto';
import { CustodyOrderService } from '../services/custody-order.service';
import { CustodyService } from '../services/custody.service';

@ApiTags('Custody')
@Controller('custody')
export class CustodyController {
  constructor(private readonly service: CustodyService, private readonly custodyOrderService: CustodyOrderService) {}

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT), UserActiveGuard())
  async getUserCustodyBalance(@GetJwt() jwt: JwtPayload): Promise<CustodyBalanceDto> {
    return this.service.getUserCustodyBalance(jwt.account);
  }

  @Get('history')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT), UserActiveGuard())
  async getUserCustodyHistory(@GetJwt() jwt: JwtPayload): Promise<CustodyHistoryDto> {
    return this.service.getUserCustodyHistory(jwt.account);
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT), UserActiveGuard())
  async createCustodyAccount(
    @GetJwt() jwt: JwtPayload,
    @Body() dto: CreateCustodyAccountDto,
    @RealIP() ip: string,
  ): Promise<CustodyAuthDto> {
    return this.service.createCustodyAccount(jwt.account, dto, ip);
  }

  @Post('order')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.CUSTODY), UserActiveGuard())
  async createOrder(@GetJwt() jwt: JwtPayload, @Body() dto: CreateCustodyOrderDto): Promise<CustodyOrderDto> {
    return this.custodyOrderService.createOrder(jwt, dto);
  }

  @Post('order/:id/confirm')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.CUSTODY), UserActiveGuard())
  async confirmOrder(@GetJwt() jwt: JwtPayload, @Param('id') id: string): Promise<void> {
    await this.custodyOrderService.confirmOrder(jwt.user, +id);
  }
}

@ApiExcludeController()
@Controller('custody/admin')
export class CustodyAdminController {
  constructor(
    private readonly service: CustodyService,
    private readonly custodyOrderService: CustodyOrderService,
    private readonly userService: UserService,
    private readonly assetService: AssetService,
  ) {}

  @Put('user/:id/balance')
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async updateUserBalance(@Param('id') id: string, @Query('assetId') assetId: string): Promise<void> {
    const user = await this.userService.getUser(+id);
    if (!user) throw new NotFoundException('User not found');

    const asset = await this.assetService.getAssetById(+assetId);
    if (!asset) throw new NotFoundException('Asset not found');

    return this.service.updateCustodyBalance(asset, user);
  }

  @Post('order/:id/approve')
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async approveOrder(@Param('id') id: string): Promise<void> {
    return this.custodyOrderService.approveOrder(+id);
  }
}
