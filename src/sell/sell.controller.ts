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
import { ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/guards/role.guard';
import { Sell } from './sell.entity';
import { SellService } from './sell.service';
import { CreateSellDto } from './dto/create-sell.dto';
import { UpdateSellDto } from './dto/update-sell.dto';
import { User, UserRole } from 'src/user/user.entity';
import { AuthGuard } from '@nestjs/passport';
import { GetUser } from 'src/auth/get-user.decorator';

@ApiTags('sell')
@Controller('sell')
export class SellController {
  constructor(private readonly sellService: SellService) {}

  @Get(':key')
  @UsePipes(ValidationPipe)
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getSellRoute(@GetUser() user: User,@Param() key: any): Promise<any> {
    return this.sellService.getSell(key, user.address);
  }

  @Get()
  @UsePipes(ValidationPipe)
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getAllSellRoute(@GetUser() user: User): Promise<any> {
    return this.sellService.getAllSell(user.address);
  }

  @Post()
  @UsePipes(ValidationPipe)
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  createSell(@GetUser() user: User, @Body() createSellDto: CreateSellDto): Promise<any> {
    createSellDto.address = user.address;
    return this.sellService.createSell(createSellDto);
  }

  @Put()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async updateSellRoute(@GetUser() user: User,@Body() updateSellDto: UpdateSellDto): Promise<any> {
    updateSellDto.address = user.address;
    return this.sellService.updateSell(updateSellDto);
  }
}
