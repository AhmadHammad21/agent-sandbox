/**
 * S3-compatible object storage. One prefix per tenant: tenant-{id}/.
 * Works with AWS S3, MinIO, R2, etc.
 */
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { config } from "../config.ts";

const s3 = new S3Client({
  endpoint: config.s3.endpoint,
  region: config.s3.region,
  forcePathStyle: config.s3.forcePathStyle,
  credentials: {
    accessKeyId: config.s3.accessKeyId,
    secretAccessKey: config.s3.secretAccessKey,
  },
});

export function tenantPrefix(tenantId: string): string {
  return `tenant-${tenantId}/`;
}

function key(tenantId: string, path: string): string {
  return `${tenantPrefix(tenantId)}${path.replace(/^\/+/, "")}`;
}

export async function putArtifact(
  tenantId: string,
  path: string,
  body: Buffer | string,
  contentType = "application/octet-stream",
): Promise<string> {
  const Key = key(tenantId, path);
  await s3.send(
    new PutObjectCommand({
      Bucket: config.s3.bucket,
      Key,
      Body: body,
      ContentType: contentType,
    }),
  );
  return Key;
}

export async function getArtifact(
  tenantId: string,
  path: string,
): Promise<Buffer> {
  const res = await s3.send(
    new GetObjectCommand({ Bucket: config.s3.bucket, Key: key(tenantId, path) }),
  );
  const bytes = await res.Body!.transformToByteArray();
  return Buffer.from(bytes);
}

export async function listArtifacts(tenantId: string): Promise<string[]> {
  const res = await s3.send(
    new ListObjectsV2Command({
      Bucket: config.s3.bucket,
      Prefix: tenantPrefix(tenantId),
    }),
  );
  return (res.Contents ?? []).map((o) => o.Key!).filter(Boolean);
}

export { s3 };
