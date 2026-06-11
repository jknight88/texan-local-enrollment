// FOLDER: api/getDashboard/index.js
const { BlobServiceClient } = require("@azure/storage-blob");
const STORAGE_CONN  = process.env.AZURE_STORAGE_CONNECTION_STRING;
const CONTAINER     = "enrollments";
const DASHBOARD_KEY = process.env.DASHBOARD_KEY || "changeme";

module.exports = async function(context, req) {
  if (req.method === "OPTIONS") {
    context.res = { status:200, headers:{"Content-Type":"application/json"}, body:"{}" };
    return;
  }

  const key = req.query.key || (req.body && req.body.key) || "";
  if (key !== DASHBOARD_KEY) {
    context.res = { status:401, headers:{"Content-Type":"application/json"}, body: JSON.stringify({error:"Unauthorized"}) };
    return;
  }

  try {
    const blobSvc   = BlobServiceClient.fromConnectionString(STORAGE_CONN);
    const container = blobSvc.getContainerClient(CONTAINER);
    const results   = [];

    for await (const blob of container.listBlobsFlat()) {
      if (blob.name.endsWith("_audit.json")) continue;
      try {
        const dl     = await container.getBlockBlobClient(blob.name).downloadToBuffer();
        const record = JSON.parse(dl.toString());
        // Skip trashed records
        if (record._deleted) continue;
        results.push({
          sessionId:     record.sessionId,
          bizName:       record.bizName,
          clientEmail:   record.clientEmail,
          status:        record.status,
          signingMethod: record.signingMethod || 'remote',
          createdAt:     record.createdAt,
          openedAt:      record.openedAt,
          lastOpenedAt:  record.lastOpenedAt,
          openCount:     record.openCount || 0,
          verifiedAt:    record.verifiedAt,
          signedAt:      record.signedAt,
          consentAt:     record.signed && record.signed.consentAt,
          ipAddress:     record.signed && record.signed.ipAddress,
          auditHash:     record.auditHash,
          verified:      record.verified || false,
          term:          record.formData && record.formData.term,
          rep:           record.formData && record.formData.rep,
          monthly:       record.signed   && record.signed.monthly,
          formData:      record.formData,
          signed:        record.signed,
          auditTrail:    record.auditTrail
        });
      } catch(blobErr) {
        context.log.warn("Skipping blob:", blob.name, blobErr.message);
      }
    }

    results.sort(function(a,b){ return new Date(b.createdAt) - new Date(a.createdAt); });

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(results)
    };

  } catch (err) {
    context.log.error("getDashboard error:", err);
    context.res = {
      status: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message })
    };
  }
};
