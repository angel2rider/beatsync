import { DeleteObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

// --- Lazy-initialized S3 client (avoids crashing at import time in tests) ---
let _s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!_s3Client) {
    const region = process.env.OCI_REGION ?? "";
    const namespace = process.env.OCI_NAMESPACE ?? "";
    _s3Client = new S3Client({
      region,
      endpoint: `https://${namespace}.compat.objectstorage.${region}.oraclecloud.com`,
      credentials: {
        accessKeyId: process.env.OCI_ACCESS_KEY ?? "",
        secretAccessKey: process.env.OCI_SECRET_KEY ?? "",
      },
      forcePathStyle: true, // Required for Oracle S3-compatible API
    });
  }
  return _s3Client;
}

/**
 * Whether Oracle Object Storage is configured (all env vars present).
 */
export function isOracleConfigured(): boolean {
  return !!(
    process.env.OCI_ACCESS_KEY &&
    process.env.OCI_SECRET_KEY &&
    process.env.OCI_BUCKET &&
    process.env.OCI_NAMESPACE &&
    process.env.OCI_REGION
  );
}

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

/**
 * Get the public URL for an Oracle Object Storage key.
 * The bucket must have "Allow public access" enabled for this to work.
 */
export function getPublicObjectUrl(key: string): string {
  const region = process.env.OCI_REGION ?? "";
  const namespace = process.env.OCI_NAMESPACE ?? "";
  const bucket = process.env.OCI_BUCKET ?? "";
  const base = `https://objectstorage.${region}.oraclecloud.com/n/${namespace}/b/${bucket}/o`;
  return `${base}/${encodeURIComponent(key)}`;
}

/**
 * Extract the object key from an Oracle Object Storage public URL.
 * Returns null if the URL doesn't match the expected pattern.
 */
export function extractKeyFromPublicUrl(url: string): string | null {
  const region = process.env.OCI_REGION ?? "";
  const namespace = process.env.OCI_NAMESPACE ?? "";
  const bucket = process.env.OCI_BUCKET ?? "";
  const base = `https://objectstorage.${region}.oraclecloud.com/n/${namespace}/b/${bucket}/o`;
  const prefix = `${base}/`;
  if (!url.startsWith(prefix)) return null;
  return decodeURIComponent(url.slice(prefix.length));
}

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

/**
 * Upload an object to Oracle Object Storage.
 * Returns the public URL for the uploaded object.
 */
export async function uploadObject(
  key: string,
  body: Uint8Array | ArrayBuffer,
  contentType = "audio/mpeg"
): Promise<string> {
  const buffer = body instanceof ArrayBuffer ? new Uint8Array(body) : body;

  await getS3Client().send(
    new PutObjectCommand({
      Bucket: process.env.OCI_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );

  return getPublicObjectUrl(key);
}

/**
 * Delete a single object from Oracle Object Storage.
 */
export async function deleteObject(key: string): Promise<void> {
  await getS3Client().send(
    new DeleteObjectCommand({
      Bucket: process.env.OCI_BUCKET,
      Key: key,
    })
  );
}

/**
 * Delete all objects matching a prefix (used for room cleanup).
 * Lists all objects then deletes them individually — avoids Oracle's
 * DeleteObjects checksum requirements while keeping the code simple
 * (rooms typically have <20 files).
 * Returns the total number of objects deleted.
 */
export async function deleteObjectsWithPrefix(prefix: string): Promise<number> {
  let continuationToken: string | undefined;
  let deletedCount = 0;

  do {
    const listResponse = await getS3Client().send(
      new ListObjectsV2Command({
        Bucket: process.env.OCI_BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );

    const objects = listResponse.Contents;
    if (!objects || objects.length === 0) break;

    // Delete each object individually (Oracle requires checksums for batch
    // delete which the AWS SDK doesn't send by default)
    await Promise.all(
      objects.map((obj) =>
        getS3Client()
          .send(
            new DeleteObjectCommand({
              Bucket: process.env.OCI_BUCKET,
              Key: obj.Key!,
            })
          )
          .catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`Failed to delete Oracle object ${obj.Key}: ${msg}`);
          })
      )
    );

    deletedCount += objects.length;
    continuationToken = listResponse.NextContinuationToken;
  } while (continuationToken);

  return deletedCount;
}
