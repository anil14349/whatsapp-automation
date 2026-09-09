import { describe, expect, it } from "vitest";
import {
  generateKeyPairSync,
  publicEncrypt,
  constants as cryptoConstants,
  randomBytes,
  createCipheriv,
  createDecipheriv
} from "node:crypto";
import { decryptFlowRequest, encryptFlowResponse, FlowDecryptionError } from "./flowCrypto";

const PASSPHRASE = "test-passphrase";

function makeKeyPair() {
  return generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem", cipher: "aes-256-cbc", passphrase: PASSPHRASE }
  });
}

/** Simulates what Meta's servers do when calling our endpoint: encrypt an AES key with our public key, encrypt a JSON body with that AES key. */
function encryptRequestLikeMeta(
  publicKeyPem: string,
  payload: Record<string, unknown>,
  aesKey: Buffer,
  iv: Buffer
) {
  const cipher = createCipheriv("aes-128-gcm", aesKey, iv);
  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(payload), "utf8")),
    cipher.final()
  ]);
  const flowData = Buffer.concat([encrypted, cipher.getAuthTag()]);

  const encryptedAesKey = publicEncrypt(
    { key: publicKeyPem, padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    aesKey
  );

  return {
    encrypted_flow_data: flowData.toString("base64"),
    encrypted_aes_key: encryptedAesKey.toString("base64"),
    initial_vector: iv.toString("base64")
  };
}

describe("flowCrypto", () => {
  it("decrypts a request encrypted the way Meta's servers encrypt it", () => {
    const { publicKey, privateKey } = makeKeyPair();
    const aesKey = randomBytes(16);
    const iv = randomBytes(12);
    const payload = { action: "INIT", flow_token: "919999999999", version: "3.0" };

    const body = encryptRequestLikeMeta(publicKey, payload, aesKey, iv);
    const result = decryptFlowRequest(body, privateKey, PASSPHRASE);

    expect(result.payload).toEqual(payload);
    expect(result.aesKey.equals(aesKey)).toBe(true);
    expect(result.initialVector.equals(iv)).toBe(true);
  });

  it("round-trips a response through encryptFlowResponse back to plaintext with the flipped IV", () => {
    const aesKey = randomBytes(16);
    const requestIv = randomBytes(12);
    const responseBody = { version: "3.0", screen: "SELECT_DOCTOR", data: { doctors: [{ id: "1", title: "Dr. A" }] } };

    const encrypted = encryptFlowResponse(responseBody, aesKey, requestIv);
    const raw = Buffer.from(encrypted, "base64");
    const authTag = raw.subarray(raw.length - 16);
    const ciphertext = raw.subarray(0, raw.length - 16);

    const flippedIv = Buffer.alloc(requestIv.length);
    for (let i = 0; i < requestIv.length; i++) flippedIv[i] = requestIv[i]! ^ 0xff;

    const decipher = createDecipheriv("aes-128-gcm", aesKey, flippedIv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

    expect(JSON.parse(decrypted.toString("utf8"))).toEqual(responseBody);
  });

  it("throws FlowDecryptionError when the AES key was wrapped with a different keypair", () => {
    const { privateKey } = makeKeyPair();
    const { publicKey: otherPublicKey } = makeKeyPair();
    const aesKey = randomBytes(16);
    const iv = randomBytes(12);

    const body = encryptRequestLikeMeta(otherPublicKey, { action: "ping" }, aesKey, iv);

    expect(() => decryptFlowRequest(body, privateKey, PASSPHRASE)).toThrow(FlowDecryptionError);
  });

  it("throws FlowDecryptionError when the passphrase is wrong", () => {
    const { publicKey, privateKey } = makeKeyPair();
    const aesKey = randomBytes(16);
    const iv = randomBytes(12);
    const body = encryptRequestLikeMeta(publicKey, { action: "ping" }, aesKey, iv);

    expect(() => decryptFlowRequest(body, privateKey, "wrong-passphrase")).toThrow(FlowDecryptionError);
  });
});
