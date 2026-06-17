/**
 * 生成した HTML プロトタイプを S3 にアップロードし、CloudFront の共有 URL を返す。
 *
 * バケットはプライベート。CloudFront（OAC）経由でのみ配信する。
 * 認証情報は、明示的な環境変数 → 標準の AWS 認証チェーン（AWS_PROFILE の SSO 等）の順で解決する。
 */
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";

const region = process.env.S3_AWS_REGION ?? "ap-northeast-1";
const bucket = process.env.S3_BUCKET;
const cloudfrontDomain = process.env.CLOUDFRONT_DOMAIN;
// シェルの AWS_PROFILE と衝突しないよう、専用変数からプロファイルを明示する
const profile = process.env.S3_AWS_PROFILE;

// 認証情報の優先順位:
//   1. S3_ プレフィックス付き環境変数（このファイルの S3_AWS_REGION / S3_AWS_PROFILE と同じ命名規約）
//   2. 標準の AWS_ 環境変数
//   3. fromNodeProviderChain（AWS CLI / SSO / プロファイル等。env-var が無い従来どおりの挙動）
const accessKeyId =
  process.env.S3_AWS_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID;
const secretAccessKey =
  process.env.S3_AWS_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY;
const sessionToken =
  process.env.S3_AWS_SESSION_TOKEN ?? process.env.AWS_SESSION_TOKEN;

let client: S3Client | null = null;
function s3(): S3Client {
  if (!client) {
    client = new S3Client({
      region,
      credentials:
        accessKeyId && secretAccessKey
          ? { accessKeyId, secretAccessKey, sessionToken }
          : fromNodeProviderChain(profile ? { profile } : {}),
    });
  }
  return client;
}

/** S3/CloudFront の設定が揃っているか（未設定ならプレビューのみで動かす） */
export function isS3Configured(): boolean {
  return Boolean(bucket && cloudfrontDomain);
}

/** HTML を key に配置し、CloudFront 上の公開 URL を返す */
export async function publishHtml(key: string, html: string): Promise<string> {
  if (!bucket || !cloudfrontDomain) {
    throw new Error("S3_BUCKET / CLOUDFRONT_DOMAIN が未設定です");
  }
  await s3().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: html,
      ContentType: "text/html; charset=utf-8",
      // key は生成ごとに一意なので長期キャッシュで問題ない（無効化不要）
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
  return `https://${cloudfrontDomain}/${key}`;
}
