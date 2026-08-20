# Redéfinit les mots de passe des comptes du seed sur une base DÉJÀ amorcée.
#
#   cd api
#   .\scripts\definir-mots-de-passe.ps1
#
# Ne touche QUE les mots de passe. Contrairement au seed complet, il ne réinsère
# ni taux ni mouvements de caisse — donc rejouable sans rien dupliquer.
#
# Les chaînes de connexion sont saisies masquées : elles ne passent ni par
# l'historique PowerShell, ni par un fichier.

$ErrorActionPreference = 'Stop'

function Read-Secret([string]$Prompt) {
    $secure = Read-Host -Prompt $Prompt -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

if (-not (Test-Path "./prisma/mots-de-passe.ts")) {
    Write-Host "ERREUR : lancez ce script depuis le dossier api/." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Collez les valeurs de Render (onglet Environment de hadjchanges-api)." -ForegroundColor Cyan
Write-Host "La saisie est masquee : rien ne s'affiche en tapant, c'est normal." -ForegroundColor DarkGray
Write-Host ""

$databaseUrl = Read-Secret "DATABASE_URL (pooler, port 6543)"
$directUrl   = Read-Secret "DIRECT_URL (pooler, port 5432)"

foreach ($paire in @(@('DATABASE_URL', $databaseUrl), @('DIRECT_URL', $directUrl))) {
    if ([string]::IsNullOrWhiteSpace($paire[1])) {
        Write-Host "ERREUR : $($paire[0]) est vide." -ForegroundColor Red
        exit 1
    }
    if ($paire[1] -notmatch '^postgresql://') {
        Write-Host "ERREUR : $($paire[0]) ne commence pas par postgresql:// — collez la chaine entiere, sans guillemets ni espace." -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "Mots de passe a definir (ceux du README : Admin@2026 / Client@2026)." -ForegroundColor Cyan
$adminPwd  = Read-Secret "Mot de passe des COMPTES INTERNES (super-admin, admin, operateurs)"
$clientPwd = Read-Secret "Mot de passe des CLIENTS de demonstration"

if ([string]::IsNullOrWhiteSpace($adminPwd) -or [string]::IsNullOrWhiteSpace($clientPwd)) {
    Write-Host "ERREUR : les deux mots de passe sont requis." -ForegroundColor Red
    exit 1
}

$env:DATABASE_URL = $databaseUrl
$env:DIRECT_URL = $directUrl
$env:SEED_ADMIN_PASSWORD = $adminPwd
$env:SEED_CLIENT_PASSWORD = $clientPwd

Write-Host ""
Write-Host "Client Prisma..." -ForegroundColor DarkGray
npx prisma generate | Out-Null

Write-Host "Mise a jour..." -ForegroundColor Cyan
npx tsx prisma/mots-de-passe.ts
$code = $LASTEXITCODE

Remove-Item Env:\DATABASE_URL, Env:\DIRECT_URL, Env:\SEED_ADMIN_PASSWORD, Env:\SEED_CLIENT_PASSWORD -ErrorAction SilentlyContinue
$databaseUrl = $directUrl = $adminPwd = $clientPwd = $null

Write-Host ""
if ($code -eq 0) {
    Write-Host "Termine." -ForegroundColor Green
} else {
    Write-Host "ECHEC (code $code) - voir le detail ci-dessus." -ForegroundColor Red
}
exit $code
