import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Creates the rows a signed-in user needs before anything else can reference
 * them: their User row (which every per-user foreign key points at) plus a
 * ScheduleRule, the one per-user default the deploy seed used to create
 * globally.
 *
 * Deliberately **not** a SkillLevel per progression line (DN-86). Provisioning
 * a rung is the app forming an opinion about someone it has never seen train:
 * it used to start everyone at rung 0, so an athlete who can do ten pull-ups
 * was handed negative pull-ups and knee push-ups on day one. `applyCurrentRung`
 * passes a movement through unchanged when its line has no rung on record, so
 * creating nothing means the first workout is the library's own prescription —
 * and the app personalises only once the athlete has chosen something in the
 * swap panel.
 *
 * Clerk owns identity, so there is no sign-up hook here; a user simply exists
 * the first time they present a valid token.
 */
@Injectable()
export class UserProvisioningService {
  /**
   * Users provisioned during this process's lifetime. Purely to keep the
   * common case off the database — a cold cache costs one extra round trip,
   * never a wrong result.
   *
   * It is not what makes concurrent calls safe: on a user's very first load
   * the web app fires several requests at once, so the cache is cold for all
   * of them and they all reach the database together. That safety comes from
   * the writes below.
   */
  private readonly known = new Set<string>();

  constructor(private readonly prisma: PrismaService) {}

  async ensure(userId: string): Promise<void> {
    if (this.known.has(userId)) return;

    // `createMany({ skipDuplicates: true })` rather than `upsert`, which is
    // not safe against a concurrent insert of the same key: Postgres raises a
    // unique violation rather than quietly turning the losing insert into an
    // update, so parallel first requests used to 500 on `User_pkey`. This
    // compiles to INSERT ... ON CONFLICT DO NOTHING, where the loser is a
    // no-op instead of an error.
    //
    // It also says what is actually meant. Every `update: {}` here was a
    // no-op, so none of these writes was ever an update — they are all
    // "create if missing".
    //
    // Order matters inside the transaction: ScheduleRule carries a foreign
    // key to User, so the User row goes first.
    await this.prisma.$transaction([
      this.prisma.user.createMany({
        data: [{ id: userId }],
        skipDuplicates: true,
      }),
      this.prisma.scheduleRule.createMany({
        data: [{ userId }],
        skipDuplicates: true,
      }),
    ]);

    this.known.add(userId);
  }
}
