import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  UseGuards,
  Param
} from '@nestjs/common';

import { TransactionsService } from './transactions.service.js';
import { CreateTransactionDto } from './dto/create-transaction.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';

@UseGuards(JwtAuthGuard)
@Controller('transactions')
export class TransactionsController {
  constructor(
    private readonly transactionsService: TransactionsService,
  ) { }

  /**
   * Create a payment transaction for the authenticated merchant.
   *
   * The merchant's identity comes from the authenticated session,
   * never from the request body.
   *
   * Idempotency-Key prevents accidental duplicate transactions
   * when a client retries the same request.
   */
  @Post()
  create(
    @CurrentUser('userId') merchantId: string,
    @Headers('idempotency-key') idempotencyKey: string,
    @Body() createTransactionDto: CreateTransactionDto,
  ) {
    return this.transactionsService.create(
      merchantId,
      idempotencyKey,
      createTransactionDto,
    );
  }

  /**
 * Retrieve a transaction using its public reference.
 */
  @Get(':reference')
  findOne(
    @CurrentUser('userId') merchantId: string,
    @Param('reference') reference: string,
  ) {
    return this.transactionsService.findOne(merchantId, reference);
  }
}