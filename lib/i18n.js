export function tr(lang, ru, en) {
  return lang === 'en' ? en : ru;
}

// Outside a project the language is unknown (`lang` null), and the message carries both texts.
export function pick(lang, ru, en, both = `${en} / ${ru}`) {
  return lang === 'en' ? en : lang === 'ru' ? ru : both;
}
