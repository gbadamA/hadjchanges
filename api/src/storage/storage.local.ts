import { Injectable, Logger } from '@nestjs/common';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, normalize, resolve, sep } from 'node:path';
import { loadEnv } from '../config/env';
import { StorageService, type StoredFile, type UploadableFile } from './storage.service';

/**
 * Stockage sur le disque de la machine — le mode de développement.
 *
 * Suffisant tant qu'il n'y a qu'un serveur. Dès qu'il y en a deux derrière un
 * répartiteur, un fichier déposé sur l'un devient illisible depuis l'autre :
 * c'est le moment de passer à S3 (`STORAGE_DRIVER=s3`).
 */
@Injectable()
export class LocalStorageAdapter extends StorageService {
  private readonly logger = new Logger(LocalStorageAdapter.name);
  private readonly root: string;

  constructor() {
    super();
    this.root = resolve(loadEnv().STORAGE_LOCAL_DIR);
  }

  async save(file: UploadableFile, folder: string): Promise<StoredFile> {
    const key = this.buildKey(file.originalname, folder);
    const target = this.absolute(key);

    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.buffer);

    return this.describe(key, file);
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
