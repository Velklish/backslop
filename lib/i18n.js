import * as RU from '../templates/i18n/ru.mjs';

// The Russian localization of the CLI; its help text and parser words are read through this name.
export { RU };

// `{name}` takes `params.name`, and a function param is called with the language of the text;
// a name the params do not carry stays as written.
function render(table, en, params, lang) {
  const values = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, typeof v === 'function' ? v(lang) : v]));
  const text = table && Object.hasOwn(table, en) ? table[en] : en;
  if (typeof text === 'function') return text(values);
  return text.replace(/\{([A-Za-z_$][\w$]*)\}/g, (m, name) => (Object.hasOwn(values, name) ? String(values[name]) : m));
}

// Only `ru` uses the Russian entry; an unknown language uses English.
// A key missing from templates/i18n/ru.mjs falls back to English.
export function msg(lang, en, params = {}) {
  return lang === 'ru' ? render(RU.messages, en, params, 'ru') : render(null, en, params, 'en');
}
