import { ApiProperty,  } from "@nestjs/swagger";
import {   IsInt, IsNumber, IsOptional,  IsString, Length, IsBoolean, IsNotEmpty } from "class-validator";
import { PaymentError, PaymentStatus, PaymentType } from "../payment.entity";

export class CreateBuyPaymentDto {

    @IsOptional()
    @IsInt()
    id: number;

    @IsOptional()
    @IsInt()
    userId: number;

    @IsOptional()
    @IsString()
    type: PaymentType;

    @IsOptional()
    @Length(34,34)
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

    @IsOptional()
    asset: number;

    @ApiProperty()
    @IsOptional()
    bankUsage: string

    @IsOptional()
    @IsString()
    info: string

    @IsOptional()
    errorCode: PaymentError;

    @IsString()
    @IsOptional()
    created: Date;

    @IsOptional()
    status: PaymentStatus;

}