import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type EncryptedSecret = {
  ciphertext: string;
  nonce: string;
  tag: string;
};

export function encryptSecret(value: string, dataDir?: string): EncryptedSecret {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', resolveSecretKey(dataDir), nonce);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString('base64'),
    nonce: nonce.toString('base64'),
    tag: tag.toString('base64'),
  };
}

export function decryptSecret(secret: EncryptedSecret, dataDir?: string): string {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    resolveSecretKey(dataDir),
    Buffer.from(secret.nonce, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(secret.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(secret.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

function resolveSecretKey(dataDir?: string): Buffer {
  const configuredKey = process.env.MANAGED_AGENTS_SECRET_KEY;
  if (configuredKey) return createHash('sha256').update(configuredKey).digest();

  if (dataDir) {
    const secretsPath = join(dataDir, 'secrets.key');
    if (!existsSync(secretsPath)) {
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(secretsPath, `${randomBytes(32).toString('base64')}\n`, { mode: 0o600 });
    }
    return createHash('sha256').update(readFileSync(secretsPath, 'utf8').trim()).digest();
  }

  return createHash('sha256').update('managed-agents-test-secret-key').digest();
}
