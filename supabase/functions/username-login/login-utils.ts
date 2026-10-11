const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const usernamePattern = /^[\p{L}\p{M}\p{N}._+-]{3,64}$/u;

export function normalizeLoginIdentifier(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('en-US');
}

export function isValidLoginIdentifier(value: string): boolean {
  const normalized = normalizeLoginIdentifier(value);
  return emailPattern.test(normalized) || usernamePattern.test(normalized);
}

export function isEmailLoginIdentifier(value: string): boolean {
  return emailPattern.test(normalizeLoginIdentifier(value));
}
