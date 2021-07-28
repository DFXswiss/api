import { ApiProperty,  } from "@nestjs/swagger";
import {   IsInt, IsNumber, IsOptional,  IsString, Length, IsBoolean, IsNotEmpty } from "class-validator";
import { PaymentType } from "../payment.entity";

export class CreateBuyPaymentDto {

    @IsOptional()
    @IsInt()
    id: number;

    @ApiProperty()
    @IsNotEmpty()
    @IsInt()
    userId: number;

    @IsOptional()
    @IsString()
    type: PaymentType;

    @ApiProperty()
    @IsNotEmpty()
    @Length(34,34)
    @IsString()
    address: string;

    @ApiProperty()
    @IsNotEmpty()
    @IsString()
    iban: string;

    @ApiProperty()
    @IsNotEmpty()
    fiat: number;

    @ApiProperty()
    @IsNotEmpty()
    @IsNumber()
    fiatValue: number;

    @ApiProperty()
    @IsNotEmpty()
    asset: number;

    @ApiProperty()
    @IsNotEmpty()
    @IsString()
    bankUsage: string

}