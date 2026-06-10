// GET /api/getPdf?id=SESSION_ID&key=DASHBOARD_KEY
// Returns a printable HTML document for the signed enrollment
const { BlobServiceClient } = require("@azure/storage-blob");
const STORAGE_CONN  = process.env.AZURE_STORAGE_CONNECTION_STRING;
const CONTAINER     = "enrollments";
const DASHBOARD_KEY = process.env.DASHBOARD_KEY || "changeme";

function row(label, val) {
  return `<tr>
    <td style="padding:6pt 8pt;font-weight:700;color:#4a4f5e;background:#edf0f7;border:1pt solid #c8cdd8;width:35%;font-size:9pt;">${label}</td>
    <td style="padding:6pt 8pt;background:#fff;border:1pt solid #c8cdd8;font-size:9pt;">${val||'&mdash;'}</td>
  </tr>`;
}

function parsePayRows(payMethod, payDetail) {
  if (!payDetail) return '';
  const parts = payDetail.split('|');
  if (payMethod && payMethod.includes('Credit Card')) {
    return row('Card Type', parts[0]||'')
         + row('Card Number', parts[1]||'')
         + row('Name on Card', parts[2]||'')
         + row('Expiration', parts[3]?parts[3].replace('Exp:',''):'')
         + row('CVV', parts[4]?parts[4].replace('CVV:',''):'')
         + row('Billing Address', parts[5]?parts[5].replace('Billing:',''):'');
  } else {
    return row('Routing Number', parts[0]?parts[0].replace('Routing:',''):'')
         + row('Account Number', parts[1]?parts[1].replace('Account:',''):'')
         + row('Account Type',   parts[2]?parts[2].replace('Type:',''):'')
         + row('Account Holder', parts[3]?parts[3].replace('Holder:',''):'');
  }
}

module.exports = async function(context, req) {
  if (req.method === "OPTIONS") { context.res={status:200}; return; }

  // Auth check
  if (req.query.key !== DASHBOARD_KEY) {
    context.res = { status:401, body:"Unauthorized" }; return;
  }

  const id = req.query.id;
  if (!id) { context.res = { status:400, body:"Missing id" }; return; }

  try {
    const blobSvc   = BlobServiceClient.fromConnectionString(STORAGE_CONN);
    const container = blobSvc.getContainerClient(CONTAINER);
    const blob      = container.getBlockBlobClient(`${id}.json`);
    const dl        = await blob.downloadToBuffer();
    const record    = JSON.parse(dl.toString());

    if (record.status !== 'signed') {
      context.res = { status:400, body:"Agreement not yet signed." }; return;
    }

    const d  = record;
    const s  = record.signed;
    const fd = record.formData || {};

    const signedDateFmt = new Date(d.signedAt).toLocaleString("en-US", {
      timeZone:"America/Chicago", dateStyle:"full", timeStyle:"short"
    });

    const payRows = parsePayRows(s.payMethod, s.payDetail);

    // Build zone table rows from formData
    let zoneRows = '';
    if (fd.zones && fd.zones.length > 0) {
      fd.zones.forEach(z => {
        zoneRows += `<tr><td style="padding:3pt 6pt;border:1pt solid #c8cdd8;font-size:8pt;">${z.id||''}</td><td style="padding:3pt 6pt;border:1pt solid #c8cdd8;font-size:8pt;text-align:right;">$${z.rate||'0.00'}/mo</td></tr>`;
      });
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Enrollment Agreement - ${d.bizName}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Source+Sans+3:wght@300;400;600;700&display=swap');
  *{ box-sizing:border-box; margin:0; padding:0; }
  body{ font-family:'Source Sans 3',Arial,sans-serif; color:#1a1a2e; font-size:10pt; background:#fff; }
  @page{ margin:0.5in; size:letter portrait; }
  @media screen{ body{ max-width:780px; margin:0 auto; padding:20px; } }
  .page{ page-break-after:always; }
  .page:last-child{ page-break-after:avoid; }
  .hdr{ background:#00205B; padding:10pt 16pt; border-bottom:4pt solid #BF0D3E; display:flex; align-items:center; justify-content:space-between; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .hdr-title{ color:#fff; font-family:'Playfair Display',serif; font-size:13pt; }
  .hdr-sub{ color:rgba(255,255,255,.7); font-size:8pt; margin-top:2pt; }
  .hdr-right{ text-align:right; }
  .section{ padding:8pt 14pt; border-bottom:1pt solid #dde2ef; }
  .section-title{ background:#00205B; color:#fff; font-size:7.5pt; font-weight:700; letter-spacing:1pt; text-transform:uppercase; padding:3pt 14pt; margin:0 -14pt 7pt; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .grid2{ display:grid; grid-template-columns:1fr 1fr; gap:6pt; }
  .field label{ display:block; font-size:7.5pt; font-weight:700; color:#4a4f5e; text-transform:uppercase; letter-spacing:.4pt; margin-bottom:1pt; }
  .field .val{ font-size:10pt; border-bottom:1pt solid #c8cdd8; padding:2pt 0; min-height:14pt; }
  table.info{ width:100%; border-collapse:collapse; margin-bottom:8pt; }
  table.zones{ width:100%; border-collapse:collapse; font-size:8.5pt; margin-bottom:6pt; }
  table.zones th{ background:#00205B; color:#fff; padding:4pt 6pt; text-align:left; font-size:7.5pt; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .totals-box{ border:1.5pt solid #00205B; border-radius:3pt; overflow:hidden; margin:6pt 0; }
  .total-row{ display:flex; justify-content:space-between; padding:5pt 10pt; border-bottom:1pt solid #dde2ef; font-size:10pt; }
  .total-row:last-child{ border-bottom:none; }
  .total-row.blue{ background:#00205B; color:#fff; font-weight:700; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .total-row.pink{ background:#fef0f4; font-weight:700; }
  .sig-grid{ display:grid; grid-template-columns:1fr 1fr; gap:16pt; padding:8pt 14pt; }
  .sig-block label{ font-size:7.5pt; font-weight:700; color:#4a4f5e; text-transform:uppercase; letter-spacing:.4pt; display:block; margin-bottom:4pt; }
  .sig-line{ border-bottom:1.5pt solid #1a1a2e; height:32pt; margin-bottom:3pt; }
  .sig-sub{ font-size:8pt; color:#4a4f5e; }
  .ftr{ background:#00205B; border-top:3pt solid #BF0D3E; padding:5pt 14pt; display:flex; justify-content:space-between; align-items:center; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .ftr span{ color:rgba(255,255,255,.65); font-size:7.5pt; }
  .confidential{ background:#BF0D3E; color:#fff; padding:5pt 10pt; font-size:7.5pt; font-weight:700; text-transform:uppercase; letter-spacing:.5pt; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .esign-bar{ background:#1a5c1a; color:#fff; padding:5pt 10pt; font-size:7.5pt; font-weight:700; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .print-btn{ position:fixed; top:16px; right:16px; background:#00205B; color:#fff; border:none; padding:10px 20px; border-radius:4px; font-size:13px; font-weight:700; cursor:pointer; font-family:inherit; z-index:999; }
  @media print{ .print-btn{ display:none; } }
</style>
</head>
<body>
<button class="print-btn" onclick="window.print()">&#128438; Print / Save PDF</button>

<!-- ══ PAGE 1 ══ -->
<div class="page">
  <div class="hdr">
    <div>
      <div class="hdr-title">The Texan Local</div>
      <div class="hdr-sub">A Knight Dynamic Solutions, LLC Company</div>
    </div>
    <div class="hdr-right">
      <div style="color:#fff;font-size:11pt;font-weight:700;">Advertising Enrollment Agreement</div>
      <div class="hdr-sub">${d.signingMethod==='in-person'?'In-Person Signing':'Remote E-Signature'} &nbsp;&bull;&nbsp; Signed: ${signedDateFmt}</div>
    </div>
  </div>

  <!-- Client Info -->
  <div class="section">
    <div class="section-title">Client Information</div>
    <div class="grid2">
      <div class="field"><label>Business Name</label><div class="val">${fd.bizName||''}</div></div>
      <div class="field"><label>DBA / Trade Name</label><div class="val">${fd.dba||''}</div></div>
      <div class="field" style="grid-column:span 2"><label>Street Address</label><div class="val">${fd.addr||''}</div></div>
      <div class="field"><label>City</label><div class="val">${fd.city||''}</div></div>
      <div class="field"><label>State / ZIP</label><div class="val">${fd.state||''} ${fd.zip||''}</div></div>
      <div class="field"><label>Phone</label><div class="val">${fd.phone||''}</div></div>
      <div class="field"><label>Contact Name</label><div class="val">${fd.contact||''}</div></div>
      <div class="field" style="grid-column:span 2"><label>Email</label><div class="val">${d.clientEmail||''}</div></div>
    </div>
  </div>

  <!-- Package Selection -->
  <div class="section">
    <div class="section-title">Package Selection</div>
    <div style="display:flex;align-items:center;gap:8pt;margin-bottom:7pt;">
      <span style="font-size:8.5pt;font-weight:700;color:#4a4f5e;text-transform:uppercase;letter-spacing:.4pt;">Term:</span>
      <span style="font-size:11pt;font-weight:700;color:#00205B;">${fd.term||''}</span>
    </div>
    ${zoneRows ? `<table class="zones"><thead><tr><th>Zone / Product</th><th style="text-align:right;">Rate/Mo</th></tr></thead><tbody>${zoneRows}</tbody></table>` : '<p style="font-size:9pt;color:#888;margin-bottom:6pt;">Zone details on file.</p>'}
    ${fd.notes ? `<div style="font-size:9pt;margin-top:4pt;"><strong>Notes:</strong> ${fd.notes}</div>` : ''}
  </div>

  <!-- Payment Authorization -->
  <div class="section">
    <div class="section-title">Payment Authorization</div>
    <table class="info">
      ${row('Payment Method', s.payMethod)}
      ${payRows}
    </table>
    <div style="font-size:8pt;color:#666;margin-top:4pt;">
      ${s.payMethod&&s.payMethod.includes('Credit')
        ? 'A 4% service fee will be added to all credit card payments.'
        : 'Client authorizes electronic debits on or about the 20th of each month.'}
    </div>
  </div>

  <!-- Add-Ons & Payment Summary -->
  <div class="section">
    <div class="section-title">Add-Ons &amp; Payment Summary</div>
    <div class="totals-box">
      <div class="total-row"><span>Subtotal (Monthly Zones)</span><span>${s.subtotal||'$0.00'}</span></div>
      ${s.monthly !== s.subtotal ? `<div class="total-row"><span>Add-Ons</span><span>${(parseFloat((s.monthly||'0').replace(/[^0-9.]/g,'')) - parseFloat((s.subtotal||'0').replace(/[^0-9.]/g,''))).toFixed(2) !== '0.00' ? s.monthly : '&mdash;'}</span></div>` : ''}
      <div class="total-row pink"><span style="font-size:11pt;">First Month Payment</span><span style="font-size:13pt;color:#BF0D3E;">${s.firstMonth||'$0.00'}</span></div>
      <div class="total-row blue"><span style="font-size:11pt;">Monthly Charge (recurring)</span><span style="font-size:13pt;">${s.monthly||'$0.00'}</span></div>
    </div>
    <div style="font-size:8pt;color:#666;margin-top:5pt;">Unpaid balances will incur a fee of the greater of $50 or 10% per month. A 4% service fee applies to all credit card payments.</div>
  </div>

  <div class="ftr">
    <span>The Texan Local &mdash; Knight Dynamic Solutions, LLC</span>
    <span>Page 1 of 2 &bull; See reverse for Terms &amp; Conditions</span>
  </div>
</div>

<!-- ══ PAGE 2 ══ -->
<div class="page">
  <div class="hdr">
    <div>
      <div class="hdr-title">The Texan Local</div>
      <div class="hdr-sub">A Knight Dynamic Solutions, LLC Company</div>
    </div>
    <div class="hdr-right">
      <div style="color:#fff;font-size:11pt;font-weight:700;">Terms &amp; Conditions</div>
      <div class="hdr-sub">Advertising Enrollment Agreement</div>
    </div>
  </div>

  <div class="section" style="padding:8pt 14pt;">
    <p style="font-size:9pt;line-height:1.7;margin-bottom:7pt;text-align:justify;">This Texan Local Advertising Enrollment Agreement (&ldquo;Agreement&rdquo;) is entered into by and between Knight Dynamic Solutions, LLC d/b/a Texan Local (&ldquo;Company&rdquo;) and the business identified in this Agreement (&ldquo;Client&rdquo;). In consideration of the fees set forth herein, Company shall provide advertising placement and related marketing services selected by Client within Texan Local publications and associated distribution channels. Distribution quantities, publication dates, placement positions, and circulation figures are estimates and targets only and may vary from time to time. Client acknowledges that Company makes no guarantee regarding leads, sales, revenue, customer acquisition, return on investment, or advertising performance.</p>
    <p style="font-size:9pt;line-height:1.7;margin-bottom:7pt;text-align:justify;">Client agrees to the pricing, products, zones, and term selected and acknowledges a fixed-term advertising commitment. All invoices shall be due and payable when billed. Client authorizes Knight Dynamic Solutions, LLC to charge any payment method provided for all amounts due, including recurring monthly charges, setup fees, renewal terms, late fees, and authorized additional services. Monthly invoices shall be charged on or about the 20th of each month. This authorization remains in effect until all amounts owed have been paid in full. Any invoice not paid within 30 days shall incur a late fee of $50.00 per month or the maximum permitted by law. Client shall not withhold, offset, or delay payment based upon advertising performance, lead volume, or perceived return on investment.</p>
    <p style="font-size:9pt;line-height:1.7;margin-bottom:7pt;text-align:justify;">This Agreement shall automatically renew for an additional term equal to the original unless either party provides written notice of non-renewal at least 60 days prior to expiration. Client may cancel only by providing written notice at least 30 days prior to the next scheduled ad approval deadline. Early termination fee equals 50% of the remaining contract value, together with any outstanding balances then due.</p>
    <p style="font-size:9pt;line-height:1.7;margin-bottom:7pt;text-align:justify;">In the event of nonpayment, chargeback, returned payment, or other default, Company may immediately suspend all services without further notice. In the event of a chargeback, payment dispute, returned ACH, insufficient funds, or other payment reversal initiated by Client, such action constitutes a default and all costs incurred by Company in recovering such amounts shall be immediately due and payable by Client.</p>
    <p style="font-size:9pt;line-height:1.7;margin-bottom:7pt;text-align:justify;">The individual signing represents and warrants they are authorized to bind Client and personally, unconditionally, and irrevocably guarantees payment and performance of all obligations. Client agrees to reimburse Company for all enforcement costs including attorney&rsquo;s fees, court costs, and collection expenses. This Agreement is governed by the laws of the State of Texas; exclusive venue for any dispute shall be the state courts located in Comal County, Texas. Electronic signatures are deemed original signatures and are fully binding under the federal ESIGN Act and UETA.</p>
  </div>

  <!-- ESIGN Compliance -->
  <div style="padding:0 14pt 6pt;">
    <div class="esign-bar" style="border-radius:3pt 3pt 0 0;">ESIGN / UETA Compliance Record</div>
    <table class="info" style="margin-bottom:0;">
      ${row('Consent Text', s.consentText||'I agree to conduct this transaction using electronic records and signatures.')}
      ${row('Consent Given', new Date(s.consentAt||d.signedAt).toLocaleString("en-US",{timeZone:"America/Chicago",dateStyle:"full",timeStyle:"short"}))}
      ${d.verifiedAt ? row('Email Verified', new Date(d.verifiedAt).toLocaleString("en-US",{timeZone:"America/Chicago",dateStyle:"full",timeStyle:"short"})) : ''}
      ${row('IP Address', s.ipAddress||'In-Person')}
      ${row('SHA-256 Audit Hash', `<span style="font-family:monospace;font-size:8pt;word-break:break-all;">${d.auditHash||''}</span>`)}
    </table>
  </div>

  <!-- Signatures -->
  <div class="sig-grid">
    <div>
      <div class="sig-block">
        <label>Authorized Agent Signature</label>
        <div class="sig-line"></div>
        <div class="sig-sub">Print Name: <strong>${s.sigName||''}</strong></div>
        <div class="sig-sub" style="margin-top:3pt;">Title: ${s.sigTitle||''}</div>
        <div class="sig-sub" style="margin-top:3pt;">Date: ${s.signedDate||''}</div>
        <div class="sig-sub" style="margin-top:3pt;">Initials: ${s.initials||''}</div>
      </div>
    </div>
    <div>
      <div class="sig-block">
        <label>Texan Local Representative</label>
        <div class="sig-line"></div>
        <div class="sig-sub">Josh Knight</div>
        <div class="sig-sub" style="margin-top:3pt;">Knight Dynamic Solutions, LLC</div>
        <div class="sig-sub" style="margin-top:3pt;">Date: ${s.signedDate||''}</div>
      </div>
    </div>
  </div>

  <div class="ftr">
    <span>The Texan Local &mdash; Knight Dynamic Solutions, LLC</span>
    <span>Page 2 of 2 &bull; Governed by Texas Law &bull; Venue: Comal County, TX</span>
  </div>
</div>

</body>
</html>`;

    context.res = {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
      body: html
    };

  } catch (err) {
    context.log.error("getPdf error:", err);
    context.res = { status:500, body: { error: err.message } };
  }
};
