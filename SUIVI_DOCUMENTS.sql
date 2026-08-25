-- ═══════════════════════════════════════════════════════════════════
-- KIPSAFE CRM — SUIVI DOCUMENTS PROSPECTS
-- À exécuter UNE FOIS dans Supabase → SQL Editor (projet graujqkrxxceskgnqfin)
-- Crée les tables du suivi : liens personnels envoyés aux prospects
-- + historique de chaque ouverture.
-- ═══════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- Un lien = un document envoyé à UN prospect (token personnel dans l'URL)
create table if not exists public.doc_links (
  id uuid primary key default gen_random_uuid(),
  token text unique not null,
  doc_path text not null,               -- chemin dans le bucket Kipsafe-Doc (ex: docs/171234_1_plaquette.pdf)
  doc_name text not null,               -- nom d'affichage (nom d'origine du fichier)
  prospect_name text not null default '',
  prospect_email text not null,
  message text default '',              -- message personnel inséré dans l'email
  created_by text,                      -- email du membre qui a envoyé
  created_at timestamptz not null default now(),
  sent_at timestamptz,                  -- date d'envoi effectif de l'email
  send_error text,                      -- erreur SMTP éventuelle (lien utilisable manuellement)
  open_count integer not null default 0,
  last_open_at timestamptz,
  active boolean not null default true  -- false = lien désactivé
);

-- Historique : une ligne par ouverture
create table if not exists public.doc_link_opens (
  id bigint generated always as identity primary key,
  link_id uuid not null references public.doc_links(id) on delete cascade,
  opened_at timestamptz not null default now(),
  user_agent text
);

alter table public.doc_links enable row level security;
alter table public.doc_link_opens enable row level security;

-- L'équipe connectée gère les liens ; les prospects n'accèdent JAMAIS à ces
-- tables directement : l'ouverture passe par l'Edge Function doc-open
-- (clé service, côté serveur uniquement).
drop policy if exists "team all doc_links" on public.doc_links;
create policy "team all doc_links" on public.doc_links
  for all to authenticated using (true) with check (true);

drop policy if exists "team read doc_link_opens" on public.doc_link_opens;
create policy "team read doc_link_opens" on public.doc_link_opens
  for select to authenticated using (true);

-- Realtime : le CRM affiche « 📬 X vient d'ouvrir… » en direct
alter publication supabase_realtime add table public.doc_links;
alter table public.doc_links replica identity full;
