import { Module } from '@nestjs/common';
import { PasswordService } from './password.service';

/**
 * Le hachage des mots de passe est isolé dans son propre module parce que
 * DEUX modules en ont besoin : l'authentification, et la gestion d'équipe qui
 * crée des comptes internes.
 *
 * ⚠️ Sans cette séparation, `UsersModule` devrait importer `AuthModule`, qui
 * importe déjà `UsersModule` — un cycle que Nest refuse de résoudre sans
 * `forwardRef`, c'est-à-dire un pansement sur une dépendance mal placée.
 */
@Module({
  providers: [PasswordService],
  exports: [PasswordService],
})
export class PasswordModule {}
