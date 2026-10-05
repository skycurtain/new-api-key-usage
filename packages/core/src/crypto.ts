/**
 * 加密体系（WebCrypto / Web 标准 API——Bun 纪律红线）
 * SK_KEY_ENCRYPTION_SECRET 经 HKDF 派生 hmac / aes 子密钥（api_keys表字段设计 3.1）
 * 密码哈希 = PBKDF2-SHA256（两形态统一）
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(pad + "===".slice((pad.length + 3) % 4));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hkdfDerive(
  master: Uint8Array<ArrayBuffer>,
  info: string,
  length: number,
): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", master, "HKDF", false, [
    "deriveKey",
    "deriveBits",
  ]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: enc.encode("new-api-key-usage"),
      info: enc.encode(info),
    },
    base,
    { name: "HMAC", hash: "SHA-256", length: length * 8 },
    false,
    ["sign", "verify"],
  );
}

async function hkdfAesKey(master: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", master, "HKDF", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: enc.encode("new-api-key-usage"),
      info: enc.encode("aes-gcm"),
    },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export class KeyCrypto {
  private constructor(
    private readonly hmacKey: CryptoKey,
    private readonly aesKey: CryptoKey,
  ) {}

  static async fromEncryptionSecret(secretB64: string): Promise<KeyCrypto> {
    const master = b64urlDecode(secretB64);
    if (master.length < 32) {
      throw new Error("SK_KEY_ENCRYPTION_SECRET too short");
    }
    const hmacKey = await hkdfDerive(master, "hmac-sha256", 32);
    const aesKey = await hkdfAesKey(master);
    return new KeyCrypto(hmacKey, aesKey);
  }

  /** 登记时：HMAC-SHA256(sk-key) → 不可逆指纹（查库优先命中） */
  async hashKey(skKey: string): Promise<string> {
    const sig = await crypto.subtle.sign("HMAC", this.hmacKey, enc.encode(skKey));
    return b64url(new Uint8Array(sig as ArrayBuffer));
  }

  /** 登记时：AES-256-GCM，打包 nonce||ciphertext||tag */
  async sealKey(skKey: string): Promise<Uint8Array> {
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce },
      this.aesKey,
      enc.encode(skKey),
    );
    const packed = new Uint8Array(new ArrayBuffer(nonce.length + ct.byteLength));
    packed.set(nonce, 0);
    packed.set(new Uint8Array(ct), nonce.length);
    return packed;
  }

  /** 调上游时解密原文（唯一用途） */
  async openKey(packed: Uint8Array): Promise<string> {
    const nonce = packed.slice(0, 12);
    const ct = packed.slice(12);
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce },
      this.aesKey,
      ct,
    );
    return dec.decode(pt);
  }
}

/** PBKDF2-SHA256，格式：pbkdf2$<iters>$<b64salt>$<b64hash> */
export const PBKDF2_ITERATIONS = 210_000;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS },
    key,
    256,
  );
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64url(salt)}$${b64url(new Uint8Array(bits))}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iters = Number(parts[1]);
  const salt = b64urlDecode(parts[2]!);
  const expect = b64urlDecode(parts[3]!);
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations: iters },
      key,
      expect.length * 8,
    ),
  );
  if (bits.length !== expect.length) return false;
  let diff = 0;
  for (let i = 0; i < bits.length; i++) diff |= bits[i]! ^ expect[i]!;
  return diff === 0;
}

/** 256bit 随机令牌 → b64url 明文；库存其 SHA-256 哈希 */
export async function generateToken(): Promise<{ plaintext: string; hash: string }> {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const plaintext = b64url(raw);
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(plaintext));
  return { plaintext, hash: b64url(new Uint8Array(digest)) };
}

export async function hashToken(plaintext: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(plaintext));
  return b64url(new Uint8Array(digest));
}

export function randomSkKeyEncryptionSecret(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(32)));
}
