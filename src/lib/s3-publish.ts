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

/**
 * AWS の認証エラー（特に SSO 期限切れ）を、ユーザーが「何をすればよいか」分かる
 * 日本語メッセージに翻訳する。該当しなければ汎用メッセージで包む。
 */
function toFriendlyAwsError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : "";
  const loginCmd = profile
    ? `aws sso login --profile ${profile}`
    : "aws sso login";
  const ssoExpired =
    /sso session|token (?:has )?expired|expired or is otherwise invalid|ExpiredToken|token.*refresh/i.test(
      msg,
    ) || /Expired|TokenRefresh/i.test(name);
  if (ssoExpired) {
    return new Error(
      `AWS の SSO セッションが切れています。ターミナルで「${loginCmd}」を実行してから、もう一度「モックをホスティング」を押してください。`,
    );
  }
  const noCreds =
    name === "CredentialsProviderError" ||
    /could not load credentials|unable to locate credentials|credential/i.test(
      msg,
    );
  if (noCreds) {
    return new Error(
      `AWS の認証情報が見つからない／無効です。「${loginCmd}」でログイン（または権限）をご確認のうえ、もう一度お試しください。`,
    );
  }
  if (/AccessDenied|Forbidden|not authorized/i.test(msg) || name === "AccessDenied") {
    return new Error(
      "AWS の権限が不足しています（S3 へのアップロードが拒否されました）。バケットの権限設定をご確認ください。",
    );
  }
  return new Error(`ホスティング（S3 アップロード）に失敗しました: ${msg}`);
}

/**
 * 任意のオブジェクト（バイナリ可）を key に配置し、CloudFront 上の公開 URL を返す。
 * アップロード（画像・一般ファイル）など publishHtml 以外の用途で使う汎用版。
 */
export async function putObject(
  key: string,
  body: Buffer | Uint8Array | string,
  contentType: string,
): Promise<string> {
  if (!bucket || !cloudfrontDomain) {
    throw new Error("S3_BUCKET / CLOUDFRONT_DOMAIN が未設定です");
  }
  try {
    await s3().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        // key は uuid で一意なので長期キャッシュで問題ない
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );
  } catch (err) {
    throw toFriendlyAwsError(err);
  }
  return `https://${cloudfrontDomain}/${key}`;
}

/** HTML を key に配置し、CloudFront 上の公開 URL を返す */
export async function publishHtml(key: string, html: string): Promise<string> {
  if (!bucket || !cloudfrontDomain) {
    throw new Error("S3_BUCKET / CLOUDFRONT_DOMAIN が未設定です");
  }
  try {
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
  } catch (err) {
    throw toFriendlyAwsError(err);
  }
  return `https://${cloudfrontDomain}/${key}`;
}
