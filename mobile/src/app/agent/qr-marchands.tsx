import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { api, ApiError, type PublicSettings } from '../../api';
import { useAuth } from '../../auth';
import { DEPOSIT_LABEL, type DepositMethod } from '../../models';
import { RESEAUX_MOBILE } from '../../paiement-qr';
import { ScanOverlay } from '../../scan';
import { C, R, S, T } from '../../theme';
import { Badge, Button, Card, EmptyState, ErrorBanner, FormScreen, Loader } from '../../ui';

/** Réseau → clé du réglage côté API (`MERCHANT_QR_KEYS`). */
const CLE: Record<string, string> = {
  WAVE: 'merchantQrWave',
  ORANGE_MONEY: 'merchantQrOrange',
  MTN_MOMO: 'merchantQrMtn',
  MOOV_MONEY: 'merchantQrMoov',
};

/**
 * Enregistrement des QR marchands du bureau, réseau par réseau.
 *
 * Le super-administrateur SCANNE l'autocollant fourni par chaque opérateur :
 * le contenu n'est jamais retapé. Un caractère faux et l'argent des clients
 * partirait chez un autre marchand — d'où aussi l'aperçu à vérifier avant
 * d'enregistrer, en le scannant avec l'application de l'opérateur.
 */
export default function QrMarchands(): ReactNode {
  const { accessToken, profile } = useAuth();
  const router = useRouter();
  const [reglages, setReglages] = useState<PublicSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanPour, setScanPour] = useState<DepositMethod | null>(null);
  const [lu, setLu] = useState<{ reseau: DepositMethod; contenu: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setReglages(await api.publicSettings());
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Réglages illisibles.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const enregistrer = async (): Promise<void> => {
    if (!accessToken || !lu) return;
    setBusy(true);
    setError(null);
    try {
      await api.updateSetting(CLE[lu.reseau], lu.contenu, accessToken);
      setNotice(`QR ${DEPOSIT_LABEL[lu.reseau]} enregistré.`);
      setLu(null);
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Enregistrement impossible.');
    } finally {
      setBusy(false);
    }
  };

  if (profile?.role !== 'SUPER_ADMIN') {
    return (
      <FormScreen>
        <EmptyState
          title="Réservé au super-administrateur"
          message="Les QR marchands déterminent où va l’argent des clients : seul le super-administrateur les enregistre."
          action={<Button label="Retour" onPress={() => router.back()} />}
        />
      </FormScreen>
    );
  }
  if (loading) return <Loader label="Lecture des réglages…" />;

  return (
    <FormScreen>
      <View style={styles.head}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color={C.ink} />
        </Pressable>
        <Text style={T.h1}>QR marchands</Text>
      </View>
      <Text style={T.bodyMute}>
        Scannez l’autocollant QR fourni par chaque opérateur. Les agents l’afficheront au comptoir
        pour que le client paie avec son application.
      </Text>

      <ErrorBanner message={error} />
      {notice ? (
        <Card style={{ backgroundColor: C.okSoft }}>
          <Text style={[T.body, { color: C.ok }]}>{notice}</Text>
        </Card>
      ) : null}

      {lu ? (
        <Card style={styles.bloc}>
          <Text style={T.title}>Vérifier avant d’enregistrer — {DEPOSIT_LABEL[lu.reseau]}</Text>
          <View style={styles.apercu}>
            <QRCode value={lu.contenu} size={180} backgroundColor="#FFFFFF" quietZone={10} />
          </View>
          <Text style={T.caption} selectable numberOfLines={3}>
            {lu.contenu}
          </Text>
          <Text style={T.caption}>
            Scannez cet aperçu avec l’application {DEPOSIT_LABEL[lu.reseau]} : le nom du marchand
            affiché doit être celui du bureau.
          </Text>
          <Button label={busy ? 'Enregistrement…' : 'Enregistrer ce QR'} variant="accent" disabled={busy} onPress={() => void enregistrer()} />
          <Button label="Annuler" variant="ghost" onPress={() => setLu(null)} />
        </Card>
      ) : null}

      {RESEAUX_MOBILE.map((reseau) => {
        const present = Boolean(reglages?.merchantQr[reseau]);
        return (
          <Card key={reseau} style={styles.bloc}>
            <View style={styles.rangee}>
              <Text style={T.title}>{DEPOSIT_LABEL[reseau]}</Text>
              <Badge
                label={present ? 'Enregistré' : 'À scanner'}
                color={present ? C.ok : C.warn}
                soft={present ? C.okSoft : C.warnSoft}
              />
            </View>
            <Button
              label={present ? 'Remplacer en scannant' : 'Scanner l’autocollant'}
              variant={present ? 'ghost' : 'primary'}
              onPress={() => {
                setNotice(null);
                setScanPour(reseau);
              }}
            />
          </Card>
        );
      })}

      {scanPour ? (
        <ScanOverlay
          brut
          consigne={`Présentez l’autocollant ${DEPOSIT_LABEL[scanPour]} dans le cadre`}
          onCode={(contenu) => {
            setLu({ reseau: scanPour, contenu });
            setScanPour(null);
          }}
          onClose={() => setScanPour(null)}
        />
      ) : null}
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: S.md, paddingTop: S.xxl },
  bloc: { gap: S.sm },
  rangee: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  apercu: { alignSelf: 'center', padding: S.xs, backgroundColor: '#FFFFFF', borderRadius: R.sm },
});
