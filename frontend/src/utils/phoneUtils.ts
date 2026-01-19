export function formatPhone(phone: string): string {
  // Remove all non-digits
  let digits = phone.replace(/\D/g, '');

  // Handle Uganda numbers
  if (digits.length === 9 && (digits[0] === '7' || digits[0] === '3')) {
    return '256' + digits;
  }

  if (digits.length === 10 && digits[0] === '0') {
    return '256' + digits.substring(1);
  }

  if (digits.length === 12 && digits.startsWith('256')) {
    return digits;
  }

  // Fallback: return digits (caller should validate)
  return digits;
}

export function validatePhone(phone: string): boolean {
  const formatted = formatPhone(phone);
  // Uganda phone: 256 followed by 9 digits
  return /^256[0-9]{9}$/.test(formatted);
}