import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { libraryVisibleTo } from '../library/visible-to';

@Injectable()
export class ExercisesService {
  constructor(private readonly prisma: PrismaService) {}

  /** The global library plus this athlete's own movements (DN-93). */
  findAll(userId: string) {
    return this.prisma.exercise.findMany({
      where: libraryVisibleTo(userId),
      include: { altExercise: true },
      orderBy: { name: 'asc' },
    });
  }
}
