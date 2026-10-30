import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly ttl: number;

  constructor(config: ConfigService) {
    const endpoint = config.get<string>("S3_ENDPOINT");
    const bucket = config.get<string>("S3_BUCKET");
    const accessKeyId = config.get<string>("S3_ACCESS_KEY");
    const secretAccessKey = config.get<string>("S3_SECRET_KEY");

    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
      throw new Error(
        "S3 storage sozlamalari to'liq emas (S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY)",
      );
    }
    this.bucket = bucket;
    this.ttl = config.get<number>("S3_PRESIGN_TTL_SECONDS", 300);
    this.client = new S3Client({
      endpoint,
      region: config.get<string>("S3_REGION", "us-east-1"),
      forcePathStyle: config.get<boolean>("S3_FORCE_PATH_STYLE", true),
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  async presignUpload(key: string, contentType: string): Promise<string> {
    try {
      return await getSignedUrl(
        this.client,
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          ContentType: contentType,
        }),
        { expiresIn: this.ttl },
      );
    } catch {
      throw new ServiceUnavailableException("Fayl saqlash xizmati javob bermayapti");
    }
  }

  async presignDownload(key: string, fileName: string): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: `attachment; filename="${fileName.replace(/["\r\n]/g, "")}"`,
      }),
      { expiresIn: this.ttl },
    );
  }

  async head(key: string): Promise<{ contentLength: number; contentType: string }> {
    const result = await this.client.send(
      new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    return {
      contentLength: result.ContentLength ?? 0,
      contentType: result.ContentType ?? "application/octet-stream",
    };
  }

  async remove(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
