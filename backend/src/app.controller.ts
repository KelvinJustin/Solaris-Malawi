import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get("test")
  getTest(): string {
    return "message: solaris API is working";
  }
}
