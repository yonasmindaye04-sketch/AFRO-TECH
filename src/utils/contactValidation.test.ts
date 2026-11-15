import test from 'node:test';
import assert from 'node:assert/strict';
import { validateContactField, validateContactForm } from './contactValidation';

test('validateContactField catches missing required fields', () => {
  assert.equal(validateContactField('name', '   '), 'Full name is required.');
  assert.equal(validateContactField('email', ''), 'Email address is required.');
  assert.equal(validateContactField('message', '  '), 'Please describe what you are building.');
  assert.equal(validateContactField('phone', ''), '');
});

test('validateContactField returns specific email format error messages', () => {
  assert.match(validateContactField('email', 'notanemail'), /"@"/);
  assert.match(validateContactField('email', 'user@'), /domain/i);
  assert.match(validateContactField('email', 'user@domain'), /domain/i);
  assert.match(validateContactField('email', 'bad email@domain.com'), /spaces/i);
  assert.equal(validateContactField('email', 'nahom@afrotech.et'), '');
});

test('validateContactField validates optional phone numbers and minimum lengths', () => {
  assert.match(validateContactField('name', 'A'), /at least 2/i);
  assert.match(validateContactField('message', 'Hi there'), /at least 10/i);
  assert.match(validateContactField('phone', 'abc-123'), /digits/i);
  assert.match(validateContactField('phone', '1234'), /7 to 15/i);
  assert.equal(validateContactField('phone', '+251 910 011 818'), '');
});

test('validateContactForm validates entire submission cleanly', () => {
  const invalid = validateContactForm({
    name: '',
    email: 'invalid',
    phone: '123',
    message: 'short',
  });
  assert.equal(Object.keys(invalid).length, 4);

  const valid = validateContactForm({
    name: 'Nahom Eshetu',
    email: 'nahom@asellaorganic.et',
    phone: '',
    message: 'We need a custom inventory and accounting ERP system.',
  });
  assert.deepEqual(valid, {});
});
