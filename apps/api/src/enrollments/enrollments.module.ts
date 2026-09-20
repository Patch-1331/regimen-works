import { Module } from '@nestjs/common';
import { EnrollmentsController } from './enrollments.controller';
import { EnrollmentsService } from './enrollments.service';

@Module({
  controllers: [EnrollmentsController],
  providers: [EnrollmentsService],
  // The scheduler completes a run as it reads past its last day, so it needs
  // the service that knows how to compute the figures.
  exports: [EnrollmentsService],
})
export class EnrollmentsModule {}
