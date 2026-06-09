// POST /api/submitSigned
// Full ESIGN/UETA compliant: IP, consent timestamp, SHA-256 audit hash, tamper-evident log
const { BlobServiceClient } = require("@azure/storage-blob");
const crypto              = require("crypto");
const STORAGE_CONN        = process.env.AZURE_STORAGE_CONNECTION_STRING;
const CONTAINER           = "enrollments";
const GRAPH_TOKEN_URL     = `https://login.microsoftonline.com/${process.env.TENANT_ID}/oauth2/v2.0/token`;
const CLIENT_ID           = process.env.GRAPH_CLIENT_ID;
const CLIENT_SECRET       = process.env.GRAPH_CLIENT_SECRET;
const REP_EMAIL           = process.env.REP_EMAIL || "josh@thetexanlocal.com";
const BASE_URL            = process.env.BASE_URL  || "https://enrollment.thetexanlocal.com";

async function getGraphToken() {
  const p = new URLSearchParams({ grant_type:"client_credentials", client_id:CLIENT_ID, client_secret:CLIENT_SECRET, scope:"https://graph.microsoft.com/.default" });
  const r = await fetch(GRAPH_TOKEN_URL, { method:"POST", headers:{"Content-Type":"application/x-www-form-urlencoded"}, body:p.toString() });
  const d = await r.json(); if (!d.access_token) throw new Error("Token error"); return d.access_token;
}
function row(label,val){ return `<tr><td style="padding:6px 10px;font-weight:700;color:#4a4f5e;background:#edf0f7;border:1px solid #c8cdd8;width:36%;">${label}</td><td style="padding:6px 10px;background:#fff;border:1px solid #c8cdd8;">${val||'&mdash;'}</td></tr>`; }

module.exports = async function(context, req) {
  if (req.method === "OPTIONS") { context.res={status:200}; return; }
  try {
    const body = req.body;
    if (!body || !body.sessionId) { context.res={status:400,body:{error:"Missing sessionId"}}; return; }

    // ── Load record ───────────────────────────────────────────────────
    const blobSvc   = BlobServiceClient.fromConnectionString(STORAGE_CONN);
    const container = blobSvc.getContainerClient(CONTAINER);
    const blob      = container.getBlockBlobClient(`${body.sessionId}.json`);
    const dl        = await blob.downloadToBuffer();
    const record    = JSON.parse(dl.toString());

    // ── Verify email was confirmed ────────────────────────────────────
    if (!record.verified) {
      context.res = { status: 403, body: { error: "Email not verified. Please complete email verification before signing." } };
      return;
    }

    // ── Capture full IP (ESIGN compliance) ────────────────────────────
    const fullIp = (req.headers["x-forwarded-for"] || req.headers["client-ip"] || "unknown").split(",")[0].trim();

    // ── Build audit document string for hashing ───────────────────────
    // This is the canonical record of everything that was agreed to
    const signedAt  = new Date().toISOString();
    const auditDoc  = JSON.stringify({
      sessionId:   body.sessionId,
      bizName:     record.bizName,
      clientEmail: record.clientEmail,
      verifiedAt:  record.verifiedAt,
      consentAt:   body.consentAt,      // timestamp when consent box was checked
      consentText: "I agree to conduct this transaction using electronic records and signatures.",
      signedAt,
      ipAddress:   fullIp,
      userAgent:   req.headers["user-agent"] || "unknown",
      payMethod:   body.payMethod,
      payDetail:   body.payDetail,
      subtotal:    body.subtotal,
      firstMonth:  body.firstMonth,
      monthly:     body.monthly,
      initials:    body.initials,
      notes:       body.notes,
      formData:    record.formData
    });

    // ── SHA-256 hash of full audit document (tamper-evident) ──────────
    const auditHash = crypto.createHash("sha256").update(auditDoc).digest("hex");

    // ── Build audit trail log entries ─────────────────────────────────
    const auditTrail = [
      { event: "agreement_created",  timestamp: record.createdAt,    ip: "rep",       detail: "Agreement created and sent by representative" },
      { event: "email_opened",       timestamp: record.openedAt||"", ip: "unknown",   detail: "Client opened signing link" },
      { event: "email_verified",     timestamp: record.verifiedAt,   ip: fullIp,      detail: "Client verified email with 6-digit code" },
      { event: "consent_given",      timestamp: body.consentAt,      ip: fullIp,      detail: "Client checked electronic consent agreement" },
      { event: "document_signed",    timestamp: signedAt,            ip: fullIp,      detail: "Client completed all initials and signature" },
      { event: "audit_hash_created", timestamp: signedAt,            ip: "server",    detail: "SHA-256 audit hash generated: " + auditHash }
    ];

    // ── Update record ─────────────────────────────────────────────────
    record.status     = "signed";
    record.signedAt   = signedAt;
    record.auditHash  = auditHash;
    record.auditTrail = auditTrail;
    record.signed = {
      initials:    body.initials,
      payMethod:   body.payMethod,
      payDetail:   body.payDetail,
      subtotal:    body.subtotal,
      firstMonth:  body.firstMonth,
      monthly:     body.monthly,
      notes:       body.notes,
      signedDate:  body.signedDate,
      consentAt:   body.consentAt,
      consentText: "I agree to conduct this transaction using electronic records and signatures.",
      ipAddress:   fullIp,
      userAgent:   req.headers["user-agent"] || "unknown"
    };

    // Save main record
    const updated = JSON.stringify(record);
    await blob.upload(updated, Buffer.byteLength(updated), { blobHTTPHeaders:{blobContentType:"application/json"} });

    // Save separate immutable audit log
    const auditBlob = container.getBlockBlobClient(`${body.sessionId}_audit.json`);
    const auditRecord = JSON.stringify({ sessionId: body.sessionId, auditHash, auditTrail, auditDoc, createdAt: signedAt });
    await auditBlob.upload(auditRecord, Buffer.byteLength(auditRecord), { blobHTTPHeaders:{blobContentType:"application/json"} });

    // ── Send rep email ────────────────────────────────────────────────
    const token = await getGraphToken();
    const d = record, s = record.signed;
    const emailHtml = `
<div style="font-family:Arial,sans-serif;max-width:640px;color:#1a1a2e;">
  <div style="background:#00205B;padding:18px 24px;border-bottom:4px solid #BF0D3E;">
    <div style="font-size:20px;font-weight:700;color:#fff;font-family:'Georgia',serif;">The Texan Local</div>
    <div style="font-size:11px;color:rgba(255,255,255,.65);margin-top:2px;">&#10003; Enrollment Agreement — Signed &amp; ESIGN Compliant</div>
  </div>
  <div style="padding:24px;background:#f5f7fa;">
    <div style="background:#1a5c1a;color:#fff;padding:12px 16px;border-radius:5px;font-size:14px;font-weight:700;margin-bottom:20px;">
      &#10003; ${d.bizName} has completed and signed their enrollment agreement.
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px;">
      <tr><td colspan="2" style="background:#00205B;color:#fff;padding:7px 10px;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Client Details</td></tr>
      ${row("Business", d.bizName)}
      ${row("Client Email", d.clientEmail)}
      ${row("Sent", new Date(d.createdAt).toLocaleString("en-US",{timeZone:"America/Chicago"}))}
      ${row("Email Verified", new Date(d.verifiedAt).toLocaleString("en-US",{timeZone:"America/Chicago"}))}
      ${row("Signed", new Date(d.signedAt).toLocaleString("en-US",{timeZone:"America/Chicago"}))}
      ${row("IP Address", s.ipAddress)}
      ${row("Device/Browser", s.userAgent)}
    </table>
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px;">
      <tr><td colspan="2" style="background:#00205B;color:#fff;padding:7px 10px;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Agreement Details</td></tr>
      ${row("Term", (d.formData&&d.formData.term)||"")}
      ${row("Payment Method", s.payMethod)}
      ${row("Payment Detail", s.payDetail + " <em style='color:#888;font-size:11px;'>(masked)</em>")}
      ${row("Subtotal", s.subtotal)}
      ${row("First Month", s.firstMonth)}
      ${row("Monthly Charge", s.monthly)}
      ${row("Initials Provided", s.initials)}
      ${row("Notes", s.notes)}
    </table>
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px;">
      <tr><td colspan="2" style="background:#1a5c1a;color:#fff;padding:7px 10px;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">ESIGN Compliance Audit Trail</td></tr>
      ${row("Electronic Consent", "&#10003; Agreed at " + new Date(s.consentAt).toLocaleString("en-US",{timeZone:"America/Chicago"}))}
      ${row("Consent Text", s.consentText)}
      ${row("Email Verified", "&#10003; " + new Date(d.verifiedAt).toLocaleString("en-US",{timeZone:"America/Chicago"}))}
      ${row("SHA-256 Audit Hash", `<span style="font-family:monospace;font-size:10px;word-break:break-all;">${auditHash}</span>`)}
    </table>
    <div style="background:#fff3cd;border:1px solid #ffc107;border-radius:4px;padding:10px 14px;font-size:11px;color:#555;margin-bottom:16px;">
      <strong>Legal Note:</strong> This agreement was executed under the federal ESIGN Act and UETA. The SHA-256 hash above is a cryptographic fingerprint of the complete signed record. The full audit log is stored separately and available on request.
    </div>
    <div style="text-align:center;">
      <a href="${BASE_URL}/dashboard" style="background:#00205B;color:#fff;padding:11px 24px;border-radius:4px;text-decoration:none;font-size:13px;font-weight:700;display:inline-block;">View Dashboard</a>
    </div>
  </div>
</div>`;

    await fetch(`https://graph.microsoft.com/v1.0/users/${REP_EMAIL}/sendMail`, {
      method:"POST",
      headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},
      body: JSON.stringify({
        message:{
          subject:`✓ SIGNED (ESIGN Compliant): Texan Local Enrollment — ${d.bizName}`,
          body:{contentType:"HTML",content:emailHtml},
          toRecipients:[{emailAddress:{address:REP_EMAIL}}],
          replyTo:[{emailAddress:{address:d.clientEmail}}]
        },
        saveToSentItems:true
      })
    });

    context.res = { status:200, body:{ ok:true, auditHash } };
  } catch (err) {
    context.log.error("submitSigned error:", err);
    context.res = { status:500, body:{ error:err.message } };
  }
};
