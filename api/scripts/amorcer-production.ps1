# Amorçage d'une base fraîchement déployée : crée les comptes, devises,
# agences, taux de départ — une seule fois, contre une base RÉELLE.
#
#   cd api
#   .\scripts\amorcer-production.ps1
#
# Les valeurs saisies ici ne quittent JAMAIS ce terminal : ni écrites dans un
# fichier, ni dans l'historique PowerShell (saisie masquée), ni transmises à
# qui que ce soit. Elles ne vivent que le temps du script, dans ce process.
#
# ⚠️ NON REJOUABLE SANS PRÉCAUTION : le seed insère l'historique des taux et
# les mouvements de caisse par `.create()`, pas par upsert — les relancer une
# seconde fois les DUPLIQUERAIT. Une seule exécution par base.

$ErrorActionPreference = 'Stop'

function Read-Secret([string]$Prompt) {
    $secure = Read-Host -Prompt $Prompt -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

Write-Host "Racine du dépôt attendue : ce script doit tourner depuis 'api/'." -ForegroundColor DarkGray
if (-not (Test-Path "./prisma/seed.ts")) {
    Write-Host "ERREUR : prisma/seed.ts introuvable. Lancez ce script depuis le dossier api/." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Collez les valeurs EXACTES de Render (onglet Environment de hadjchanges-api)." -ForegroundColor Cyan
Write-Host "Rien ne s'affichera à l'écran en tapant — c'est normal, la saisie est masquée." -ForegroundColor DarkGray
Write-Host ""

$databaseUrl = Read-Secret "DATABASE_URL (pooler, port 6543)"
$directUrl   = Read-Secret "DIRECT_URL (pooler, port 5432)"

if ([string]::IsNullOrWhiteSpace($databaseUrl) -or [string]::IsNullOrWhiteSpace($directUrl)) {
    Write-Host "ERREUR : les deux valeurs sont requises." -ForegroundColor Red
    exit 1
}
if ($databaseUrl -notmatch '^postgresql://') {
    Write-Host "ERREUR : DATABASE_URL ne commence pas par postgresql:// — copiez la chaîne entière, sans guillemets ni espace." -ForegroundColor Red
    exit 1
}
if ($directUrl -notmatch '^postgresql://') {
    Write-Host "ERREUR : DIRECT_URL ne commence pas par postgresql:// — copiez la chaîne entière, sans guillemets ni espace." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Mots de passe des comptes de démonstration à créer." -ForegroundColor Cyan
$adminPwd  = Read-Secret "Mot de passe ADMINISTRATEUR (0700000002)"
$clientPwd = Read-Secret "Mot de passe CLIENT démo (0709000001)"

if ([string]::IsNullOrWhiteSpace($adminPwd) -or [string]::IsNullOrWhiteSpace($clientPwd)) {
    Write-Host "ERREUR : les deux mots de passe sont requis." -ForegroundColor Red
    exit 1
}

$env:DATABASE_URL = $databaseUrl
$env:DIRECT_URL = $directUrl
$env:SEED_ADMIN_PASSWORD = $adminPwd
$env:SEED_CLIENT_PASSWORD = $clientPwd
# Volontairement PAS 'production' : le garde-fou de seed.ts ne réagit qu'à
# cette valeur, et les deux mots de passe sont déjà fournis explicitement ici.

Write-Host ""
Write-Host "Dépendances (sans effet si déjà installées)..." -ForegroundColor DarkGray
npm ci --silent

# ⚠️ `npm ci` n'exécute pas toujours `prisma generate` derrière le rideau selon
# la version de npm (le hook `postinstall` peut être court-circuité). Sans lui,
# le client livré n'est qu'un squelette qui échoue au premier `new PrismaClient()`
# avec un message qui ne dit pas "generate manquant" en toutes lettres.
Write-Host "Génération du client Prisma..." -ForegroundColor DarkGray
npx prisma generate

Write-Host ""
Write-Host "Amorçage en cours..." -ForegroundColor Cyan
npm run prisma:seed
$code = $LASTEXITCODE

# Nettoyage : ces valeurs ne doivent pas traîner dans le reste de la session.
Remove-Item Env:\DATABASE_URL, Env:\DIRECT_URL, Env:\SEED_ADMIN_PASSWORD, Env:\SEED_CLIENT_PASSWORD -ErrorAction SilentlyContinue
$databaseUrl = $directUrl = $adminPwd = $clientPwd = $null

Write-Host ""
if ($code -eq 0) {
    Write-Host "Terminé. Connectez-vous sur le tableau de bord avec 0700000002 et le mot de passe saisi." -ForegroundColor Green
} else {
    Write-Host "ÉCHEC (code $code) — voir le détail ci-dessus. Rien n'a été supprimé côté base." -ForegroundColor Red
}
exit $code
