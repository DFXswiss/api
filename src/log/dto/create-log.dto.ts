import { ApiProperty,  } from "@nestjs/swagger";
import {   IsInt, IsNotEmpty, IsNumber, IsOptional,  IsString, Length,  } from "class-validator";

export class CreateLogDto {

    @IsOptional()
    @IsInt()
    id: number;

    @IsOptional()
    @IsString()
    orderId: string;

    @ApiProperty()
    @IsNotEmpty()
    @Length(34,34)
    @IsString()
    address: string;

    @ApiProperty()
    @IsNotEmpty()
    @IsString()
    type: string;

    @ApiProperty()
    @IsOptional()
    @IsString()
    status: string;

    @ApiProperty()
    @IsOptional()
    @IsInt()
    fiat: number;

    @ApiProperty()
    @IsOptional()
    @IsNumber()
    fiatValue: number;

    @ApiProperty()
    @IsOptional()
    @IsInt()
    krypto: number;

    @ApiProperty()
    @IsOptional()
    @IsNumber()
    kryptoValue: number;

    @ApiProperty()
    @IsOptional()
    //@IsIBAN()
    iban: string;

    @ApiProperty()
    @IsOptional()
    @IsString()
    direction: string;

    @ApiProperty()
    @IsOptional()
    @IsString()
    message: string;

}