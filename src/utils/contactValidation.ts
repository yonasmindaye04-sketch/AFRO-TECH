export type ContactFieldName = 'name' | 'email' | 'phone' | 'message';

export interface ContactFormData {
  name: string;
  email: string;
  phone: string;
  message: string;
}

export type ContactFieldErrors = Partial<Record<ContactFieldName, string>>;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_ALLOWED_REGEX = /^[+\d\s().-]+$/;

export function validateContactField(field: ContactFieldName, rawValue: string): string {
  const value = rawValue.trim();

  switch (field) {
    case 'name': {
      if (!value) return 'Full name is required.';
      if (value.length < 2) return 'Name must be at least 2 characters.';
      return '';
    }
    case 'email': {
      if (!value) return 'Email address is required.';
      if (/\s/.test(value)) return 'Email address cannot contain spaces.';
      if (!value.includes('@')) return 'Email must include an "@" symbol (e.g. name@company.com).';
      const [local, domain, ...rest] = value.split('@');
      if (rest.length > 0 || !local) {
        return 'Enter a valid email address with one "@" symbol.';
      }
      if (!domain || !domain.includes('.') || domain.startsWith('.') || domain.endsWith('.')) {
        return 'Enter a valid email domain (e.g. company.com).';
      }
      if (!EMAIL_REGEX.test(value)) {
        return 'Please enter a valid email address (e.g. you@example.com).';
      }
      return '';
    }
    case 'phone': {
      if (!value) return '';
      if (!PHONE_ALLOWED_REGEX.test(value)) {
        return 'Phone number may only contain digits, +, spaces, dashes, or parentheses.';
      }
      const digits = value.replace(/\D/g, '');
      if (digits.length < 7 || digits.length > 15) {
        return 'Enter a valid phone number with 7 to 15 digits.';
      }
      return '';
    }
    case 'message': {
      if (!value) return 'Please describe what you are building.';
      if (value.length < 10) return 'Please enter at least 10 characters so we can understand your project.';
      return '';
    }
  }
}

export function validateContactForm(data: ContactFormData): ContactFieldErrors {
  const errors: ContactFieldErrors = {};
  (Object.keys(data) as ContactFieldName[]).forEach((field) => {
    const msg = validateContactField(field, data[field] ?? '');
    if (msg) errors[field] = msg;
  });
  return errors;
}
