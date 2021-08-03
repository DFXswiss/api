import { ApiProperty,  } from "@nestjs/swagger";
import {   IsInt, IsNumber, IsOptional,  IsString, Length, IsBoolean, IsNotEmpty } from "class-validator";
import { PaymentError, PaymentStatus } from "../payment.entity";

export class CreateSellPaymentDto {

    @IsOptional()
    @IsInt()
    id: number;

    @IsOptional()
    @IsInt()
    userId: number;

    @ApiProperty()
    @IsOptional()
    @Length(34,34)
    @IsString()
    address: string;

    @ApiProperty()
    @IsOptional()
    @IsString()
    iban: string;

    @ApiProperty()
    @IsOptional()
    @IsString()
    @Length(34,34)
    depositAddress: string;

    @ApiProperty()
    @IsNotEmpty()
    fiat: number;

    @ApiProperty()
    @IsNotEmpty()
    asset: number;

    @ApiProperty()
    @IsOptional()
    @IsNumber()
    assetValue: number;

    @IsOptional()
    @IsString()
    info: string

    @IsString()
    @IsOptional()
    created: Date;

    @IsOptional()
    errorCode: PaymentError;

    @IsOptional()
    status: PaymentStatus

}