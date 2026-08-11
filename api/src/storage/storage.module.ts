import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';

/**
 * Global : le stockage sert au KYC, aux reçus de paiement et aux justificatifs
 * PDF. L'importer dans chaque module n'apporterait qu'du bruit.
 */
@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
