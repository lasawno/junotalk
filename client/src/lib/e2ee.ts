const ECDH_PARAMS: EcKeyGenParams = { name: "ECDH", namedCurve: "P-256" };
const AES_PARAMS = { name: "AES-GCM", length: 256 };
const IV_BYTES = 12;

export interface E2EEKeyPair {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  publicKeyJwk: JsonWebKey;
}

export async function generateKeyPair(): Promise<E2EEKeyPair> {
  const kp = await crypto.subtle.generateKey(ECDH_PARAMS, true, ["deriveKey", "deriveBits"]);
  const publicKeyJwk = await crypto.subtle.exportKey("jwk", kp.publicKey);
  return { publicKey: kp.publicKey, privateKey: kp.privateKey, publicKeyJwk };
}

export async function importPublicKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey("jwk", jwk, ECDH_PARAMS, true, []);
}

export async function deriveSharedKey(
  privateKey: CryptoKey,
  peerPublicKey: CryptoKey
): Promise<CryptoKey> {
  const bits = await crypto.subtle.deriveBits(
    { name: "ECDH", public: peerPublicKey },
    privateKey,
    256
  );
  const rawKey = await crypto.subtle.importKey("raw", bits, { name: "HKDF" }, false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: new TextEncoder().encode("junotalk-e2ee") },
    rawKey,
    AES_PARAMS,
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptMessage(sharedKey: CryptoKey, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, sharedKey, encoded);
  const combined = new Uint8Array(IV_BYTES + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), IV_BYTES);
  return btoa(String.fromCharCode(...combined));
}

export async function decryptMessage(sharedKey: CryptoKey, encrypted: string): Promise<string> {
  const raw = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));
  const iv = raw.slice(0, IV_BYTES);
  const ciphertext = raw.slice(IV_BYTES);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, sharedKey, ciphertext);
  return new TextDecoder().decode(decrypted);
}
