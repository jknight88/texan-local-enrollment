// POST /api/deleteForm { id, key, force? }
// Deletes an enrollment. If force=true, deletes even signed records.
const { BlobServiceClient } = require("@azure/storage-blob");
const STORAGE_CONN  = process.env.AZURE_STORAGE_CONNECTION_STRING;
const CONTAINER     = "enrollments";
const DASHBOARD_KEY = process.env.DASHBOARD_KEY || "changeme";

module.exports = async function(context, req) {
  if (req.method === "OPTIONS") { context.res={status:200}; return; }
  const { id, key, force } = req.body || {};
  if (key !== DASHBOARD_KEY) { context.res={status:401,body:{error:"Unauthorized"}}; return; }
  if (!id) { context.res={status:400,body:{error:"Missing id"}}; return; }
  try {
    const blobSvc   = BlobServiceClient.fromConnectionString(STORAGE_CONN);
    const container = blobSvc.getContainerClient(CONTAINER);
    const blob      = container.getBlockBlobClient(`${id}.json`);
    const dl        = await blob.downloadToBuffer();
    const record    = JSON.parse(dl.toString());

    // Only block deletion of signed records if force is not set
    if (record.status === 'signed' && !force) {
      context.res = { status:403, body:{error:"Cannot delete a signed record without force flag."} };
      return;
    }

    await blob.delete();
    // Also delete audit log if exists
    try { await container.getBlockBlobClient(`${id}_audit.json`).delete(); } catch(e){}

    context.res = { status:200, body:{ ok:true } };
  } catch (err) {
    context.log.error("deleteForm error:", err);
    context.res = { status:500, body:{error:err.message} };
  }
};
