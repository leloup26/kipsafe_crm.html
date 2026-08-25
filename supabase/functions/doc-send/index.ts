// KIPSAFE CRM — doc-send : crée un lien de suivi personnel pour un prospect
// et lui envoie l'email avec ce lien, depuis la boîte Microsoft 365 (SMTP).
// COPIE DE RÉFÉRENCE — la version active est déployée dans Supabase (Edge Functions → doc-send).
//
// Secrets à définir (Edge Functions → Secrets) :
//   SMTP_USER  = sgalin@kipsafe.fr        (identifiant + expéditeur)
//   SMTP_PASS  = mot de passe (mot de passe d'application si MFA)
// Optionnels :
//   SMTP_HOST (déf. smtp.office365.com), SMTP_PORT (déf. 587),
//   SMTP_FROM_NAME (déf. KIPSAFE), DOC_PAGE_URL (déf. page GitHub Pages)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_DOC_PAGE = "https://leloup26.github.io/kipsafe_crm.html/doc.html";

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
  if (!user || !pass) throw new Error("Secrets SMTP_USER / SMTP_PASS non configurés dans Supabase");
  const client = new SMTPClient({
    connection: {
      hostname: Deno.env.get("SMTP_HOST") || "smtp.office365.com",
      port: Number(Deno.env.get("SMTP_PORT") || 587),
      tls: false, // 587 = STARTTLS (négocié automatiquement)
      auth: { username: user, password: pass },
    },
  });
  try {
    await client.send({
      from: `${Deno.env.get("SMTP_FROM_NAME") || "KIPSAFE"} <${user}>`,
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
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // 1) Identifier l'appelant (doit être connecté au CRM)
    const tokenAuth = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!tokenAuth) return json({ error: "Non authentifié" }, 401);
    const asUser = createClient(URL_, ANON, {
      global: { headers: { Authorization: `Bearer ${tokenAuth}` } },
    });
    const { data: who, error: whoErr } = await asUser.auth.getUser();
    if (whoErr || !who?.user) return json({ error: "Session invalide" }, 401);
    const callerEmail = (who.user.email || "").toLowerCase();

    const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });

    // 2) L'appelant doit être un membre connu du CRM
    const { data: row } = await admin
      .from("kipsafe_data").select("value").eq("key", "members").maybeSingle();
    const members: any[] = Array.isArray(row?.value) ? row!.value : [];
    const caller = members.find((m) => (m.email || "").toLowerCase() === callerEmail);
    if (!caller) return json({ error: "Compte non reconnu comme membre du CRM" }, 403);

    // 3) Valider la demande
    const body = await req.json().catch(() => ({}));
    const docPath = String(body.doc_path || "");
    const docName = String(body.doc_name || "").slice(0, 200);
    const prospectName = String(body.prospect_name || "").slice(0, 120).trim();
    const prospectEmail = String(body.prospect_email || "").toLowerCase().trim();
    const message = String(body.message || "").slice(0, 2000).trim();
    if (!/^docs\/[a-zA-Z0-9._-]+$/.test(docPath)) return json({ error: "Chemin de document invalide" }, 400);
    if (!docName) return json({ error: "Nom de document manquant" }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(prospectEmail)) return json({ error: "Email du prospect invalide" }, 400);

    // 4) Créer le lien (token personnel imprévisible)
    const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().slice(0, 8);
    const { data: link, error: insErr } = await admin.from("doc_links").insert({
      token,
      doc_path: docPath,
      doc_name: docName,
      prospect_name: prospectName,
      prospect_email: prospectEmail,
      message,
      created_by: callerEmail,
    }).select().single();
    if (insErr) return json({ error: "Création du lien impossible : " + insErr.message + " (SUIVI_DOCUMENTS.sql exécuté ?)" }, 500);

    const pageUrl = (Deno.env.get("DOC_PAGE_URL") || DEFAULT_DOC_PAGE) + "?t=" + token;

    // 5) Envoyer l'email au prospect
    const msgHtml = message
      ? `<p style="margin:0 0 18px;color:#333;font-size:15px;line-height:1.6;white-space:pre-line">${escHtml(message)}</p>`
      : "";
    const html = `
<div style="background:#f4f6fa;padding:32px 12px;font-family:Segoe UI,Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
    <div style="background:#1f3864;padding:18px 28px">
      <span style="color:#fff;font-size:18px;font-weight:700;letter-spacing:1px">KIPSAFE</span>
      <span style="color:#9db2d0;font-size:12px;margin-left:8px">Cybersécurité</span>
    </div>
    <div style="padding:28px">
      <p style="margin:0 0 18px;color:#333;font-size:15px;line-height:1.6">Bonjour${prospectName ? " " + escHtml(prospectName) : ""},</p>
      ${msgHtml}
      <p style="margin:0 0 22px;color:#333;font-size:15px;line-height:1.6">Voici votre document&nbsp;: <strong>${escHtml(docName)}</strong></p>
      <div style="text-align:center;margin:0 0 24px">
        <a href="${pageUrl}" style="background:#1f3864;color:#fff;text-decoration:none;padding:13px 30px;border-radius:8px;font-size:15px;font-weight:700;display:inline-block">📄 Consulter le document</a>
      </div>
      <p style="margin:0;color:#8a94a6;font-size:12px;line-height:1.5">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur&nbsp;:<br><a href="${pageUrl}" style="color:#2a5aa0;word-break:break-all">${pageUrl}</a></p>
    </div>
    <div style="padding:14px 28px;background:#f8fafc;border-top:1px solid #e2e8f0;color:#8a94a6;font-size:12px">
      KIPSAFE — Conseil en cybersécurité · <a href="https://kipsafe.fr" style="color:#2a5aa0">kipsafe.fr</a>
    </div>
  </div>
</div>`;

    let emailSent = true;
    let emailError = "";
    try {
      await sendMail(prospectEmail, "Votre document : " + docName, html);
      await admin.from("doc_links").update({ sent_at: new Date().toISOString() }).eq("id", link.id);
    } catch (e) {
      emailSent = false;
      emailError = String((e as Error)?.message || e);
      await admin.from("doc_links").update({ send_error: emailError }).eq("id", link.id);
    }

    return json({ ok: true, token, link: pageUrl, email_sent: emailSent, email_error: emailError || undefined });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
