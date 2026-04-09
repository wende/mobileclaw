// Device identity for OpenClaw gateway authentication
// Based on OpenClaw's ui/src/ui/device-identity.ts

import { getPublicKeyAsync, signAsync, utils } from "@noble/ed25519";
import { DEFAULT_GATEWAY_CLIENT_ID, DEFAULT_GATEWAY_CLIENT_MODE, DEFAULT_GATEWAY_SCOPES, normalizeDeviceMetadataForAuth } from "@mc/lib/gatewayClientMetadata";

type StoredIdentity = {
  version: 1;
  deviceId: string;
  publicKey: string;
  privateKey: string;
  createdAtMs: number;
};

export type DeviceIdentity = {
  deviceId: string;
  publicKey: string;
  privateKey: string;
};

const STORAGE_KEY = "mobileclaw-device-identity-v1";

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function base64UrlDecode(input: string): Uint8Array {
  const normalized = input.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function fingerprintPublicKey(publicKey: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", publicKey.slice().buffer);
  return bytesToHex(new Uint8Array(hash));
}

async function generateIdentity(): Promise<DeviceIdentity> {
  const privateKey = utils.randomSecretKey();
  const publicKey = await getPublicKeyAsync(privateKey);
  const deviceId = await fingerprintPublicKey(publicKey);
  return {
    deviceId,
    publicKey: base64UrlEncode(publicKey),
    privateKey: base64UrlEncode(privateKey),
  };
}

export async function loadOrCreateDeviceIdentity(): Promise<DeviceIdentity> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as StoredIdentity;
      if (
        parsed?.version === 1 &&
        typeof parsed.deviceId === "string" &&
        typeof parsed.publicKey === "string" &&
        typeof parsed.privateKey === "string"
      ) {
        const derivedId = await fingerprintPublicKey(base64UrlDecode(parsed.publicKey));
        if (derivedId !== parsed.deviceId) {
          const updated: StoredIdentity = {
            ...parsed,
            deviceId: derivedId,
          };
          localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
          return {
            deviceId: derivedId,
            publicKey: parsed.publicKey,
            privateKey: parsed.privateKey,
          };
        }
        return {
          deviceId: parsed.deviceId,
          publicKey: parsed.publicKey,
          privateKey: parsed.privateKey,
        };
      }
    }
  } catch {
    // fall through to regenerate
  }

  const identity = await generateIdentity();
  const stored: StoredIdentity = {
    version: 1,
    deviceId: identity.deviceId,
    publicKey: identity.publicKey,
    privateKey: identity.privateKey,
    createdAtMs: Date.now(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  return identity;
}

export async function signDevicePayload(privateKeyBase64Url: string, payload: string): Promise<string> {
  const key = base64UrlDecode(privateKeyBase64Url);
  const data = new TextEncoder().encode(payload);
  const sig = await signAsync(data, key);
  return base64UrlEncode(sig);
}

/**
 * Sign a connect challenge, delegating to the native Keychain in iOS mode
 * or using localStorage-based keys in PWA mode.
 */
export async function signConnectChallenge(
  opts: {
    nonce: string;
    token: string | null;
    isNative: boolean;
    platform: string;
    deviceFamily: string;
  },
): Promise<{ id: string; publicKey: string; signature: string; signedAt: number; nonce?: string }> {
  if (opts.isNative) {
    // Delegate to Swift Keychain via bridge — private key never enters JS
    const { requestNativeIdentitySign } = await import("@mc/lib/nativeBridge");
    const result = await requestNativeIdentitySign(opts.nonce, opts.token, opts.platform, opts.deviceFamily);
    return {
      id: result.deviceId,
      publicKey: result.publicKey,
      signature: result.signature,
      signedAt: result.signedAt,
      nonce: opts.nonce,
    };
  }

  // PWA mode — use localStorage-based Ed25519 keys
  const identity = await loadOrCreateDeviceIdentity();
  const signedAtMs = Date.now();
  const payload = buildDeviceAuthPayload({
    deviceId: identity.deviceId,
    clientId: DEFAULT_GATEWAY_CLIENT_ID,
    clientMode: DEFAULT_GATEWAY_CLIENT_MODE,
    role: "operator",
    scopes: [...DEFAULT_GATEWAY_SCOPES],
    signedAtMs,
    token: opts.token,
    nonce: opts.nonce,
    platform: opts.platform,
    deviceFamily: opts.deviceFamily,
  });
  const signature = await signDevicePayload(identity.privateKey, payload);
  return {
    id: identity.deviceId,
    publicKey: identity.publicKey,
    signature,
    signedAt: signedAtMs,
    nonce: opts.nonce,
  };
}

export type DeviceAuthPayloadParams = {
  deviceId: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  signedAtMs: number;
  token: string | null;
  nonce: string;
  platform?: string;
  deviceFamily?: string;
};

export function buildDeviceAuthPayload(params: DeviceAuthPayloadParams): string {
  const scopes = params.scopes.join(",");
  const token = params.token ?? "";
  return [
    "v3",
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    scopes,
    String(params.signedAtMs),
    token,
    params.nonce,
    normalizeDeviceMetadataForAuth(params.platform),
    normalizeDeviceMetadataForAuth(params.deviceFamily),
  ].join("|");
}
