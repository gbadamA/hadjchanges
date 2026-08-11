import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { loadEnv } from '../config/env';

export interface StoredFile {
  /** Clé opaque conservée en base. Jamais une URL, jamais un nom d'origine. */
  key: string;
  mimeType: string;
  size: number;
  /** Empreinte du contenu : deux dépôts identiques se repèrent sans comparer les octets. */
  sha256: string;
}

/**
 * Port de stockage des fichiers déposés (pièces d'identité, reçus de paiement).
 *
 * ⚠️ **Rien de tout ceci n'est servi en statique.** Une photo de CNI derrière
 * une URL devinable est une fuite de données, même avec un nom aléatoire : les
 * URL fuient par les journaux, l'historique, le presse-papier. Toute lecture
 * passe par un contrôleur qui vérifie les droits, puis par `read()`.
 *
 * L'implémentation locale suffit en développement ; le passage à S3 se fait en
 * remplaçant ce fournisseur, sans toucher au métier (DIP).
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly root: string;

  constructor() {
    const env = loadEnv();
    this.root = resolve(env.STORAGE_LOCAL_DIR);
  }

  async save(file: { buffer: Buffer; mimetype: string; originalname: string }, folder: string): Promise<StoredFile> {
    // Nom aléatoire : le nom d'origine peut porter le nom du client, sa date de
    // naissance, ou du chemin. On n'en garde que l'extension.
    const extension = extname(file.originalname).toLowerCase().slice(0, 8);
    const key = join(folder, `${Date.now()}-${randomBytes(12).toString('hex')}${extension}`).replace(/\\/g, '/');
    const target = this.absolute(key);

    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.buffer);

    return {
      key,
      mimeType: file.mimetype,
      size: file.buffer.byteLength,
      sha256: createHash('sha256').update(file.buffer).digest('hex'),
    };
  }

  read(key: string): Promise<Buffer> {
    return readFile(this.absolute(key));
  }

  async remove(key: string): Promise<void> {
    try {
      await unlink(this.absolute(key));
    } catch (error) {
      // Un fichier déjà absent n'est pas un échec métier : la suppression est
      // idempotente. On trace, on continue.
      this.logger.warn(`Suppression impossible pour ${key} : ${String(error)}`);
    }
  }

  /**
   * Résout une clé sous la racine de stockage, en refusant tout ce qui sort du
   * dossier (`../../etc/passwd`). La clé vient de la base, mais une base se
   * corrompt et un jour quelqu'un passera une clé venue d'une requête.
   */
  private absolute(key: string): string {
    const target = resolve(this.root, normalize(key));
    if (target !== this.root && !target.startsWith(this.root + sep)) {
      throw new Error('Clé de stockage hors du dossier autorisé.');
    }
    return target;
  }
}
