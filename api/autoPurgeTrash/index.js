// Timer function — runs daily at 2:00 AM Central 
// Permanently deletes any trash records where _purgeAfter has passed
const { BlobServiceClient } = require("@azure/storage-blob");
const STORAGE_CONN    = process.env.AZURE_STORAGE_CONNECTION_STRING;
const TRASH_CONTAINER = "enrollments-trash";

module.exports = async function(context, myTimer) {
  const now = new Date();
  context.log("autoPurgeTrash starting:", now.toISOString());

  if (myTimer.isPastDue) {
    context.log("Timer was past due — running now.");
  }

  if (!STORAGE_CONN) {
    context.log.error("AZURE_STORAGE_CONNECTION_STRING not set — aborting.");
    return;
  }

  try {
    const blobSvc   = BlobServiceClient.fromConnectionString(STORAGE_CONN);
    const container = blobSvc.getContainerClient(TRASH_CONTAINER);

    // Container may not exist yet if nothing has been trashed
    const exists = await container.exists();
    if (!exists) {
      context.log("Trash container does not exist yet — nothing to purge.");
      return;
    }

    let checked = 0, purged = 0, kept = 0, errors = 0;

    for await (const blob of container.listBlobsFlat()) {
      if (!blob.name.endsWith(".json") || blob.name.includes("_audit")) continue;
      checked++;

      try {
        const bc     = container.getBlockBlobClient(blob.name);
        const dl     = await bc.downloadToBuffer();
        const record = JSON.parse(dl.toString());

        if (!record._purgeAfter) {
          // No purge date set — set one now (60 days from today) as a safety net
          record._purgeAfter = new Date(Date.now() + 60*24*60*60*1000).toISOString();
          const updated = Buffer.from(JSON.stringify(record));
          await bc.upload(updated, updated.length, {
            overwrite: true,
            blobHTTPHeaders: { blobContentType: "application/json" }
          });
          kept++;
          continue;
        }

        const purgeDate = new Date(record._purgeAfter);
        if (now >= purgeDate) {
          // Past the purge window — delete permanently
          await bc.delete();
          // Also try to remove audit log
          try {
            const id = blob.name.replace(".json","");
            await container.getBlockBlobClient(`${id}_audit.json`).delete();
          } catch(e) {} // audit log may not exist, that's fine

          purged++;
          context.log("Purged:", blob.name, "| was due:", record._purgeAfter,
                      "| bizName:", record.bizName || "unknown");
        } else {
          kept++;
          const daysLeft = Math.ceil((purgeDate - now) / (1000*60*60*24));
          context.log("Keeping:", blob.name, "| days left:", daysLeft);
        }

      } catch(blobErr) {
        errors++;
        context.log.error("Error processing blob:", blob.name, blobErr.message);
      }
    }

    context.log(
      `autoPurgeTrash complete — checked: ${checked}, purged: ${purged}, kept: ${kept}, errors: ${errors}`
    );

  } catch (err) {
    context.log.error("autoPurgeTrash fatal error:", err.message);
  }
};
