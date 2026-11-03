import { BadRequestException, Body, Catch } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter, PipeTransform } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBody } from '@nestjs/swagger';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * Pont Zod → NestJS. Un schéma de validation s'écrit UNE fois et sert à la
 * fois de garde d'entrée et de documentation Swagger.
 * (Pont maison plutôt que `nestjs-zod` : une dépendance de moins pour vingt
 * lignes — même choix que sur FI-HADJ.)
 */
/** Même forme de 400 partout, corps comme paramètres de requête. */
const badRequestOf = (error: ZodError): BadRequestException =>
  new BadRequestException({
    message: 'Requête invalide.',
    errors: error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    })),
  });

class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodTypeAny) {}

  transform(value: unknown): unknown {
    try {
      return this.schema.parse(value);
    } catch (error) {
      if (error instanceof ZodError) throw badRequestOf(error);
      throw error;
    }
  }
}

/**
 * Filtre global : les paramètres de requête sont validés par
 * `schema.parse(query)` DANS les contrôleurs, hors de la pipe. Sans ce filtre,
 * un filtre mal formé (`?status=FOO`) répondait 500 — une erreur serveur pour
 * une faute du client, qui déclenche des alertes et masque les vraies pannes.
 */
@Catch(ZodError)
export class ZodErrorFilter implements ExceptionFilter {
  catch(error: ZodError, host: ArgumentsHost): void {
    const exception = badRequestOf(error);
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(exception.getStatus())
      .json(exception.getResponse());
  }
}

/** `@ZBody(schema) body: z.infer<typeof schema>` — valide et type le corps. */
export const ZBody = (schema: ZodTypeAny): ParameterDecorator =>
  Body(new ZodValidationPipe(schema));

/**
 * Conversion Zod → JSON Schema, dé-générifiée volontairement : l'inférence de
 * `zodToJsonSchema` sur un schéma un peu profond fait exploser le compilateur
 * (TS2589). Le résultat est de toute façon consommé comme un objet libre par
 * Swagger, la précision de type n'apporte rien ici.
 */
const toJsonSchema = zodToJsonSchema as (schema: unknown, name: string) => Record<string, unknown>;

/** Documente le corps attendu dans Swagger à partir du MÊME schéma Zod. */
export const ApiZodBody = (name: string, schema: ZodTypeAny): MethodDecorator =>
  ApiBody({ schema: toJsonSchema(schema, name) });

export type Infer<T extends ZodTypeAny> = z.infer<T>;
