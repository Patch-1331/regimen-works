import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { setSkillLevelRequestSchema } from '@regimen-works/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { validateBody } from '../common/validate';
import { SkillLevelsService } from './skill-levels.service';

@Controller('skill-levels')
export class SkillLevelsController {
  constructor(private readonly skillLevelsService: SkillLevelsService) {}

  @Get()
  findAll(@CurrentUser() userId: string) {
    return this.skillLevelsService.findAll(userId);
  }

  @Patch(':movementGroup')
  setRung(
    @CurrentUser() userId: string,
    @Param('movementGroup') movementGroup: string,
    @Body() body: unknown,
  ) {
    const { rung } = validateBody(setSkillLevelRequestSchema, body);
    return this.skillLevelsService.setRung(userId, movementGroup, rung);
  }
}
