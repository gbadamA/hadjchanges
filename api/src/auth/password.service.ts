import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';

/**
 * Hachage des mots de passe. `bcryptjs` (pur JS) et non `bcrypt` : aucune
 * compilation native à faire sous Windows.
 */
@Injectable()
export class PasswordService {
  private readonly rounds = 12;

  hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, this.rounds);
  }

  compare(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }
}
