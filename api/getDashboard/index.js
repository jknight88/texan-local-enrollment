// GET /api/getDashboard?key=DASHBOARD_KEY
const { BlobServiceClient } = require("@azure/storage-blob");
const STORAGE_CONN  = process.env.AZURE_STORAGE_CONNECTION_STRING;
const CONTAINER     = "enrollments";
const DASHBOARD_KEY = process.env.DASHBOARD_KEY || "changeme";

module.exports = async function(context, req) {
  if (req.method === "OPTIONS") { context.res={status:200}; return; }
  if (req.query.key !== DASHBOARD_KEY) { context.res={status:401,body:{error:"Unauthorized"}}; return; }
  try {
    const blobSvc   = BlobServiceClient.fromConnectionString(STORAGE_CONN);
    const container = blobSvc.getContainerClient(CONTAINER);
    const results   = [];
    for await (const blob of container.listBlobsFlat()) {
      if (blob.name.endsWith("_audit.json")) continue;
      const dl     = await container.getBlockBlobClient(blob.name).downloadToBuffer();
      const record = JSON.parse(dl.toString());
      results.push({
        sessionId:   record.sessionId,
        bizName:     record.bizName,
        clientEmail: record.clientEmail,
        status:      record.status,
        createdAt:   record.createdAt,
        openedAt:    record.openedAt,
        verifiedAt:  record.verifiedAt,
        signedAt:    record.signedAt,
        consentAt:   record.signed && record.signed.consentAt,
        ipAddress:   record.signed && record.signed.ipAddress,
        auditHash:   record.auditHash,
        verified:    record.verified || false,
        term:        record.formData && record.formData.term,
        monthly:     record.signed   && record.signed.monthly,
        // Full signed data for document view
        formData:    record.formData,
        signed:      record.signed,
        auditTrail:  record.auditTrail
      });
    }
    results.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
    context.res = { status:200, body: results };
  } catch (err) {
    context.log.error("getDashboard error:", err);
    context.res = { status:500, body:{error:err.message} };
  }
};
