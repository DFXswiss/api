import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { equals, IsBoolean, IsEmail, IsInt, IsNotEmpty, IsNumber, IsOptional, IsPhoneNumber, IsString, Length, IsIBAN } from "class-validator";

// TODO: Again: Custom decorators for address and signature,...
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