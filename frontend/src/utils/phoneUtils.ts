export function formatPhone(phone: string): string {
  // Remove all non-digits
  let digits = phone.replace(/\D/g, '');

  // Handle Uganda numbers
  if (digits.startsWith('0')) {
    digits = '256' + digits.substring(1);
  }
  if (!digits.startsWith('256')) {
    digits = '256' + digits;
  }

  return '+' + digits;
}

export function validatePhone(phone: string): boolean {
  const formatted = formatPhone(phone);
  // Uganda phone: +256 followed by 9 digits
  return /^\+256[0-9]{9}$/.test(formatted);
}