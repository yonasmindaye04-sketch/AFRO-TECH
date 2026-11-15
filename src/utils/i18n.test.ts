import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LANGUAGES,
  getAllTranslationKeys,
  normalizeLanguage,
  translateKey,
  type LanguageCode,
} from './i18n';

test('normalizeLanguage maps valid and region-tagged codes with English fallback', () => {
  assert.equal(normalizeLanguage('en'), 'en');
  assert.equal(normalizeLanguage('am-ET'), 'am');
  assert.equal(normalizeLanguage('OM_ET'), 'om');
  assert.equal(normalizeLanguage('ti'), 'ti');
  assert.equal(normalizeLanguage('fr'), 'en');
  assert.equal(normalizeLanguage(null), 'en');
});

test('every translation key resolves to a non-empty string in all 4 languages', () => {
  const keys = getAllTranslationKeys();
  assert.ok(keys.length > 40);

  for (const lang of LANGUAGES.map((l) => l.code)) {
    for (const key of keys) {
      const value = translateKey(lang, key);
      assert.equal(typeof value, 'string');
      assert.ok(value.trim().length > 0, `Missing translation for ${lang}:${key}`);
    }
  }
});

test('translateKey returns distinct localized strings across English, Amharic, Oromifa, and Tigrigna', () => {
  const langs: LanguageCode[] = ['en', 'am', 'om', 'ti'];
  const values = new Set(langs.map((l) => translateKey(l, 'nav.contact')));
  assert.equal(values.size, 4);
});
