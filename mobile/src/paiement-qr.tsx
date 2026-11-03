import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import type { PublicSettings } from './api';
import { DEPOSIT_LABEL, money, type DepositMethod } from './models';
import { C, R, S, T } from './theme';
import { Field, Segmented } from './ui';

/** Réseaux payables par QR marchand — mêmes valeurs que l'API. */
export const RESEAUX_MOBILE: ReadonlyArray<DepositMethod> = [
  'WAVE',
  'ORANGE_MONEY',
  'MTN_MOMO',
  'MOOV_MONEY',
];

export const estMobileMoney = (methode: DepositMethod): boolean =>
  RESEAUX_MOBILE.includes(methode);

/** Libellés courts : cinq choix doivent tenir sur une ligne de téléphone. */
const COURT: Partial<Record<DepositMethod, string>> = {
  ESPECES_AGENCE: 'Espèces',
  WAVE: 'Wave',
  ORANGE_MONEY: 'Orange',
  MTN_MOMO: 'MTN',
  MOOV_MONEY: 'Moov',
};

export interface ChoixPaiement {
  methode: DepositMethod;
  /** Identifiant de transaction chez l'opérateur, lu sur le téléphone du client. */
  reference: string;
}

/** Prêt à être confirmé : l'identifiant est exigé dès qu'il y a un réseau. */
export const paiementComplet = (choix: ChoixPaiement): boolean =>
  !estMobileMoney(choix.methode) || choix.reference.trim().length >= 3;

/**
 * Encaissement au comptoir, selon le réseau du client.
 *
 * L'agent choisit le réseau ; l'écran affiche le **QR marchand du bureau**
 * pour ce réseau, avec le montant exact en grand. Le client le scanne avec
 * l'application de son opérateur, paie, et lit à l'agent l'identifiant de la
 * transaction. Cet identifiant est la SEULE trace qui reste du paiement : il
 * est exigé, l'API le refuse vide.
 *
 * ⚠️ Un QR marchand statique ne porte PAS le montant : c'est le client qui le
 * saisit dans son application. D'où le montant affiché juste sous le code, et
 * l'agent qui le fait relire avant que le client valide.
 *
 * Mobile money = FCFA uniquement. `especesSeules` force les espèces quand le
 * client paie en devises.
 */
export function PaiementComptoir({
  montant,
  devise,
  reglages,
  choix,
  onChange,
  especesSeules = false,
}: {
  montant: string;
  devise: string;
  reglages: PublicSettings | null;
  choix: ChoixPaiement;
  onChange: (choix: ChoixPaiement) => void;
  especesSeules?: boolean;
}): ReactNode {
  const montantLisible = money(montant, devise === 'XOF' ? 0 : 2, devise);

  if (especesSeules) {
    return (
      <View style={styles.bloc}>
        <Text style={T.label}>Paiement en espèces</Text>
        <Text style={T.caption}>
          Le client remet des devises : le mobile money ne transporte que des FCFA.
        </Text>
        <Text style={styles.montant}>{montantLisible}</Text>
      </View>
    );
  }

  const options = (['ESPECES_AGENCE', ...RESEAUX_MOBILE] as DepositMethod[]).map((value) => ({
    value,
    label: COURT[value] ?? DEPOSIT_LABEL[value],
  }));
  const qr = reglages?.merchantQr[choix.methode];
  const numero = reglages?.depositNumbers[choix.methode];

  return (
    <View style={styles.bloc}>
      <Text style={T.label}>Comment le client paie-t-il ?</Text>
      <Segmented
        value={choix.methode}
        onChange={(methode) => onChange({ methode, reference: '' })}
        options={options}
      />

      {!estMobileMoney(choix.methode) ? (
        <View style={styles.especes}>
          <Text style={T.caption}>À recevoir en espèces</Text>
          <Text style={styles.montant}>{montantLisible}</Text>
        </View>
      ) : (
        <>
          <View style={styles.qrCadre}>
            {qr ? (
              <>
                <Text style={T.label}>Le client scanne avec {DEPOSIT_LABEL[choix.methode]}</Text>
                <View style={styles.qr}>
                  {/* Fond blanc et marge : les lecteurs des opérateurs
                      échouent sur un QR collé au bord ou sur fond teinté. */}
                  <QRCode value={qr} size={208} backgroundColor="#FFFFFF" quietZone={12} />
                </View>
              </>
            ) : (
              <Text style={[T.body, { color: C.warn }]}>
                Aucun QR {DEPOSIT_LABEL[choix.methode]} enregistré.
                {numero ? ` Le client paie au ${numero}.` : ' Demandez au super-administrateur de le scanner (Service → QR marchands).'}
              </Text>
            )}
            <Text style={T.caption}>Montant exact à saisir par le client</Text>
            <Text style={styles.montant}>{montantLisible}</Text>
          </View>

          <Field
            label={`Identifiant de transaction ${DEPOSIT_LABEL[choix.methode]}`}
            value={choix.reference}
            onChangeText={(reference) => onChange({ ...choix, reference })}
            placeholder="lu sur le téléphone du client"
            autoCapitalize="none"
          />
          <Text style={T.caption}>
            Obligatoire : c’est la seule preuve du paiement. Vérifiez sur l’écran du client que le
            montant payé est bien {montantLisible}.
          </Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bloc: { gap: S.sm },
  especes: { gap: 2, paddingVertical: S.xs },
  qrCadre: {
    alignItems: 'center',
    gap: S.xs,
    padding: S.md,
    borderRadius: R.md,
    backgroundColor: C.surface2,
  },
  qr: { padding: S.xs, backgroundColor: '#FFFFFF', borderRadius: R.sm },
  montant: { ...T.h1, color: C.navy },
});
