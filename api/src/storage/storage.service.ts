import { extname, join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

export interface StoredFile {
  /** Clé opaque conservée en base. Jamais une URL, jamais un nom d'origine. */
  key: string;
  mimeType: string;
  size: number;
  /** Empreinte du contenu : deux dépôts identiques se repèrent sans comparer les octets. */
  sha256: string;
}

export interface UploadableFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}

/**
 * **Port** de stockage des fichiers déposés (pièces d'identité, reçus,
 * justificatifs PDF).
 *
 * ⚠️ **Rien de tout ceci n'est servi en statique.** Une photo de CNI derrière
 * une URL devinable est une fuite de données, même avec un nom aléatoire : les
 * URL fuient par les journaux, l'historique, le presse-papier. Toute lecture
 * passe par un contrôleur qui vérifie les droits, puis par `read()`.
 *
 * Classe abstraite plutôt qu'interface : TypeScript efface les interfaces à la
 * compilation, or Nest a besoin d'un **jeton d'injection qui existe à
 * l'exécution**. Les consommateurs injectent `StorageService` sans jamais
 * savoir si le fichier part sur un disque ou dans un compartiment S3 (DIP).
 */
export abstract class StorageService {
  abstract save(file: UploadableFile, folder: string): Promise<StoredFile>;
  abstract read(key: string): Promise<Buffer>;
  abstract remove(key: string): Promise<void>;

  /**
   * Clé de stockage. Commune aux deux adaptateurs : le jour d'une migration du
   * disque vers S3, les clés déjà en base doivent rester valables telles quelles.
   *
   * Le nom d'origine est jeté — il peut porter le nom du client, sa date de
   * naissance, ou du chemin. On n'en garde que l'extension.
   */
  protected buildKey(originalname: string, folder: string): string {
    const extension = extname(originalname).toLowerCase().slice(0, 8);
    return join(folder, `${Date.now()}-${randomBytes(12).toString('hex')}${extension}`).replace(
      /\\/g,
      '/',
    );
  }

  protected describe(key: string, file: UploadableFile): StoredFile {
    return {
      key,
      mimeType: file.mimetype,
      size: file.buffer.byteLength,
      sha256: createHash('sha256').update(file.buffer).digest('hex'),
    };
  }
}
