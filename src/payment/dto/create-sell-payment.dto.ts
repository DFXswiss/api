import { ApiProperty,  } from "@nestjs/swagger";
import {   IsInt, IsNumber, IsOptional,  IsString, Length, IsBoolean, IsNotEmpty } from "class-validator";
import { PaymentStatus, PaymentType } from "../payment.entity";

export class CreateSellPaymentDto {

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

    @IsString()
    @IsOptional()
    created: Date;

    @ApiProperty()
    @IsOptional()
    status: PaymentStatus

}