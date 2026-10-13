// Advert links ride inside the description and can be any scheme: a
// website (https://...), WhatsApp (https://wa.me/... or whatsapp://...),
// or a call link (tel:...) — never https-only.
const LINK_RE = /((?:https?:\/\/|tel:|mailto:|sms:|smsto:|whatsapp:|callto:|skype:|tg:\/\/)[^\s)]+)/i;
const LINK_RE_GLOBAL = /((?:https?:\/\/|tel:|mailto:|sms:|smsto:|whatsapp:|callto:|skype:|tg:\/\/)[^\s)]+)/gi;
const OPENABLE_RE = /^(https?:\/\/|tel:|mailto:|sms:|smsto:|whatsapp:|callto:|skype:|tg:\/\/)/i;

// First link wins (trailing punctuation trimmed).
export function extractAdvertLink(text) {
  const m = String(text || '').match(LINK_RE);
  return m ? m[0].replace(/[.,;!?]+$/, '') : '';
}

// Whether Linking.openURL has a scheme it can hand to the OS.
export function isOpenableAdvertLink(url) {
  return OPENABLE_RE.test(String(url || '').trim());
}

// Captions show description text only — the raw link is never displayed.
export function stripAdvertLinks(text) {
  return String(text || '')
    .replace(LINK_RE_GLOBAL, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
