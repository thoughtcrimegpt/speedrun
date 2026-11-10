// Speedrun privacy filter. Everything shown on the page passes through scrub(), as a safety net
// behind the write-up instructions: no emails, phone numbers, amounts of money or street
// addresses, and none of your own private words.
//
// Your private words live in private-terms.txt (git ignores it): one per line, optionally
// "term => replacement". Without a replacement the word becomes "(private)".

import fs from 'node:fs';
import { TERMS_FILE } from './config.mjs';

/** [[term, replacement], ...] from private-terms.txt. */
export function privateTerms() {
  const out = [];
  try {
    for (const line of fs.readFileSync(TERMS_FILE, 'utf8').split('\n')) {
      const t = line.replace(/#.*$/, '').trim();
      if (!t) continue;
      const [term, rep] = t.split('=>').map((s) => s.trim());
      if (term) out.push([term, rep || '(private)']);
    }
  } catch { /* no list yet */ }
  return out;
}

let cached = null, cachedAt = 0;
function terms() {
  if (cached && Date.now() - cachedAt < 10 * 60_000) return cached;
  const seen = new Set();
  cached = privateTerms()
    .filter(([t]) => { const k = t.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => b[0].length - a[0].length)
    .map(([t, rep]) => [new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}(?:'s)?\\b`, 'gi'), rep]);
  cachedAt = Date.now();
  return cached;
}

const STREET = '(?:Road|Rd|Drive|Dr|Street|St|Avenue|Ave|Lane|Ln|Place|Pl|Way|Court|Ct|Boulevard|Blvd|Circle|Cir|Trail|Trl|Loop|Terrace|Ter|Parkway|Pkwy)';

export function scrub(text) {
  let s = String(text || '');
  s = s.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '(email)');
  s = s.replace(/\(?\b\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g, '(phone)');
  s = s.replace(/[$€£]\s?\d[\d,]*(?:\.\d+)?\s?(?:k|K|M|MM|million|thousand|mil)?\b/g, '(amount)');
  s = s.replace(/\b\d[\d,.]*\s?(?:million|thousand)\s?(?:dollars?|euros?|pounds?)?\b/gi, '(amount)');
  // A street address: a number, then a compass letter or a street word ("4321 N Sample Road").
  s = s.replace(new RegExp(`\\b\\d{2,6}\\s+(?:[NSEW]\\.?\\s+)?(?:[A-Z][\\w']*\\.?\\s+){0,4}(?:${STREET}|[A-Z][\\w']+)\\b`, 'g'), (m) => (/^\d{2,6}\s+([NSEW]\.?\s+)/.test(m) || new RegExp(`\\b${STREET}\\b`).test(m) ? 'an address' : m));
  for (const [re, rep] of terms()) s = s.replace(re, rep);
  s = s.replace(/—/g, ', ');
  return s.replace(/(\(private\))(\s+\(private\))+/g, '$1').replace(/\s{2,}/g, ' ').trim();
}

/** What would still be caught in already-scrubbed text (for the self-check). */
export function leaks(text) {
  const s = String(text || '');
  const hits = [];
  for (const [re] of terms()) { re.lastIndex = 0; const m = s.match(re); if (m) hits.push(m[0]); }
  for (const re of [/[\w.+-]+@[\w-]+\.[\w.-]+/, /[$€£]\s?\d/, /\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/, /\b\d{3,6}\s+[NSEW]\.?\s+[A-Z]/, /—/]) {
    const m = s.match(re); if (m) hits.push(m[0]);
  }
  return hits;
}
