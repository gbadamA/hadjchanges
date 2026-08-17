import { z } from 'zod';

/**
 * Validation des variables d'environnement AU DÉMARRAGE.
 * Une variable manquante doit faire échouer le boot, pas produire un
 * `undefined` qui casse trois écrans plus loin.
 */
const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().int().positive().default(3061),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),

  CORS_ORIGINS: z.string().default('http://localhost:3060'),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./uploads'),

  // Stockage objet. Vides tant que `STORAGE_DRIVER=local` ; le module de
  // stockage refuse de démarrer en mode s3 s'il en manque une.
  S3_ENDPOINT: z.string().default(''),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default(''),
  S3_ACCESS_KEY: z.string().default(''),
  S3_SECRET_KEY: z.string().default(''),

  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().default(1036),
  MAIL_FROM: z.string().default('HadjChanges <no-reply@hadjchanges.ci>'),

  // Canaux sortants payants. Vides par défaut : le transport se déclare alors
  // NON configuré et le service passe au canal suivant, plutôt que de faire
  // semblant d'avoir envoyé.
  WHATSAPP_TOKEN: z.string().default(''),
  WHATSAPP_PHONE_ID: z.string().default(''),
  TWILIO_ACCOUNT_SID: z.string().default(''),
  TWILIO_AUTH_TOKEN: z.string().default(''),
  TWILIO_FROM: z.string().default(''),

  BASE_CURRENCY: z.string().length(3).default('XOF'),
  RATE_LOCK_MINUTES: z.coerce.number().int().positive().default(30),
  RATE_STALE_HOURS: z.coerce.number().int().positive().default(12),
  DEFAULT_DAILY_LIMIT_XOF: z.coerce.number().nonnegative().default(2_000_000),
  DEFAULT_MONTHLY_LIMIT_XOF: z.coerce.number().nonnegative().default(10_000_000),
  LCB_FT_THRESHOLD_XOF: z.coerce.number().nonnegative().default(5_000_000),
});

export type Env = z.infer<typeof envSchema> & { corsOrigins: string[] };

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Variables d'environnement invalides :\n${details}`);
  }
  return {
    ...parsed.data,
    // ⚠️ Même raison que côté tableau de bord : Render fournit l'hôte sans
    // schéma, alors que l'en-tête `Origin` d'un navigateur en porte toujours
    // un. Sans cette normalisation, AUCUNE origine ne correspondrait et le
    // tableau de bord se verrait refuser chaque appel.
    corsOrigins: parsed.data.CORS_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean)
      .map((origin) => {
        if (/^https?:\/\//.test(origin)) return origin;
        // Réseau local (localhost, 10.x, 172.16-31.x, 192.168.x) : ces adresses ne
  // portent jamais de certificat, donc http. Tout le reste est supposé https.
  const local =
    /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:|$)/.test(origin);
        return `${local ? 'http' : 'https'}://${origin}`;
      }),
  };
}
