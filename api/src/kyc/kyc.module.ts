import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { KycController } from './kyc.controller';
import { KycService } from './kyc.service';

@Module({
  imports: [
    // Mémoire, pas disque : le fichier ne touche le stockage qu'après contrôle
    // du format et des droits — un refus ne doit rien laisser traîner.
    MulterModule.register({ storage: memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } }),
  ],
  controllers: [KycController],
  providers: [KycService],
  exports: [KycService],
})
export class KycModule {}
