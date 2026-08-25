// KIPSAFE CRM — doc-open : appelée par la page publique doc.html quand un
// prospect ouvre son lien personnel.
// COPIE DE RÉFÉRENCE — la version active est déployée dans Supabase (Edge Functions → doc-open).
//   1. vérifie le token, 2. compte l'ouverture, 3. notifie l'équipe par email,
//   4. renvoie une URL signée temporaire (1h) vers le document.
//
// ⚠️ Cette fonction est PUBLIQUE (le prospect n'a pas de compte) :
// dans Supabase → Edge Functions → doc-open → Settings, DÉSACTIVER
// « Verify JWT with legacy secret ».
// La sécurité repose sur le token imprévisible (40 caractères aléatoires).
//
// Secrets utilisés (les mêmes que doc-send) :
//   SMTP_USER / SMTP_PASS — obligatoires pour la notification email
//   NOTIFY_TO (déf. SMTP_USER) — destinataire des notifications d'ouverture

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

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

function escHtml(s: string) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function sendMail(to: string, subject: string, html: string) {
  const user = Deno.env.get("SMTP_USER") || "";
  const pass = Deno.env.get("SMTP_PASS") || "";
  if (!user || !pass) throw new Error("SMTP non configuré");
  const client = new SMTPClient({
    connection: {
      hostname: Deno.env.get("SMTP_HOST") || "smtp.office365.com",
      port: Number(Deno.env.get("SMTP_PORT") || 587),
      tls: false,
      auth: { username: user, password: pass },
    },
  });
  try {
    await client.send({
      from: `${Deno.env.get("SMTP_FROM_NAME") || "KIPSAFE CRM"} <${user}>`,
      to,
      subject,
      html,
      content: "auto",
    });
  } finally {
    try { await client.close(); } catch (_) { /* déjà fermée */ }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);

  try {
    const URL_ = Deno.env.get("SUPABASE_URL")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });

    const body = await req.json().catch(() => ({}));
    const token = String(body.token || "").trim();
    if (!/^[a-zA-Z0-9-]{20,80}$/.test(token)) return json({ error: "Lien invalide" }, 400);

    // 1) Retrouver le lien
    const { data: link } = await admin.from("doc_links")
      .select("*").eq("token", token).eq("active", true).maybeSingle();
    if (!link) return json({ error: "Lien invalide ou désactivé" }, 404);

    // 2) Compter l'ouverture
    const newCount = (link.open_count || 0) + 1;
    const nowIso = new Date().toISOString();
    await admin.from("doc_links")
      .update({ open_count: newCount, last_open_at: nowIso }).eq("id", link.id);
    const ua = (req.headers.get("user-agent") || "").slice(0, 300);
    await admin.from("doc_link_opens").insert({ link_id: link.id, user_agent: ua });

    // 3) URL signée temporaire vers le document (bucket privé)
    const { data: signed, error: signErr } = await admin.storage
      .from("Kipsafe-Doc").createSignedUrl(link.doc_path, 3600);
    if (signErr || !signed?.signedUrl) {
      return json({ error: "Document introuvable (a-t-il été supprimé ?)" }, 404);
    }

    // 4) Notification email à l'équipe — en tâche de fond pour ne pas
    //    ralentir l'affichage chez le prospect
    const who = link.prospect_name || link.prospect_email || "Un prospect";
    const notifTo = Deno.env.get("NOTIFY_TO") || Deno.env.get("SMTP_USER") || "";
    const fois = newCount === 1 ? "1re ouverture" : newCount + "e ouverture";
    const notifHtml = `
<div style="font-family:Segoe UI,Arial,sans-serif;font-size:15px;color:#333;line-height:1.6">
  <p>📬 <strong>${escHtml(who)}</strong> vient d'ouvrir le document
  <strong>« ${escHtml(link.doc_name)} »</strong>.</p>
  <ul style="color:#555">
    <li>Ouvertures : <strong>${newCount}</strong> (${fois})</li>
    <li>Email du prospect : ${escHtml(link.prospect_email || "—")}</li>
    <li>Envoyé le : ${link.sent_at ? new Date(link.sent_at).toLocaleString("fr-FR", { timeZone: "Europe/Paris" }) : "—"}</li>
  </ul>
  ${newCount >= 2 ? '<p style="color:#166534"><strong>🔥 Ouvertures répétées — prospect chaud, pensez à le relancer.</strong></p>' : ""}
  <p style="color:#8a94a6;font-size:12px">Détail dans le CRM → Documents → 📤 Envois prospects.</p>
</div>`;
    const notify = (async () => {
      if (!notifTo) return;
      try {
        await sendMail(notifTo, `📬 ${who} a ouvert « ${link.doc_name} » (${fois})`, notifHtml);
      } catch (_) { /* la notification ne doit jamais bloquer le prospect */ }
    })();
    try {
      // @ts-ignore — dispo dans le runtime Supabase Edge
      EdgeRuntime.waitUntil(notify);
    } catch (_) {
      await notify;
    }

    // 5) Réponse à la page prospect
    return json({ ok: true, doc_name: link.doc_name, url: signed.signedUrl });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
