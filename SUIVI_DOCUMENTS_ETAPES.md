# Suivi documents prospects — étapes d'installation

Le code est déjà en ligne (CRM v25/08·b32 + page publique `doc.html`).
Il reste **4 étapes dans le tableau de bord Supabase** (projet `graujqkrxxceskgnqfin`),
environ 10 minutes.

## 1. Créer les tables (SQL Editor)

Supabase → **SQL Editor** → coller le contenu de `SUIVI_DOCUMENTS.sql` → **Run**.
Attendu : `Success. No rows returned`.

## 2. Déployer les 2 Edge Functions

Supabase → **Edge Functions** → **Deploy a new function** → *Via Editor* :

1. Nom : `doc-send` → remplacer le code par le contenu de
   `supabase/functions/doc-send/index.ts` → **Deploy**.
2. Nom : `doc-open` → idem avec `supabase/functions/doc-open/index.ts` → **Deploy**.

## 3. Rendre doc-open publique + secrets SMTP

**doc-open est appelée par les prospects (pas de compte)** :
Edge Functions → `doc-open` → onglet **Details** →
désactiver **« Enforce JWT verification »** (ou « Verify JWT ») → Save.
⚠️ Ne PAS le faire pour `doc-send` ni `admin-set-password` (elles restent protégées).

Puis Edge Functions → **Secrets** (ou Settings → Edge Functions) → ajouter :

| Secret | Valeur |
|---|---|
| `SMTP_USER` | `sgalin@kipsafe.fr` |
| `SMTP_PASS` | le mot de passe de la boîte (mot de passe **d'application** si MFA — le même que celui saisi dans Auth → SMTP) |

Optionnels : `NOTIFY_TO` (destinataire des notifications d'ouverture, défaut = SMTP_USER),
`SMTP_FROM_NAME` (défaut « KIPSAFE »).

## 4. Tester

1. CRM → **📁 Documents** → onglet **📤 Envois prospects** → **➕ Nouvel envoi**.
2. Choisir un document, mettre TON email (`galinsamuel@gmail.com`) comme « prospect » → Envoyer.
3. Tu reçois l'email → clique le bouton → le document s'affiche sur la page KIPSAFE.
4. Vérifie : notification email « 📬 … a ouvert … (1re ouverture) » sur `sgalin@kipsafe.fr`,
   compteur « 1 fois » dans le tableau (et toast 📬 en direct si le CRM est ouvert).

## Comment ça marche (rappel)

- **Nouvel envoi** = lien personnel `…/doc.html?t=<token>` créé + email automatique
  au prospect depuis `sgalin@kipsafe.fr`.
- Chaque clic du prospect → la page appelle `doc-open` → **+1 au compteur**,
  ligne d'historique, **email de notification**, puis le document s'affiche
  (URL signée 1 h, bucket privé — le lien ne donne accès qu'à CE document).
- Tableau de bord : Documents → 📤 Envois prospects (compteurs, « N fois »,
  dernière ouverture ; clic sur une ligne = historique détaillé ; 🔗 copie le lien).
- Supprimer un lien (🗑️) le désactive immédiatement chez le prospect.

## En cas de problème

- « Suivi non installé » dans l'onglet → l'étape 1 n'est pas faite.
- « Fonction doc-send injoignable » → l'étape 2 n'est pas faite.
- « Lien créé mais email NON parti » → secrets SMTP absents/faux (étape 3) ;
  le lien existe quand même : bouton 🔗 pour l'envoyer à la main.
- Page prospect « Lien invalide » → lien supprimé dans le CRM, ou token tronqué
  dans l'email.
