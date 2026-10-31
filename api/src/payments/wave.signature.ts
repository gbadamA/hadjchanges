import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Vérification de l'en-tête `Wave-Signature`.
 *
 * Isolé dans son propre fichier, sans Nest ni réseau : c'est le point qui
 * décide si un événement déplaçant de l'argent est digne de confiance. Il doit
 * pouvoir être éprouvé seul, et il l'a été — voir ci-dessous.
 *
 * Forme de l'en-tête : `t=<secondes unix>,v1=<hex>`. Plusieurs `v1=` peuvent
 * coexister pendant une rotation de secret : Wave envoie alors l'événement
 * signé avec l'ancien ET le nouveau. On accepte dès que l'un correspond.
 *
 * ⚠️ **La charge signée est `horodatage + corps BRUT`**, pas le corps seul.
 * Vérifié contre l'exemple publié par Wave (`t=1667920421`, signature
 * `53c9716952…`) : le calcul reproduit sa signature au caractère près. Le même
 * JSON re-sérialisé sous forme compacte produit une signature DIFFÉRENTE — donc
 * tout code qui parse le corps avant de vérifier rejettera tous les événements
 * authentiques. D'où `Buffer` ici, et `rawBody: true` au démarrage de Nest.
 */

/** Tolérance au passé. Wave : « rejeter les requêtes de plus de 5 minutes ». */
const ANCIENNETE_MAX_MS = 5 * 60 * 1000;

/**
 * Tolérance au futur. Wave ne la fixe pas pour les webhooks, mais une horloge
 * serveur qui dérive de quelques secondes ne doit pas faire perdre un paiement.
 * Large assez pour une dérive normale, court assez pour ne rien ouvrir.
 */
const AVANCE_MAX_MS = 60 * 1000;

export class SignatureInvalideError extends Error {
  constructor(
    readonly code:
      | 'signature-absente'
      | 'format-invalide'
      | 'horodatage-expire'
      | 'signature-refusee',
    message: string,
  ) {
    super(message);
    this.name = 'SignatureInvalideError';
  }
}

/** Compare sans fuir d'information par le temps de calcul. */
function egalConstant(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  // `timingSafeEqual` exige des longueurs égales : les comparer d'abord
  // révèle seulement la longueur, pas le contenu.
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Lève `SignatureInvalideError` si l'événement n'est pas authentique.
 *
 * @param rawBody corps EXACT reçu, non parsé, non re-sérialisé.
 * @param header  valeur de l'en-tête `Wave-Signature`.
 * @param secret  secret de webhook (`wave_sn_WHS_…`), distinct de la clé d'API.
 * @param maintenant injectable pour éprouver la fenêtre de rejeu.
 */
export function verifierSignatureWave(
  rawBody: Buffer,
  header: string | undefined,
  secret: string,
  maintenant: Date = new Date(),
): void {
  if (!header?.trim()) {
    throw new SignatureInvalideError('signature-absente', 'En-tête Wave-Signature absent.');
  }

  let horodatage: string | null = null;
  const signatures: string[] = [];
  for (const partie of header.split(',')) {
    const separateur = partie.indexOf('=');
    if (separateur === -1) continue;
    const cle = partie.slice(0, separateur).trim();
    const valeur = partie.slice(separateur + 1).trim();
    if (cle === 't') horodatage = valeur;
    // Plusieurs v1 pendant une rotation de secret : on les garde tous.
    else if (cle === 'v1' && valeur) signatures.push(valeur);
  }

  if (!horodatage || !/^\d+$/.test(horodatage) || signatures.length === 0) {
    throw new SignatureInvalideError(
      'format-invalide',
      'En-tête Wave-Signature mal formé : « t=<secondes>,v1=<hex> » attendu.',
    );
  }

  // ⚠️ Fenêtre de rejeu AVANT le calcul : un attaquant qui rejoue un événement
  // authentique capté plus tôt présente une signature parfaitement valable.
  // Seul l'horodatage le distingue d'un événement neuf.
  const ecartMs = maintenant.getTime() - Number(horodatage) * 1000;
  if (ecartMs > ANCIENNETE_MAX_MS || ecartMs < -AVANCE_MAX_MS) {
    throw new SignatureInvalideError(
      'horodatage-expire',
      'Horodatage de signature hors de la fenêtre acceptée (rejeu probable).',
    );
  }

  // La charge est la CONCATÉNATION de l'horodatage et des octets reçus.
  const attendue = createHmac('sha256', secret)
    .update(horodatage, 'utf8')
    .update(rawBody)
    .digest('hex');

  if (!signatures.some((candidate) => egalConstant(candidate, attendue))) {
    throw new SignatureInvalideError('signature-refusee', 'Signature Wave invalide.');
  }
}
