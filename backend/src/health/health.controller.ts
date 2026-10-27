import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  async check() {
    const checks = await this.healthService.check();
    const allUp = checks.database === 'up' && checks.redis === 'up';
    if (!allUp) {
      // Passing an object (not a string) to ServiceUnavailableException
      // makes it the entire response body, verbatim — no statusCode/message
      // wrapper is added on top of it.
      throw new ServiceUnavailableException({ status: 'error', checks });
    }
    return { status: 'ok', checks };
  }
}
