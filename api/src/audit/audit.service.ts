import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  userId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

/**
 * Journal d'audit — exigence §4 du cahier : toute action sensible (taux,
 * validation, plafond, blocage) est tracée avec auteur et horodatage.
 *
 * Une écriture d'audit ne doit JAMAIS faire échouer l'action métier qu'elle
 * accompagne : on journalise l'échec et on continue.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: entry.userId ?? null,
          action: entry.action,
          entity: entry.entity,
          entityId: entry.entityId ?? null,
          before: (entry.before ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          after: (entry.after ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          ip: entry.ip ?? null,
        },
      });
    } catch (error) {
      this.logger.error(
        `Audit non enregistré (${entry.action} sur ${entry.entity}) : ${String(error)}`,
      );
    }
  }
}
