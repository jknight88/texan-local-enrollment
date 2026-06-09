// POST /api/trackOpen  { id: sessionId }
// Marks the record as opened with a timestamp
const { BlobServiceClient } = require("@azure/storage-blob");
const STORAGE_CONN = process.env.AZURE_STORAGE_CONNECTION_STRING;
const CONTAINER    = "enrollments";

module.exports = async function(context, req) {
  if (req.method === "OPTIONS") { context.res = { status: 200 }; return; }
  const id = req.body && req.body.id;
  if (!id) { context.res = { status: 400, body: { error: "Missing id" } }; return; }
  try {
    const blobClient = BlobServiceClient.fromConnectionString(STORAGE_CONN);
    const container  = blobClient.getContainerClient(CONTAINER);
    const blob       = container.getBlockBlobClient(`${id}.json`);
    const dl         = await blob.downloadToBuffer();
    const record     = JSON.parse(dl.toString());
    if (record.status === "sent") {
      record.status   = "opened";
      record.openedAt = new Date().toISOString();
      const updated   = JSON.stringify(record);
      await blob.upload(updated, Buffer.byteLength(updated), { blobHTTPHeaders: { blobContentType: "application/json" } });
    }
    context.res = { status: 200, body: { ok: true } };
  } catch (err) {
    context.res = { status: 500, body: { error: err.message } };
  }
};
