import { Controller, Get, Param } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { SubstitutionsService } from './substitutions.service';

/**
 * A movement's alternatives away from any day (DN-185), for the program
 * editor's swap control. Here rather than beside the exercise routes because
 * the computation is the swap panel's, and one service owning it is what keeps
 * the editor and Today agreeing.
 */
@Controller('exercises/:exerciseId/alternatives')
export class ExerciseAlternativesController {
  constructor(private readonly substitutionsService: SubstitutionsService) {}

  @Get()
  alternatives(
    @CurrentUser() userId: string,
    @Param('exerciseId') exerciseId: string,
  ) {
    return this.substitutionsService.alternatives(userId, exerciseId);
  }
}
