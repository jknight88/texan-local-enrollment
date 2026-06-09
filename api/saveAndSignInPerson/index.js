// POST /api/saveAndSignInPerson
// In-person signing: saves form data + signed data in one shot, emails rep + client
const { BlobServiceClient } = require("@azure/storage-blob");
const crypto              = require("crypto");
const { v4: uuidv4 }      = require("uuid");
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

function row(label, val) {
  return `<tr><td style="padding:6px 10px;font-weight:700;color:#4a4f5e;background:#edf0f7;border:1px solid #c8cdd8;width:36%;">${label}</td><td style="padding:6px 10px;background:#fff;border:1px solid #c8cdd8;">${val||'&mdash;'}</td></tr>`;
}

function parsePayDetail(payMethod, payDetail) {
  if (!payDetail) return [];
  const parts = payDetail.split('|');
  if (payMethod && payMethod.includes('Credit Card')) {
    return [
      row('Card Type',       parts[0]||''),
      row('Card Number',     parts[1]||''),
      row('Name on Card',    parts[2]||''),
      row('Expiration',      parts[3]?parts[3].replace('Exp:',''):''),
      row('CVV',             parts[4]?parts[4].replace('CVV:',''):''),
      row('Billing Address', parts[5]?parts[5].replace('Billing:',''):'')
    ].join('');
  } else {
    return [
      row('Routing Number',  parts[0]?parts[0].replace('Routing:',''):''),
      row('Account Number',  parts[1]?parts[1].replace('Account:',''):''),
      row('Account Type',    parts[2]?parts[2].replace('Type:',''):''),
      row('Account Holder',  parts[3]?parts[3].replace('Holder:',''):'')
    ].join('');
  }
}

module.exports = async function(context, req) {
  if (req.method === "OPTIONS") { context.res={status:200}; return; }
  try {
    const body = req.body;
    if (!body || !body.formData) { context.res={status:400,body:{error:"Missing form data"}}; return; }

    const sessionId = uuidv4();
    const now       = new Date().toISOString();
    const fullIp    = (req.headers["x-forwarded-for"] || req.headers["client-ip"] || "unknown").split(",")[0].trim();
    const fd        = body.formData;

    // Build audit document
    const auditDoc = JSON.stringify({
      sessionId, bizName: fd.bizName, clientEmail: fd.clientEmail||'',
      signingMethod: "in-person",
      consentAt:   body.consentAt,
      consentText: "I agree to conduct this transaction using electronic records and signatures.",
      signedAt:    now,
      ipAddress:   fullIp,
      userAgent:   req.headers["user-agent"] || "unknown",
      payMethod:   body.payMethod,
      payDetail:   body.payDetail,
      subtotal:    body.subtotal,
      firstMonth:  body.firstMonth,
      monthly:     body.monthly,
      initials:    body.initials,
      sigName:     body.sigName,
      sigTitle:    body.sigTitle,
      formData:    fd
    });

    const auditHash = crypto.createHash("sha256").update(auditDoc).digest("hex");

    const auditTrail = [
      { event:"agreement_created",  timestamp:now, detail:"In-person enrollment — created and signed simultaneously" },
      { event:"consent_given",      timestamp:body.consentAt, ip:fullIp, detail:"Client provided electronic consent in person" },
      { event:"document_signed",    timestamp:now, ip:fullIp, detail:"Client signed in person on representative device" },
      { event:"audit_hash_created", timestamp:now, detail:"SHA-256: " + auditHash }
    ];

    const record = {
      sessionId,
      createdAt:   now,
      openedAt:    now,
      verifiedAt:  now,
      signedAt:    now,
      status:      "signed",
      signingMethod: "in-person",
      bizName:     fd.bizName,
      clientEmail: fd.clientEmail || '',
      repEmail:    REP_EMAIL,
      verified:    true,
      auditHash,
      auditTrail,
      formData:    fd,
      signed: {
        initials:    body.initials,
        payMethod:   body.payMethod,
        payDetail:   body.payDetail,
        subtotal:    body.subtotal,
        firstMonth:  body.firstMonth,
        monthly:     body.monthly,
        notes:       fd.notes || '',
        sigName:     body.sigName,
        sigTitle:    body.sigTitle,
        signedDate:  body.signedDate,
        consentAt:   body.consentAt,
        consentText: "I agree to conduct this transaction using electronic records and signatures.",
        ipAddress:   fullIp,
        userAgent:   req.headers["user-agent"] || "unknown",
        inPerson:    true
      }
    };

    // Save to blob storage
    const blobSvc   = BlobServiceClient.fromConnectionString(STORAGE_CONN);
    const container = blobSvc.getContainerClient(CONTAINER);
    await container.createIfNotExists();
    const blob      = container.getBlockBlobClient(`${sessionId}.json`);
    const updated   = JSON.stringify(record);
    await blob.upload(updated, Buffer.byteLength(updated), { blobHTTPHeaders:{blobContentType:"application/json"} });

    // Save audit log
    const auditBlob = container.getBlockBlobClient(`${sessionId}_audit.json`);
    const auditRec  = JSON.stringify({ sessionId, auditHash, auditTrail, auditDoc, createdAt:now });
    await auditBlob.upload(auditRec, Buffer.byteLength(auditRec), { blobHTTPHeaders:{blobContentType:"application/json"} });

    const token = await getGraphToken();
    const payRows = parsePayDetail(body.payMethod, body.payDetail);

    // Email to rep
    const repHtml = `
<div style="font-family:Arial,sans-serif;max-width:640px;color:#1a1a2e;">
  <div style="background:#00205B;padding:18px 24px;border-bottom:4px solid #BF0D3E;">
    <div style="font-size:20px;font-weight:700;color:#fff;font-family:'Georgia',serif;">The Texan Local</div>
    <div style="font-size:11px;color:rgba(255,255,255,.65);margin-top:2px;">&#10003; In-Person Enrollment — Signed &amp; Complete</div>
  </div>
  <div style="padding:24px;background:#f5f7fa;">
    <div style="background:#1a5c1a;color:#fff;padding:12px 16px;border-radius:5px;font-size:14px;font-weight:700;margin-bottom:20px;">
      &#10003; IN-PERSON: ${fd.bizName} signed their enrollment agreement.
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px;">
      <tr><td colspan="2" style="background:#00205B;color:#fff;padding:7px 10px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Client Details</td></tr>
      ${row("Business", fd.bizName)}
      ${row("Signing Method", "In-Person")}
      ${row("Contact", fd.contact||'')}
      ${row("Phone", fd.phone||'')}
      ${row("Email", fd.clientEmail||'')}
      ${row("Address", [fd.addr,fd.city,fd.state,fd.zip].filter(Boolean).join(', '))}
      ${row("Signed By", body.sigName + (body.sigTitle ? ', '+body.sigTitle : ''))}
      ${row("Signed", new Date(now).toLocaleString("en-US",{timeZone:"America/Chicago"}))}
      ${row("IP Address", fullIp)}
    </table>
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px;">
      <tr><td colspan="2" style="background:#00205B;color:#fff;padding:7px 10px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Agreement Details</td></tr>
      ${row("Term", fd.term||'')}
      ${row("Subtotal", body.subtotal)}
      ${row("First Month", body.firstMonth)}
      ${row("Monthly Charge", body.monthly)}
      ${row("Initials", body.initials)}
      ${row("Notes", fd.notes||'')}
    </table>
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px;">
      <tr><td colspan="2" style="background:#BF0D3E;color:#fff;padding:7px 10px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Payment Information — CONFIDENTIAL</td></tr>
      ${row("Payment Method", body.payMethod)}
      ${payRows}
    </table>
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px;">
      <tr><td colspan="2" style="background:#1a5c1a;color:#fff;padding:7px 10px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">ESIGN Compliance</td></tr>
      ${row("Consent Given", new Date(body.consentAt).toLocaleString("en-US",{timeZone:"America/Chicago"}))}
      ${row("Consent Text", "I agree to conduct this transaction using electronic records and signatures.")}
      ${row("SHA-256 Audit Hash", `<span style="font-family:monospace;font-size:10px;word-break:break-all;">${auditHash}</span>`)}
    </table>
    <div style="text-align:center;"><a href="${BASE_URL}/dashboard" style="background:#00205B;color:#fff;padding:11px 24px;border-radius:4px;text-decoration:none;font-size:13px;font-weight:700;display:inline-block;">View Dashboard</a></div>
  </div>
</div>`;

    await fetch(`https://graph.microsoft.com/v1.0/users/${REP_EMAIL}/sendMail`, {
      method:"POST",
      headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},
      body: JSON.stringify({
        message:{
          subject:`\u2713 IN-PERSON SIGNED: Texan Local Enrollment \u2014 ${fd.bizName}`,
          body:{contentType:"HTML",content:repHtml},
          toRecipients:[{emailAddress:{address:REP_EMAIL}}]
        },
        saveToSentItems:true
      })
    });

    // Email copy to client if they have an email
    if (fd.clientEmail) {
      const clientHtml = `
<div style="font-family:Arial,sans-serif;max-width:600px;color:#1a1a2e;">
  <div style="background:#00205B;padding:18px 24px;border-bottom:4px solid #BF0D3E;">
    <div style="font-size:20px;font-weight:700;color:#fff;font-family:'Georgia',serif;">The Texan Local</div>
    <div style="font-size:11px;color:rgba(255,255,255,.65);margin-top:2px;">Your Advertising Enrollment — Confirmation</div>
  </div>
  <div style="padding:24px;background:#f5f7fa;">
    <h2 style="font-size:17px;color:#00205B;margin:0 0 14px;">&#10003; Thank you, ${fd.bizName}!</h2>
    <p style="font-size:13px;line-height:1.6;color:#333;margin:0 0 16px;">
      Your Texan Local Advertising Enrollment Agreement has been signed and is now on file.
      A representative will be in touch soon regarding your first publication.
    </p>
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px;">
      ${row("Business", fd.bizName)}
      ${row("Term", fd.term||'')}
      ${row("First Month Payment", body.firstMonth)}
      ${row("Monthly Charge", body.monthly)}
      ${row("Signed By", body.sigName)}
      ${row("Date", body.signedDate)}
    </table>
    <p style="font-size:11px;color:#888;margin-top:16px;padding-top:12px;border-top:1px solid #dde2ef;">
      Questions? Contact us at <a href="mailto:${REP_EMAIL}" style="color:#00205B;">${REP_EMAIL}</a>
    </p>
  </div>
</div>`;

      await fetch(`https://graph.microsoft.com/v1.0/users/${REP_EMAIL}/sendMail`, {
        method:"POST",
        headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},
        body: JSON.stringify({
          message:{
            subject:`Your Texan Local Enrollment Agreement — ${fd.bizName}`,
            body:{contentType:"HTML",content:clientHtml},
            toRecipients:[{emailAddress:{address:fd.clientEmail}}]
          },
          saveToSentItems:true
        })
      });
    }

    context.res = { status:200, body:{ ok:true, sessionId, auditHash } };
  } catch (err) {
    context.log.error("saveAndSignInPerson error:", err);
    context.res = { status:500, body:{ error:err.message } };
  }
};
