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
import { FiatService } from './fiat.service';
import { CreateFiatDto } from './dto/create-fiat.dto';
import { UpdateFiatDto } from './dto/update-fiat.dto';
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from 'src/user/user.entity';

@ApiTags('fiat')
@Controller('fiat')
export class FiatController {
  constructor(private readonly fiatService: FiatService) {}

  @Get(':key')
  @ApiBearerAuth()
  @ApiParam({
    name: 'key',
    required: true,
    description:
      'either an integer for the fiat id or a string for the fiat name',
    schema: { oneOf: [{ type: 'string' }, { type: 'integer' }] },
  })
  @UsePipes(ValidationPipe)
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getFiat(@Param() fiat: any): Promise<any> {
    return this.fiatService.getFiat(fiat);
  }

  @Get()
  @ApiBearerAuth()
  @UsePipes(ValidationPipe)
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getAllFiat(): Promise<any> {
    return this.fiatService.getAllFiat();
  }

  @Post()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UsePipes(ValidationPipe)
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  createFiat(@Body() createFiatDto: CreateFiatDto): Promise<any> {
    return this.fiatService.createFiat(createFiatDto);
  }

  @Put()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  @UsePipes(ValidationPipe)
  async updateFiat(@Body() fiat: UpdateFiatDto) {
    return this.fiatService.updateFiat(fiat);
  }
}
