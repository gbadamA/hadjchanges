/**
 * Jeu de données de développement — Côte d'Ivoire.
 *
 * Idempotent : relançable sans doublon (upsert sur les clés naturelles).
 * Les taux, eux, sont VOLONTAIREMENT publiés en plusieurs versions : sans
 * historique, on ne peut rien vérifier de la variation ni de la fraîcheur.
 *
 * ⚠️ Les taux ci-dessous sont plausibles, PAS officiels. Seule la parité
 * EUR/XOF (655,957) est fixe par construction du franc CFA — les autres
 * doivent être remplacés par les taux réels de l'exploitant avant mise en ligne.
 */
import { CashMovementType, KycStatus, Prisma, PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/**
 * ⚠️ Ces mots de passe par défaut sont dans un dépôt PUBLIC : n'importe qui
 * peut les lire. Ils n'ont de sens qu'en développement.
 *
 * En production, le seed REFUSE de démarrer sans mots de passe explicites.
 * Sans ce garde-fou, un seul `prisma db seed` lancé par distraction créerait un
 * compte administrateur dont le mot de passe est publiquement connu — sur la
 * base d'un bureau de change.
 */
if (process.env.NODE_ENV === 'production') {
  const manquants = ['SEED_ADMIN_PASSWORD', 'SEED_CLIENT_PASSWORD'].filter(
    (cle) => !process.env[cle],
  );
  if (manquants.length > 0) {
    throw new Error(
      `Refus de peupler la base en production sans ${manquants.join(' et ')}. ` +
        'Les mots de passe par défaut du dépôt sont publics.',
    );
  }
}

const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Admin@2026';
const CLIENT_PASSWORD = process.env.SEED_CLIENT_PASSWORD ?? 'Client@2026';

async function main(): Promise<void> {
  const hashAdmin = await bcrypt.hash(ADMIN_PASSWORD, 12);
  const hashClient = await bcrypt.hash(CLIENT_PASSWORD, 12);

  // --- Devises ------------------------------------------------------------
  const currencies = [
    { code: 'XOF', name: 'Franc CFA', symbol: 'FCFA', decimals: 0, isBase: true, sortOrder: 0 },
    { code: 'EUR', name: 'Euro', symbol: '€', decimals: 2, isBase: false, sortOrder: 1 },
    { code: 'USD', name: 'Dollar américain', symbol: '$', decimals: 2, isBase: false, sortOrder: 2 },
    { code: 'SAR', name: 'Riyal saoudien', symbol: 'SR', decimals: 2, isBase: false, sortOrder: 3 },
    { code: 'GBP', name: 'Livre sterling', symbol: '£', decimals: 2, isBase: false, sortOrder: 4 },
    { code: 'AED', name: 'Dirham des Émirats', symbol: 'AED', decimals: 2, isBase: false, sortOrder: 5 },
    { code: 'CAD', name: 'Dollar canadien', symbol: 'C$', decimals: 2, isBase: false, sortOrder: 6 },
  ];
  for (const currency of currencies) {
    await prisma.currency.upsert({
      where: { code: currency.code },
      update: currency,
      create: currency,
    });
  }

  // --- Agences (Abidjan) --------------------------------------------------
  const agencies = [
    { code: 'PLT', name: 'HadjChanges Plateau', city: 'Abidjan', address: 'Av. Chardy, Plateau', phone: '2720301010' },
    { code: 'COC', name: 'HadjChanges Cocody', city: 'Abidjan', address: 'Riviera 2, Cocody', phone: '2720301011' },
    { code: 'YOP', name: 'HadjChanges Yopougon', city: 'Abidjan', address: 'Siporex, Yopougon', phone: '2720301012' },
    { code: 'AER', name: 'HadjChanges Aéroport FHB', city: 'Abidjan', address: "Hall d'arrivée, Port-Bouët", phone: '2720301013' },
  ];
  for (const agency of agencies) {
    await prisma.agency.upsert({
      where: { code: agency.code },
      update: agency,
      create: agency,
    });
  }
  const plateau = await prisma.agency.findUniqueOrThrow({ where: { code: 'PLT' } });
  const aeroport = await prisma.agency.findUniqueOrThrow({ where: { code: 'AER' } });

  // --- Comptes ------------------------------------------------------------
  const staff = [
    { phone: '0700000001', email: 'superadmin@hadjchanges.ci', firstName: 'Ibrahim', lastName: 'Koné', role: Role.SUPER_ADMIN, agencyId: null },
    { phone: '0700000002', email: 'admin@hadjchanges.ci', firstName: 'Aminata', lastName: 'Traoré', role: Role.ADMIN, agencyId: null },
    { phone: '0700000003', email: 'operateur.plateau@hadjchanges.ci', firstName: 'Yao', lastName: 'Kouassi', role: Role.OPERATEUR, agencyId: plateau.id },
    { phone: '0700000004', email: 'operateur.aeroport@hadjchanges.ci', firstName: 'Fatoumata', lastName: 'Diarra', role: Role.OPERATEUR, agencyId: aeroport.id },
  ];
  for (const member of staff) {
    await prisma.user.upsert({
      where: { phone: member.phone },
      update: { role: member.role, agencyId: member.agencyId, email: member.email },
      create: { ...member, passwordHash: hashAdmin, kycStatus: KycStatus.VALIDE },
    });
  }

  const clients = [
    // Un client vérifié : il peut transiger.
    // ⚠️ Plafonds volontairement larges POUR CE COMPTE DE DÉMONSTRATION : chaque
    // passage du script de vérification exécute un change réel et consomme le
    // plafond journalier. Avec la valeur par défaut (2 000 000 XOF), la suite
    // devenait interrompue après quelques exécutions dans la même journée — un
    // faux négatif qui ressemblait à une régression. Les autres comptes gardent
    // les plafonds normaux, et le contrôle « plafond dépassé » reste valable.
    {
      phone: '0709000001',
      email: 'client.valide@example.ci',
      firstName: 'Moussa',
      lastName: 'Bamba',
      kycStatus: KycStatus.VALIDE,
      kycValidatedAt: new Date(),
      dailyLimitXof: new Prisma.Decimal(50_000_000),
      monthlyLimitXof: new Prisma.Decimal(500_000_000),
    },
    // Un client en attente : il consulte et simule, rien de plus.
    { phone: '0709000002', email: 'client.attente@example.ci', firstName: 'Adjoua', lastName: 'N’Guessan', kycStatus: KycStatus.EN_ATTENTE, kycValidatedAt: null },
    // Un client rejeté : il doit redéposer sa pièce.
    { phone: '0709000003', email: 'client.rejete@example.ci', firstName: 'Salif', lastName: 'Ouattara', kycStatus: KycStatus.REJETE, kycValidatedAt: null },
  ];
  for (const client of clients) {
    await prisma.user.upsert({
      where: { phone: client.phone },
      // Les plafonds sont repoussés aussi à la MISE À JOUR : sans ça, un compte
      // déjà semé garderait les valeurs par défaut et le seed n'aurait aucun
      // effet sur une base existante.
      update: {
        kycStatus: client.kycStatus,
        dailyLimitXof: 'dailyLimitXof' in client ? client.dailyLimitXof : null,
        monthlyLimitXof: 'monthlyLimitXof' in client ? client.monthlyLimitXof : null,
      },
      create: {
        ...client,
        role: Role.CLIENT,
        passwordHash: hashClient,
        kycRejectReason:
          client.kycStatus === KycStatus.REJETE ? 'Pièce illisible : photo floue au verso.' : null,
      },
    });
  }
  const admin = await prisma.user.findUniqueOrThrow({ where: { phone: '0700000002' } });

  // --- Taux : trois versions par devise, pour avoir une vraie histoire -----
  const hoursAgo = (hours: number): Date => new Date(Date.now() - hours * 3_600_000);
  const rateVersions: Array<{ code: string; buy: number; sell: number; commission: number; at: Date }> = [
    // EUR — parité fixe 655,957 : la marge se prend sur l'écart achat/vente.
    { code: 'EUR', buy: 645.0, sell: 668.0, commission: 1.0, at: hoursAgo(72) },
    { code: 'EUR', buy: 646.5, sell: 667.0, commission: 1.0, at: hoursAgo(36) },
    { code: 'EUR', buy: 647.0, sell: 666.5, commission: 1.0, at: hoursAgo(2) },

    { code: 'USD', buy: 592.0, sell: 618.0, commission: 1.5, at: hoursAgo(72) },
    { code: 'USD', buy: 596.0, sell: 621.0, commission: 1.5, at: hoursAgo(30) },
    { code: 'USD', buy: 594.5, sell: 619.0, commission: 1.5, at: hoursAgo(3) },

    { code: 'SAR', buy: 155.0, sell: 168.0, commission: 2.0, at: hoursAgo(48) },
    { code: 'SAR', buy: 156.5, sell: 167.0, commission: 2.0, at: hoursAgo(4) },

    { code: 'GBP', buy: 748.0, sell: 782.0, commission: 1.5, at: hoursAgo(50) },
    { code: 'GBP', buy: 752.0, sell: 786.0, commission: 1.5, at: hoursAgo(5) },

    { code: 'AED', buy: 158.0, sell: 172.0, commission: 2.0, at: hoursAgo(6) },

    // CAD volontairement ancien : sert à voir l'alerte « taux périmé ».
    { code: 'CAD', buy: 425.0, sell: 452.0, commission: 2.0, at: hoursAgo(96) },
  ];

  for (const version of rateVersions) {
    const currency = await prisma.currency.findUniqueOrThrow({ where: { code: version.code } });
    const already = await prisma.exchangeRate.findFirst({
      where: { currencyId: currency.id, agencyId: null, effectiveFrom: version.at },
    });
    if (already) continue;
    await prisma.exchangeRate.create({
      data: {
        currencyId: currency.id,
        buyRate: version.buy,
        sellRate: version.sell,
        commissionPct: version.commission,
        agencyId: null,
        effectiveFrom: version.at,
        createdById: admin.id,
      },
    });
  }

  // Taux différencié : l'aéroport prend une marge plus large (cahier §3.1).
  const eur = await prisma.currency.findUniqueOrThrow({ where: { code: 'EUR' } });
  const airportRate = await prisma.exchangeRate.findFirst({
    where: { currencyId: eur.id, agencyId: aeroport.id },
  });
  if (!airportRate) {
    await prisma.exchangeRate.create({
      data: {
        currencyId: eur.id,
        buyRate: 638.0,
        sellRate: 675.0,
        commissionPct: 2.5,
        agencyId: aeroport.id,
        effectiveFrom: hoursAgo(2),
        createdById: admin.id,
      },
    });
  }

  // --- Alimentation des caisses -------------------------------------------
  // Sans encaisse, aucun change ne peut s'exécuter : le bureau ne peut pas
  // remettre des billets qu'il n'a pas. On dote donc chaque agence d'un fonds
  // de roulement plausible, via de VRAIS mouvements de caisse — le solde reste
  // ainsi la somme de son historique, comme en production.
  const superAdmin = await prisma.user.findUniqueOrThrow({ where: { phone: '0700000001' } });
  const fundings: Array<{ code: string; amounts: Record<string, string> }> = [
    { code: 'PLT', amounts: { XOF: '50000000', EUR: '40000', USD: '35000', GBP: '8000', SAR: '120000', AED: '90000', CAD: '10000' } },
    { code: 'AER', amounts: { XOF: '30000000', EUR: '25000', USD: '25000', GBP: '5000', SAR: '80000', AED: '60000', CAD: '6000' } },
    { code: 'ADJ', amounts: { XOF: '15000000', EUR: '10000', USD: '8000', SAR: '40000' } },
    { code: 'YKR', amounts: { XOF: '10000000', EUR: '6000', USD: '5000', SAR: '25000' } },
  ];

  for (const funding of fundings) {
    const agency = await prisma.agency.findUnique({ where: { code: funding.code } });
    if (!agency) continue;

    for (const [code, amount] of Object.entries(funding.amounts)) {
      const currency = await prisma.currency.findUnique({ where: { code } });
      if (!currency) continue;

      // Idempotence : on ne réalimente pas une caisse déjà dotée.
      const existing = await prisma.cashMovement.findFirst({
        where: { agencyId: agency.id, currencyId: currency.id, type: CashMovementType.ALIMENTATION },
      });
      if (existing) continue;

      const value = new Prisma.Decimal(amount);
      await prisma.cashMovement.create({
        data: {
          agencyId: agency.id,
          currencyId: currency.id,
          type: CashMovementType.ALIMENTATION,
          amount: value,
          balanceAfter: value,
          note: 'Fonds de roulement initial',
          createdById: superAdmin.id,
        },
      });
      await prisma.cashBalance.upsert({
        where: { agencyId_currencyId: { agencyId: agency.id, currencyId: currency.id } },
        create: { agencyId: agency.id, currencyId: currency.id, amount: value },
        update: { amount: value },
      });
    }
  }

  // --- Réglages système ---------------------------------------------------
  const settings = [
    { key: 'rateLockMinutes', value: '30', label: 'Durée de validité du taux verrouillé (minutes)' },
    { key: 'rateStaleHours', value: '12', label: 'Alerte si un taux n’a pas été republié depuis (heures)' },
    { key: 'lcbFtThresholdXof', value: '5000000', label: 'Seuil de déclaration LCB-FT (XOF)' },
    { key: 'depositNumberOrange', value: '0700000000', label: 'Numéro de dépôt Orange Money' },
    { key: 'depositNumberMtn', value: '0500000000', label: 'Numéro de dépôt MTN MoMo' },
    { key: 'depositNumberMoov', value: '0100000000', label: 'Numéro de dépôt Moov Money' },
  ];
  for (const setting of settings) {
    await prisma.setting.upsert({
      where: { key: setting.key },
      update: { label: setting.label },
      create: setting,
    });
  }

  const counts = {
    devises: await prisma.currency.count(),
    agences: await prisma.agency.count(),
    comptes: await prisma.user.count(),
    versionsDeTaux: await prisma.exchangeRate.count(),
    reglages: await prisma.setting.count(),
    caissesAlimentees: await prisma.cashBalance.count(),
  };
  console.log('Seed terminé :', counts);
  console.log(`Comptes internes : mot de passe « ${ADMIN_PASSWORD} » · clients : « ${CLIENT_PASSWORD} »`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
