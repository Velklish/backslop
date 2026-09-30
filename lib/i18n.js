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

// The message in the project language, keyed by its English text; a key missing from
// templates/i18n/ru.mjs falls back to the English.
export function msg(lang, en, params = {}) {
  return lang === 'en' ? render(null, en, params, 'en') : render(RU.messages, en, params, 'ru');
}

// The same outside a project: with `lang` null the message carries both texts.
export function msgBoth(lang, en, params = {}) {
  if (lang === 'en' || lang === 'ru') return msg(lang, en, params);
  if (Object.hasOwn(RU.both, en)) return render(RU.both, en, params, null);
  return `${msg('en', en, params)} / ${msg('ru', en, params)}`;
}
