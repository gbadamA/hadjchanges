import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Injectable, Logger } from '@nestjs/common';
import { loadEnv } from '../config/env';
import { StorageService, type StoredFile, type UploadableFile } from './storage.service';

/**
 * Stockage objet compatible S3 (AWS, Scaleway, MinIO, Backblaze…).
 *
 * ⚠️ **Le compartiment doit être PRIVÉ.** On y dépose des pièces d'identité :
 * aucun objet n'est public, aucune URL pré-signée n'est distribuée. La lecture
 * passe par l'API, qui vérifie les droits puis relaie les octets — exactement
 * comme en local. C'est plus coûteux en bande passante qu'une URL signée, et
 * c'est le prix d'un contrôle d'accès qui ne fuit pas.
 *
 * ⚠️ **`forcePathStyle` est indispensable hors AWS** : MinIO et la plupart des
 * fournisseurs compatibles n'acceptent pas l'adressage par sous-domaine.
 */
@Injectable()
export class S3StorageAdapter extends StorageService {
  private readonly logger = new Logger(S3StorageAdapter.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    super();
    const env = loadEnv();
    this.bucket = env.S3_BUCKET;

    this.client = new S3Client({
      endpoint: env.S3_ENDPOINT || undefined,
      region: env.S3_REGION,
      forcePathStyle: true,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY,
        secretAccessKey: env.S3_SECRET_KEY,
      },
    });
    this.logger.log(`Stockage S3 actif sur le compartiment « ${this.bucket} ».`);
  }

  async save(file: UploadableFile, folder: string): Promise<StoredFile> {
    const key = this.buildKey(file.originalname, folder);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
        // Ceinture et bretelles : même si la politique du compartiment était
        // mal posée, l'objet reste privé.
        ACL: 'private',
      }),
    );
    return this.describe(key, file);
  }

  async read(key: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!response.Body) throw new Error(`Objet vide ou absent : ${key}`);
    // `transformToByteArray` évite d'assembler le flux à la main et fonctionne
    // aussi bien sous Node que dans les runtimes edge.
    return Buffer.from(await response.Body.transformToByteArray());
  }

  async remove(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (error) {
      this.logger.warn(`Suppression impossible pour ${key} : ${String(error)}`);
    }
  }
}
