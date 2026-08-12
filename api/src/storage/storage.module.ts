import { Global, Logger, Module } from '@nestjs/common';
import { loadEnv } from '../config/env';
import { LocalStorageAdapter } from './storage.local';
import { S3StorageAdapter } from './storage.s3';
import { StorageService } from './storage.service';

/**
 * Global : le stockage sert au KYC, aux reçus de paiement et aux justificatifs
 * PDF. L'importer dans chaque module n'apporterait que du bruit.
 *
 * L'adaptateur est choisi **au démarrage** par `STORAGE_DRIVER`. Les
 * consommateurs injectent `StorageService` et ignorent lequel tourne : passer
 * du disque à S3 ne touche pas une ligne de métier.
 *
 * ⚠️ Un `STORAGE_DRIVER=s3` sans compartiment renseigné **arrête le démarrage**
 * plutôt que de retomber discrètement sur le disque : une pièce d'identité
 * écrite sur le disque d'un conteneur éphémère est perdue au premier
 * redéploiement, et personne ne s'en apercevrait avant un contrôle.
 */
@Global()
@Module({
  providers: [
    {
      provide: StorageService,
      useFactory: (): StorageService => {
        const env = loadEnv();
        if (env.STORAGE_DRIVER !== 's3') return new LocalStorageAdapter();

        const missing = (['S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY'] as const).filter(
          (key) => !env[key],
        );
        if (missing.length > 0) {
          throw new Error(
            `STORAGE_DRIVER=s3 mais ${missing.join(', ')} manque(nt). ` +
              'Renseignez ces variables ou repassez STORAGE_DRIVER=local.',
          );
        }
        new Logger('StorageModule').log('Adaptateur de stockage : S3.');
        return new S3StorageAdapter();
      },
    },
  ],
  exports: [StorageService],
})
export class StorageModule {}
