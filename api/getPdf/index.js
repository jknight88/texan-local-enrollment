// GET /api/getPdf?id=SESSION_ID&key=DASHBOARD_KEY  or  ?id=SESSION_ID&pdfToken=TOKEN
const { BlobServiceClient } = require("@azure/storage-blob");
const STORAGE_CONN  = process.env.AZURE_STORAGE_CONNECTION_STRING;
const CONTAINER     = "enrollments";
const DASHBOARD_KEY = process.env.DASHBOARD_KEY || "changeme";

function maskPayment(payMethod, payDetail) {
  if (!payDetail) return { method: payMethod||'', rows: '' };
  const parts = payDetail.split('|');
  let rows = '';
  const r = (label, val) => `<tr><td style="padding:5pt 8pt;font-weight:700;background:#edf0f7;border:1pt solid #c8cdd8;width:38%;font-size:9pt;">${label}</td><td style="padding:5pt 8pt;background:#fff;border:1pt solid #c8cdd8;font-size:9pt;">${val||'&mdash;'}</td></tr>`;
  if (payMethod && payMethod.includes('Credit Card')) {
    const raw = (parts[1]||'').replace(/\s/g,'');
    const masked = raw.length > 4 ? '&bull;&bull;&bull;&bull; &bull;&bull;&bull;&bull; &bull;&bull;&bull;&bull; ' + raw.slice(-4) : raw;
    rows = r('Card Type', parts[0]||'')
         + r('Card Number', masked)
         + r('Name on Card', parts[2]||'')
         + r('Expiration', parts[3]?parts[3].replace('Exp:',''):'')
         + r('CVV', '&bull;&bull;&bull;')
         + r('Billing Address', parts[5]?parts[5].replace('Billing:',''):'');
  } else {
    const acct = (parts[1]||'').replace('Account:','');
    const maskedAcct = acct.length > 4 ? '&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull; ' + acct.slice(-4) : acct;
    rows = r('Routing Number', (parts[0]||'').replace('Routing:',''))
         + r('Account Number', maskedAcct)
         + r('Account Type',   (parts[2]||'').replace('Type:',''))
         + r('Account Holder', (parts[3]||'').replace('Holder:',''));
  }
  return { method: payMethod||'', rows };
}

module.exports = async function(context, req) {
  if (req.method === "OPTIONS") { context.res={status:200}; return; }

  const authKey     = req.query.key;
  const pdfTokenReq = req.query.pdfToken;
  let authorized    = (authKey === DASHBOARD_KEY);

  const id = req.query.id;
  if (!id) { context.res={status:400,body:"Missing id"}; return; }

  const blobSvc   = BlobServiceClient.fromConnectionString(STORAGE_CONN);
  const container = blobSvc.getContainerClient(CONTAINER);
  const blob      = container.getBlockBlobClient(`${id}.json`);

  if (!authorized && pdfTokenReq) {
    try {
      const dlAuth   = await blob.downloadToBuffer();
      const recAuth  = JSON.parse(dlAuth.toString());
      authorized     = (recAuth.pdfToken === pdfTokenReq);
    } catch(e) { authorized = false; }
  }
  if (!authorized) { context.res={status:401,body:"Unauthorized"}; return; }

  try {
    const dl     = await blob.downloadToBuffer();
    const record = JSON.parse(dl.toString());
    if (record.status !== 'signed') { context.res={status:400,body:"Agreement not yet signed."}; return; }

    const s  = record.signed || {};
    const fd = record.formData || {};
    const signedDateFmt = new Date(record.signedAt).toLocaleString("en-US",{timeZone:"America/Chicago",dateStyle:"full",timeStyle:"short"});
    const repSignedFmt  = record.countersignedAt ? new Date(record.countersignedAt).toLocaleString("en-US",{timeZone:"America/Chicago",dateStyle:"full",timeStyle:"short"}) : signedDateFmt;
    const pay = maskPayment(s.payMethod, s.payDetail);

    // Build zone rows from saved zones data
    let zoneRows = '';
    if (fd.zones && fd.zones.length > 0) {
      fd.zones.forEach(z => {
        const name    = z.zoneName || z.id || '';
        const product = z.product  || '';
        const rate    = z.rate     || '0.00';
        zoneRows += `<tr>
          <td style="padding:4pt 6pt;border:1pt solid #c8cdd8;font-size:9pt;">${name}</td>
          <td style="padding:4pt 6pt;border:1pt solid #c8cdd8;font-size:9pt;">${product}</td>
          <td style="padding:4pt 6pt;border:1pt solid #c8cdd8;font-size:9pt;text-align:right;">$${parseFloat(rate).toFixed(2)}/mo</td>
        </tr>`;
      });
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Enrollment Agreement - ${record.bizName}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Source+Sans+3:wght@300;400;600;700&display=swap');
  *{ box-sizing:border-box; margin:0; padding:0; }
  body{ font-family:'Source Sans 3',Arial,sans-serif; color:#1a1a2e; font-size:9.5pt; background:#fff; }
  @page{ margin:0.45in; size:letter portrait; }
  @media screen{ body{ max-width:760px; margin:0 auto; padding:16px; } }
  @media print{
    .print-btn{ display:none !important; }
    @page{ margin:0.45in; }
    /* Suppress browser-added URL and timestamp headers/footers */
    html{ -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  }
  .page{ page-break-after:always; }
  .page:last-child{ page-break-after:avoid; }
  .hdr{ background:#00205B; padding:8pt 14pt; border-bottom:4pt solid #BF0D3E; display:flex; align-items:center; justify-content:space-between; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .hdr-title{ color:#fff; font-family:'Playfair Display',serif; font-size:13pt; }
  .hdr-sub{ color:rgba(255,255,255,.7); font-size:8pt; margin-top:1pt; }
  .section{ padding:7pt 13pt; border-bottom:1pt solid #dde2ef; }
  .sec-title{ background:#00205B; color:#fff; font-size:7pt; font-weight:700; letter-spacing:1pt; text-transform:uppercase; padding:3pt 13pt; margin:0 -13pt 6pt; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .grid2{ display:grid; grid-template-columns:1fr 1fr; gap:5pt; }
  .field label{ display:block; font-size:7pt; font-weight:700; color:#4a4f5e; text-transform:uppercase; letter-spacing:.4pt; margin-bottom:1pt; }
  .field .val{ font-size:9pt; border-bottom:1pt solid #c8cdd8; padding:2pt 0; min-height:13pt; }
  table.dtbl{ width:100%; border-collapse:collapse; margin-bottom:6pt; }
  table.dtbl td{ padding:5pt 8pt; border:1pt solid #c8cdd8; font-size:9pt; }
  table.dtbl td:first-child{ font-weight:700; color:#4a4f5e; background:#edf0f7; width:38%; }
  table.zones{ width:100%; border-collapse:collapse; font-size:8.5pt; margin-bottom:5pt; }
  table.zones th{ background:#00205B; color:#fff; padding:3pt 6pt; font-size:7.5pt; text-align:left; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .totals-box{ border:1.5pt solid #00205B; border-radius:2pt; overflow:hidden; margin:5pt 0; }
  .total-row{ display:flex; justify-content:space-between; align-items:center; padding:4pt 9pt; border-bottom:1pt solid #dde2ef; font-size:9pt; }
  .total-row:last-child{ border-bottom:none; }
  .total-row.blue{ background:#00205B; color:#fff; font-weight:700; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .total-row.pink{ background:#fef0f4; font-weight:700; }
  .sig-grid{ display:grid; grid-template-columns:1fr 1fr; gap:14pt; padding:7pt 13pt; }
  .sig-block label{ font-size:7pt; font-weight:700; color:#4a4f5e; text-transform:uppercase; letter-spacing:.4pt; display:block; margin-bottom:4pt; }
  .sig-line{ border-bottom:1.5pt solid #1a1a2e; height:28pt; margin-bottom:3pt; }
  .sig-sub{ font-size:8pt; color:#4a4f5e; margin-top:2pt; }
  .ftr{ background:#00205B; border-top:3pt solid #BF0D3E; padding:5pt 13pt; display:flex; justify-content:space-between; align-items:center; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .ftr span{ color:rgba(255,255,255,.65); font-size:7pt; }
  .conf-bar{ background:#BF0D3E; color:#fff; padding:4pt 8pt; font-size:7pt; font-weight:700; text-transform:uppercase; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .esign-bar{ background:#1a5c1a; color:#fff; padding:4pt 8pt; font-size:7pt; font-weight:700; text-transform:uppercase; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .print-btn{ position:fixed; top:14px; right:14px; background:#00205B; color:#fff; border:none; padding:9px 18px; border-radius:4px; font-size:12px; font-weight:700; cursor:pointer; font-family:inherit; z-index:999; }
</style>
</head>
<body>
<button class="print-btn" onclick="window.print()">&#128438; Print / Save PDF</button>

<!-- PAGE 1 -->
<div class="page">
  <div class="hdr">
    <div><div class="hdr-title">The Texan Local</div><div class="hdr-sub">A Knight Dynamic Solutions, LLC Company</div></div>
    <div style="text-align:right;">
      <div style="color:#fff;font-size:11pt;font-weight:700;">Advertising Enrollment Agreement</div>
      <div class="hdr-sub">${record.signingMethod==='in-person'?'In-Person':'Remote E-Signature'} &bull; Signed: ${signedDateFmt}</div>
    </div>
  </div>

  <!-- CLIENT INFO -->
  <div class="section">
    <div class="sec-title">Client Information</div>
    <div class="grid2">
      <div class="field"><label>Business Name</label><div class="val">${fd.bizName||''}</div></div>
      <div class="field"><label>DBA / Trade Name</label><div class="val">${fd.dba||''}</div></div>
      <div class="field" style="grid-column:span 2"><label>Street Address</label><div class="val">${fd.addr||''}</div></div>
      <div class="field"><label>City</label><div class="val">${fd.city||''}</div></div>
      <div class="field"><label>State / ZIP</label><div class="val">${fd.state||''} ${fd.zip||''}</div></div>
      <div class="field"><label>Phone</label><div class="val">${fd.phone||''}</div></div>
      <div class="field"><label>Contact Name</label><div class="val">${fd.contact||''}</div></div>
      <div class="field" style="grid-column:span 2"><label>Email</label><div class="val">${record.clientEmail||''}</div></div>
    </div>
  </div>

  <!-- PACKAGE SELECTION -->
  <div class="section">
    <div class="sec-title">Package Selection</div>
    <div style="display:flex;align-items:center;gap:20pt;margin-bottom:6pt;flex-wrap:wrap;">
      <div><span style="font-size:7.5pt;font-weight:700;color:#4a4f5e;text-transform:uppercase;letter-spacing:.4pt;">Term:</span>
      <span style="font-size:11pt;font-weight:700;color:#00205B;margin-left:4pt;">${fd.term||''}</span></div>
      ${fd.rep ? `<div><span style="font-size:7.5pt;font-weight:700;color:#4a4f5e;text-transform:uppercase;letter-spacing:.4pt;">Sales Rep:</span><span style="font-size:11pt;font-weight:700;color:#00205B;margin-left:4pt;">${fd.rep}</span></div>` : ''}
    </div>
    ${zoneRows ? `<table class="zones"><thead><tr><th>Zone</th><th>Product</th><th style="text-align:right;">Rate/Mo</th></tr></thead><tbody>${zoneRows}</tbody></table>` : '<p style="font-size:8.5pt;color:#888;margin-bottom:5pt;">Zone details on file.</p>'}
    ${fd.notes ? `<div style="font-size:8.5pt;margin-top:3pt;"><strong>Notes:</strong> ${fd.notes}</div>` : ''}
  </div>

  <!-- PAYMENT AUTHORIZATION -->
  <div class="section">
    <div class="sec-title">Payment Authorization</div>
    <div class="conf-bar" style="border-radius:2pt 2pt 0 0;margin-bottom:0;">Payment Method: ${pay.method}</div>
    <table class="dtbl" style="margin-top:0;border-top:none;">
      ${pay.rows}
    </table>
    <div style="font-size:8pt;color:#666;margin-top:3pt;">
      ${s.payMethod&&s.payMethod.includes('Credit')?'A 4% service fee applies to all credit card payments.':'Client authorizes electronic debits on or about the 20th of each month.'}
    </div>
  </div>

  <!-- PAYMENT SUMMARY -->
  <div class="section">
    <div class="sec-title">Payment Summary</div>
    <div class="totals-box">
      <div class="total-row"><span>Subtotal (Monthly Zones)</span><span>${s.subtotal||'$0.00'}</span></div>
      ${s.monthly && s.subtotal && s.monthly !== s.subtotal ? `<div class="total-row"><span>Add-Ons</span><span>${s.monthly}</span></div>` : ''}
      <div class="total-row pink"><span style="font-size:10pt;">First Month Payment</span><span style="font-size:12pt;color:#BF0D3E;">${s.firstMonth||'$0.00'}</span></div>
      <div class="total-row blue"><span style="font-size:10pt;">Monthly Charge (recurring)</span><span style="font-size:12pt;">${s.monthly||'$0.00'}</span></div>
    </div>
    <div style="font-size:8pt;color:#666;margin-top:4pt;">Initials: <strong>${s.initials||''}</strong> &nbsp;&nbsp; Unpaid balances incur a fee of the greater of $50 or 10% per month.</div>
  </div>

  <div class="ftr">
    <span>The Texan Local &mdash; Knight Dynamic Solutions, LLC</span>
    <span>Page 1 of 2 &bull; Terms &amp; Conditions on reverse</span>
  </div>
</div>

<!-- PAGE 2 -->
<div class="page">
  <div class="hdr">
    <div><div class="hdr-title">The Texan Local</div><div class="hdr-sub">A Knight Dynamic Solutions, LLC Company</div></div>
    <div style="text-align:right;"><div style="color:#fff;font-size:11pt;font-weight:700;">Terms &amp; Conditions</div><div class="hdr-sub">Advertising Enrollment Agreement</div></div>
  </div>

  <!-- FULL T&C -->
  <div class="section" style="padding:6pt 13pt;">
    <div class="sec-title">Terms &amp; Conditions</div>
    <p style="font-size:8.5pt;line-height:1.6;margin-bottom:5pt;text-align:justify;">This Texan Local Advertising Enrollment Agreement (&ldquo;Agreement&rdquo;) is entered into by and between Knight Dynamic Solutions, LLC d/b/a Texan Local (&ldquo;Company&rdquo;) and the business identified in this Agreement (&ldquo;Client&rdquo;). In consideration of the fees set forth herein, Company shall provide advertising placement and related marketing services selected by Client within Texan Local publications and associated distribution channels. Distribution quantities, publication dates, placement positions, and circulation figures are estimates and targets only and may vary from time to time based upon operational, printing, mailing, market, or business considerations. Client acknowledges that Company makes no guarantee regarding leads, sales, revenue, customer acquisition, return on investment, or advertising performance.</p>
    <p style="font-size:8.5pt;line-height:1.6;margin-bottom:5pt;text-align:justify;">Client agrees to the pricing, products, zones, and term selected in this Agreement and acknowledges that it is entering into a fixed-term advertising commitment. All invoices shall be due and payable when billed. Client authorizes Knight Dynamic Solutions, LLC to charge any credit card, debit card, ACH account, checking account, or other payment method provided by Client for all amounts due, including recurring monthly charges, setup fees, renewal terms, late fees, and any authorized additional services. Monthly invoices shall be charged on or about the twentieth (20th) day of each month, or the preceding business day if the twentieth falls on a weekend or holiday. This authorization shall remain in effect throughout the initial term, any renewal term, and until all amounts owed have been paid in full. Any invoice not paid within thirty (30) days shall incur a late fee of $50.00 per month. Client shall not withhold, offset, reduce, dispute, or delay payment based upon advertising performance, lead volume, response rates, ad approval delays, or perceived return on investment. Full payment remains due regardless of whether Client utilizes all advertising opportunities available under this Agreement.</p>
    <p style="font-size:8.5pt;line-height:1.6;margin-bottom:5pt;text-align:justify;">This Agreement shall automatically renew for an additional term equal to the original contract term, with the same products, zones, and pricing, unless either party provides written notice of non-renewal at least sixty (60) days prior to expiration. Company will make reasonable efforts to replicate premium placements during renewal terms when available; however, exact placement dates and positions are not guaranteed. Client may cancel only by providing written notice at least thirty (30) days prior to the next scheduled ad approval deadline. Early termination fee equals fifty percent (50%) of the remaining contract value, together with any outstanding balances then due. All such amounts shall become immediately due and payable upon notice of cancellation.</p>
    <p style="font-size:8.5pt;line-height:1.6;margin-bottom:5pt;text-align:justify;">In the event of nonpayment, chargeback, returned payment, breach, or other default, Company may immediately suspend all services without further notice. Such suspension shall not relieve Client of any payment obligations. Upon default, all unpaid amounts, termination fees, and charges shall immediately become due and payable. In the event of a chargeback, payment dispute, returned ACH, insufficient funds, revoked payment authorization, or other payment reversal initiated by Client, such action constitutes a default and all recovery costs shall be immediately due and payable by Client.</p>
    <p style="font-size:8.5pt;line-height:1.6;margin-bottom:5pt;text-align:justify;">Client shall receive reasonable opportunities to review and approve advertising materials prior to publication. If Client fails to provide approvals, revisions, artwork, or required materials by Company&rsquo;s stated deadlines, Company may publish the most recently approved version, utilize materials previously supplied, or omit the advertisement without relieving Client of any payment obligations. The individual signing personally, unconditionally, and irrevocably guarantees payment and performance of all obligations. Client and guarantor agree to reimburse Company for all enforcement costs including reasonable attorney&rsquo;s fees, court costs, filing fees, collection agency fees, and other collection-related expenses.</p>
    <p style="font-size:8.5pt;line-height:1.6;text-align:justify;">This Agreement constitutes the entire agreement between the parties. Electronic signatures shall be deemed original signatures and shall be fully binding and enforceable under the federal ESIGN Act and UETA. Company shall not be liable for delays caused by events beyond its reasonable control. This Agreement shall be governed by the laws of the State of Texas; exclusive venue for any dispute shall be the state courts located in Comal County, Texas. The prevailing party in any action arising from this Agreement shall be entitled to recover its reasonable attorney&rsquo;s fees and costs.</p>
  </div>

  <!-- ESIGN -->
  <div style="padding:0 13pt 5pt;">
    <div class="esign-bar" style="border-radius:2pt 2pt 0 0;">ESIGN / UETA Compliance Record</div>
    <table class="dtbl" style="margin-top:0;">
      <tr><td>Consent</td><td style="font-size:8pt;">${s.consentText||'I agree to conduct this transaction using electronic records and signatures.'}</td></tr>
      <tr><td>Consent Given</td><td>${new Date(s.consentAt||record.signedAt).toLocaleString("en-US",{timeZone:"America/Chicago",dateStyle:"full",timeStyle:"short"})}</td></tr>
      ${record.verifiedAt ? `<tr><td>Email Verified</td><td>${new Date(record.verifiedAt).toLocaleString("en-US",{timeZone:"America/Chicago",dateStyle:"full",timeStyle:"short"})}</td></tr>` : ''}
      <tr><td>IP Address</td><td style="font-family:monospace;font-size:8pt;">${s.ipAddress||'In-Person'}</td></tr>
      <tr><td>Audit Hash</td><td style="font-family:monospace;font-size:7.5pt;word-break:break-all;">${record.auditHash||''}</td></tr>
    </table>
  </div>

  <!-- SIGNATURES -->
  <div class="sig-grid">
    <div>
      <div class="sig-block">
        <label>Authorized Agent Signature</label>
        <div class="sig-line"></div>
        <div class="sig-sub">Print Name: <strong>${s.sigName||''}</strong></div>
        <div class="sig-sub">Title: ${s.sigTitle||''}</div>
        <div class="sig-sub">Date: ${s.signedDate||''}</div>
        <div class="sig-sub">Initials: ${s.initials||''}</div>
      </div>
    </div>
    <div>
      <div class="sig-block">
        <label>Texan Local Representative</label>
        <div class="sig-line"></div>
        <div class="sig-sub">Print Name: <strong>${record.repSig ? record.repSig.name : (s.repSigName||'Josh Knight')}</strong></div>
        <div class="sig-sub">Title: ${record.repSig ? record.repSig.title : (s.repSigTitle||'Owner')} &mdash; Knight Dynamic Solutions, LLC</div>
        <div class="sig-sub">Date: ${record.countersignedAt ? new Date(record.countersignedAt).toLocaleDateString('en-US') : (s.signedDate||'')}</div>
      </div>
    </div>
  </div>

  <div class="ftr">
    <span>The Texan Local &mdash; Knight Dynamic Solutions, LLC</span>
    <span>Page 2 of 2 &bull; Governed by Texas Law &bull; Venue: Comal County, TX</span>
  </div>
</div>

<script>
// Suppress URL/timestamp in print headers/footers via CSS is handled by @page
// This script ensures clean print
window.addEventListener('load', function(){
  var style = document.createElement('style');
  style.textContent = '@page { margin: 0.45in; } @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }';
  document.head.appendChild(style);
});
</script>
</body>
</html>`;

    context.res = {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
      body: html
    };
  } catch (err) {
    context.log.error("getPdf error:", err);
    context.res = { status:500, body:{ error:err.message } };
  }
};
