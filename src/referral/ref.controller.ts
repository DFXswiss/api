import {
    Body,
    Controller,
    Get,
    Param,
    Post,
    Query,
    UsePipes,
    ValidationPipe,
  } from '@nestjs/common';
  import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RealIP } from 'nestjs-real-ip';
import { CreateRefDto } from './dto/create-ref.dto';
import { RefService } from './ref.service';
  
  @ApiTags('ref')
  @Controller('ref')
  export class RefController {
    constructor(private readonly refService: RefService) {}
  
    @Get()
    @ApiExcludeEndpoint()
    @UsePipes(ValidationPipe)
    async getRef(@RealIP() ip: string): Promise<any> {
      return this.refService.getRef(ip);
    }
  
    @Post()
    @ApiExcludeEndpoint()
    @UsePipes(ValidationPipe)
    createRef(@Body() createRefDto: CreateRefDto, @RealIP() ip: string, @Query() query): Promise<any> {
        createRefDto.ip = ip;
        if(query.code) { 
          createRefDto.ref = query.code
          return this.refService.createRef(createRefDto);
        }
    }
  }