import { PartialType } from '@nestjs/mapped-types';
import { CreateProfileDto } from './create-profile.dto.js';

// Every field from CreateProfileDto becomes optional automatically.
export class UpdateProfileDto extends PartialType(CreateProfileDto) {}