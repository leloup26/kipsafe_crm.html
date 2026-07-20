// KIPSAFE CRM — Fonction sécurisée : définir/réinitialiser le mot de passe d'un membre.
// Déployée dans Supabase (Edge Functions). Elle SEULE détient la clé service ;
// le CRM ne la voit jamais. Elle vérifie que l'appelant est bien l'admin du CRM
// et que la cible est un membre connu, avant de créer/mettre à jour le compte.
//
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY sont fournis
// automatiquement par Supabase — rien à configurer.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);

  try {
    const URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // 1) Identifier l'appelant à partir de son jeton de session
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Non authentifié" }, 401);
    const asUser = createClient(URL, ANON, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: who, error: whoErr } = await asUser.auth.getUser();
    if (whoErr || !who?.user) return json({ error: "Session invalide" }, 401);
    const callerEmail = (who.user.email || "").toLowerCase();

    // 2) Client admin (clé service) — jamais exposé au navigateur
    const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

    // 3) Charger les membres du CRM, vérifier que l'appelant est admin
    const { data: row } = await admin
      .from("kipsafe_data").select("value").eq("key", "members").maybeSingle();
    const members: any[] = Array.isArray(row?.value) ? row!.value : [];
    const caller = members.find((m) => (m.email || "").toLowerCase() === callerEmail);
    if (!caller || caller.role !== "admin") {
      return json({ error: "Action réservée à l'administrateur du CRM" }, 403);
    }

    // 4) Valider la demande ; la cible DOIT être un membre connu
    const body = await req.json().catch(() => ({}));
    const email = String(body.email || "").toLowerCase().trim();
    const password = String(body.password || "");
    if (!email) return json({ error: "Email manquant" }, 400);
    if (password.length < 12) return json({ error: "Mot de passe : 12 caractères minimum" }, 400);
    const target = members.find((m) => (m.email || "").toLowerCase() === email);
    if (!target) return json({ error: "Cet email ne correspond à aucun membre du CRM" }, 400);

    // 5) Le compte existe-t-il déjà ? (recherche paginée par sécurité)
    let existing: any = null;
    for (let page = 1; page <= 20 && !existing; page++) {
      const { data: list, error: listErr } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (listErr) return json({ error: listErr.message }, 500);
      existing = (list?.users || []).find((u: any) => (u.email || "").toLowerCase() === email);
      if (!list || list.users.length < 200) break;
    }

    // 6) Créer ou mettre à jour, en confirmant l'email (connexion immédiate)
    if (existing) {
      const { error } = await admin.auth.admin.updateUserById(existing.id, {
        password, email_confirm: true,
      });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, action: "updated" });
    } else {
      const { error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
      });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, action: "created" });
    }
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
