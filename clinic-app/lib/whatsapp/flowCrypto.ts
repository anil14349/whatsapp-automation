import {
  createCipheriv,
  createDecipheriv,
  privateDecrypt,
  constants as cryptoConstants
} from "node:crypto";

/**
 * Implements Meta's WhatsApp Flows "Data Exchange" endpoint encryption
 * contract: https://developers.facebook.com/docs/whatsapp/flows/reference/flowsdataendpoint
 *
 * Every request WhatsApp sends to our Flow endpoint carries an AES key
 * that's itself RSA-encrypted with the public key we uploaded for this
 * phone number, plus the actual screen payload AES-encrypted with that
 * key. Our response has to be re-encrypted with the same AES key (and a
 * bit-flipped IV) rather than plain JSON — this is the one piece of the
 * whole Flow feature that's genuinely fiddly to get right, so it's kept
 * isolated here with its own round-trip test rather than inlined into
 * the route handler.
 *
 * NOT exercised against a live WhatsApp Flow in this environment (no
 * reachable Meta test number) — the round-trip test below proves this
 * module's encrypt/decrypt agree with each other and match the documented
 * algorithm choices (RSA-OAEP/SHA-256, AES-128-GCM), but the only real
 * confirmation this matches what Meta's servers actually send is testing
 * against a live Flow in the Flow Builder's preview. See
 * clinic-app/README.md's WhatsApp Flows section.
 */

export interface EncryptedFlowRequestBody {
  encrypted_flow_data: string;
  encrypted_aes_key: string;
  initial_vector: string;
}

export interface DecryptedFlowRequest {
  /** Parsed JSON body of the actual Flow request (action, screen, data, flow_token, ...). */
  payload: Record<string, unknown>;
  /** Needed to encrypt the response — never logged or persisted. */
  aesKey: Buffer;
  /** The *request's* IV — the response must use the bit-flipped version, not this one directly. */
  initialVector: Buffer;
}

/** Thrown when the AES key can't be unwrapped with our private key — signals Meta should refresh the public key it has on file for us. */
export class FlowDecryptionError extends Error {}

export function decryptFlowRequest(
  body: EncryptedFlowRequestBody,
  privateKeyPem: string,
  passphrase: string
): DecryptedFlowRequest {
  let aesKey: Buffer;

  try {
    aesKey = privateDecrypt(
      {
        key: privateKeyPem,
        passphrase: passphrase || undefined,
        padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256"
      },
      Buffer.from(body.encrypted_aes_key, "base64")
    );
  } catch (error) {
    throw new FlowDecryptionError(
      `Failed to unwrap the AES key with the configured private key: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  const initialVector = Buffer.from(body.initial_vector, "base64");
  const flowDataBuffer = Buffer.from(body.encrypted_flow_data, "base64");

  // Meta appends the 16-byte GCM auth tag to the end of the ciphertext
  // rather than sending it as a separate field.
  const authTag = flowDataBuffer.subarray(flowDataBuffer.length - 16);
  const ciphertext = flowDataBuffer.subarray(0, flowDataBuffer.length - 16);

  let decrypted: Buffer;

  try {
    const decipher = createDecipheriv("aes-128-gcm", aesKey, initialVector);
    decipher.setAuthTag(authTag);
    decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (error) {
    throw new FlowDecryptionError(
      `Failed to decrypt the flow payload: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  return {
    payload: JSON.parse(decrypted.toString("utf8")) as Record<string, unknown>,
    aesKey,
    initialVector
  };
}

function flipBits(buffer: Buffer): Buffer {
  const flipped = Buffer.alloc(buffer.length);
  for (let i = 0; i < buffer.length; i++) {
    flipped[i] = buffer[i]! ^ 0xff;
  }
  return flipped;
}

/**
 * Encrypts a response with the same AES key the request used, but the
 * bit-flipped IV — per Meta's spec, response and request never reuse an
 * identical (key, IV) pair. Returns the raw base64 string to send back as
 * the entire response body (Content-Type: text/plain, NOT wrapped in JSON).
 */
export function encryptFlowResponse(
  responseBody: Record<string, unknown>,
  aesKey: Buffer,
  requestInitialVector: Buffer
): string {
  const responseIv = flipBits(requestInitialVector);
  const cipher = createCipheriv("aes-128-gcm", aesKey, responseIv);

  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(responseBody), "utf8")),
    cipher.final()
  ]);

  return Buffer.concat([encrypted, cipher.getAuthTag()]).toString("base64");
}
