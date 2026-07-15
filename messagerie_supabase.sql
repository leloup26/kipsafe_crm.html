-- ═══════════════════════════════════════════════════════════════════════════
-- KIPSAFE CRM — Messagerie interne
-- À exécuter UNE FOIS dans Supabase : Dashboard → SQL Editor → New query → Run
-- Sans risque : ne touche à aucune donnée existante, crée uniquement la table
-- des messages et ses règles de sécurité.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Table des messages
create table if not exists public.messages (
  id              bigint generated always as identity primary key,
  created_at      timestamptz not null default now(),
  conversation    text        not null,          -- 'team' (canal Équipe) ou 'dm' (message privé)
  sender_email    text        not null,          -- email de l'expéditeur (= son compte de connexion)
  sender_id       text,                           -- id interne du membre (pour la couleur/affichage)
  sender_name     text,                           -- prénom affiché
  recipient_email text,                           -- destinataire pour un 'dm' ; NULL pour 'team'
  body            text        not null
);

create index if not exists messages_conv_idx on public.messages (conversation, created_at);
create index if not exists messages_dm_idx   on public.messages (recipient_email, sender_email, created_at);

-- 2) Sécurité : Row Level Security activée
alter table public.messages enable row level security;

-- Lecture : le canal Équipe est visible par tous les comptes connectés ;
-- un message privé n'est visible QUE par ses deux participants.
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
  for select to authenticated
  using (
    conversation = 'team'
    or lower(auth.jwt() ->> 'email') = lower(sender_email)
    or lower(auth.jwt() ->> 'email') = lower(recipient_email)
  );

-- Écriture : on ne peut publier qu'en son propre nom (pas d'usurpation),
-- et un message privé doit avoir un destinataire.
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert to authenticated
  with check (
    lower(auth.jwt() ->> 'email') = lower(sender_email)
    and (conversation = 'team' or recipient_email is not null)
  );

-- (Pas de policy update/delete : les messages ne sont ni modifiables ni supprimables.
--  On pourra en ajouter plus tard si tu veux permettre l'effacement de ses propres messages.)

-- 3) Temps réel : diffuser les nouveaux messages instantanément
alter publication supabase_realtime add table public.messages;

-- ═══════════════════════════════════════════════════════════════════════════
-- Terminé. Recharge le CRM avec ?v=b25 au bout de l'URL et la bulle 💬
-- apparaît en bas à droite.
-- ═══════════════════════════════════════════════════════════════════════════
