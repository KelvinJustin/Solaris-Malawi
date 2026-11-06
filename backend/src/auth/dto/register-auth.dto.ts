import {
  IsString,
  IsEmail,
  IsPhoneNumber,
  MinLength,
  MaxLength,
} from 'class-validator';

export class RegisterAuthDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(100)
  password!: string;

  @IsEmail()
  email!: string;

  @IsPhoneNumber('MW')
  phone!: string;
}