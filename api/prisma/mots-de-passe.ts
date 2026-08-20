/**
 * Redéfinit les mots de passe des comptes du seed, et RIEN d'autre.
 *
 *   SEED_ADMIN_PASSWORD=... SEED_CLIENT_PASSWORD=... npx tsx prisma/mots-de-passe.ts
 *
 * ⚠️ Pourquoi ce script plutôt que de rejouer `prisma/seed.ts` : le seed insère
 * l'historique des taux et les mouvements de caisse par `.create()`, sans clé
 * naturelle. Le relancer sur une base déjà peuplée les DUPLIQUERAIT — des
 * versions de taux fantômes et des caisses faussées, sur un bureau de change.
 * Ici on ne fait qu'un `update` ciblé sur des comptes qui existent déjà.
 *
 * Sans effet sur les comptes créés par les utilisateurs eux-mêmes : seuls les
 * numéros du seed sont touchés.
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/** Comptes internes — tous alignés sur le même mot de passe, comme le seed. */
const INTERNES = ['0700000001', '0700000002', '0700000003', '0700000004'];
/** Comptes clients de démonstration. */
const CLIENTS = ['0709000001', '0709000002', '0709000003'];

async function main(): Promise<void> {
  const admin = process.env.SEED_ADMIN_PASSWORD;
  const client = process.env.SEED_CLIENT_PASSWORD;

  if (!admin || !client) {
    throw new Error(
      'SEED_ADMIN_PASSWORD et SEED_CLIENT_PASSWORD sont requis. ' +
        'Aucun mot de passe par défaut ici : ce script peut viser une base réelle.',
    );
  }

  const hashAdmin = await bcrypt.hash(admin, 12);
  const hashClient = await bcrypt.hash(client, 12);

  const lots: Array<{ etiquette: string; phones: string[]; hash: string }> = [
    { etiquette: 'comptes internes', phones: INTERNES, hash: hashAdmin },
    { etiquette: 'clients de démo', phones: CLIENTS, hash: hashClient },
  ];

  for (const lot of lots) {
    // `updateMany` ne touche que les lignes trouvées : un numéro absent de la
    // base n'est pas créé, il est simplement ignoré.
    const { count } = await prisma.user.updateMany({
      where: { phone: { in: lot.phones } },
      data: { passwordHash: lot.hash },
    });
    console.log(`${lot.etiquette.padEnd(18)} ${count}/${lot.phones.length} compte(s) mis à jour`);
  }

  // ⚠️ On n'écrit JAMAIS les mots de passe dans la sortie : ce script tourne
  // dans des terminaux dont l'historique se garde, et se copie-colle dans des
  // tickets. Le seed le faisait, c'était une mauvaise habitude.
  console.log('\nTerminé. Les mots de passe ne sont pas affichés, par précaution.');
}

main()
  .catch((cause: unknown) => {
    console.error(cause instanceof Error ? cause.message : cause);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
