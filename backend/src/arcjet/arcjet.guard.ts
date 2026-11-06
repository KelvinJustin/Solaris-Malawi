import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { getRawArcjetClient } from './arcjet.module.js';

@Injectable()
export class ArcjetGuard implements CanActivate {
  private readonly logger = new Logger(ArcjetGuard.name);

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Extract the HTTP request object from the NestJS execution context
    const request = context.switchToHttp().getRequest();

    // Log the incoming request details before running protection rules
    this.logger.debug(
      `Arcjet checking: ${request.method} ${request.url} from ${request.ip}`,
    );

    // Evaluate the request using the raw Arcjet client
    const decision = await getRawArcjetClient().protect(request);

    // Log the high-level conclusion returned by Arcjet
    this.logger.debug(`Arcjet decision: ${decision.conclusion}`);

    // Handle any operational or internal errors within Arcjet
    if (decision.isErrored()) {
      this.logger.error(
        `Arcjet error details: ${JSON.stringify(decision.reason, null, 2)}`,
      );
    }

    // Handle requests that have been explicitly denied
    if (decision.isDenied()) {
      // Check if the denial was caused by hitting a rate limit
      if (decision.reason.isRateLimit()) {
        this.logger.warn(
          `Rate limit hit: ${request.method} ${request.url} from ${request.ip}`,
        );
        throw new HttpException(
          'Too many requests, please try again later.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      // Check if the denial was triggered by a detected bot
      if (decision.reason.isBot()) {
        this.logger.warn(
          `Bot detected: ${request.method} ${request.url} from ${request.ip}`,
        );
        throw new HttpException('Bot detected.', HttpStatus.FORBIDDEN);
      }

      // Handle any other block reasons
      this.logger.warn(
        `Request blocked: ${request.method} ${request.url} from ${request.ip} — reason: ${decision.reason}`,
      );
      throw new HttpException('Request blocked.', HttpStatus.FORBIDDEN);
    }

    // Log successful requests that passed all checks
    this.logger.log(
      `Arcjet allowed: ${request.method} ${request.url} from ${request.ip}`,
    );

    // Allow the request to proceed to the route handler
    return true;
  }
}