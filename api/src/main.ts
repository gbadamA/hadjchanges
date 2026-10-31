import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { loadEnv } from './config/env';

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  // ⚠️ `rawBody` : les webhooks de paiement se vérifient sur les OCTETS REÇUS.
  // Démontré dans `scripts-verif/wave-signature-check.ts` — le même JSON
  // re-sérialisé produit une signature différente, donc une vérification faite
  // sur le corps parsé rejetterait tous les événements authentiques.
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.use(helmet());
  app.use(cookieParser());
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: env.corsOrigins,
    credentials: true,
    // ⚠️ Sans cet `exposedHeaders`, le navigateur cache `content-disposition`
    // aux requêtes inter-origines : le dashboard enregistrait les exports sous
    // un nom générique au lieu du nom daté envoyé par le serveur.
    exposedHeaders: ['content-disposition'],
  });
  // Pas de `ValidationPipe` globale : la validation se fait en Zod, au plus
  // près du contrat (`@ZBody`). Deux piles de validation, c'est une de trop.

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('HadjChanges API')
      .setDescription('Bureau de change — taux, KYC, transactions, caisses.')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup('docs', app, document);

  await app.listen(env.PORT);
  new Logger('Bootstrap').log(
    `API sur http://localhost:${env.PORT}/api · documentation sur http://localhost:${env.PORT}/docs`,
  );
}

void bootstrap();
