// Capability taxonomy + accent-insensitive intent detection shared by classification and search.
import fs from 'node:fs';
import path from 'node:path';
import { CORE_ROOT } from './paths.mjs';

const TAX = JSON.parse(fs.readFileSync(path.join(CORE_ROOT, 'data', 'taxonomy.json'), 'utf8'));
export const CAPABILITIES = TAX.capabilities;
export const CAP_BY_ID = new Map(CAPABILITIES.map(c => [c.id, c]));

export function fold(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function tokens(s) {
  return fold(s).split(/[^a-z0-9.+#-]+/).map(t => t.replace(/^[.-]+|[.-]+$/g, '')).filter(Boolean);
}

const STOP = new Set(['a', 'o', 'as', 'os', 'de', 'da', 'do', 'das', 'dos', 'e', 'em', 'um', 'uma', 'para', 'com', 'que', 'no', 'na', 'por', 'the', 'an', 'of', 'for', 'to', 'and', 'in', 'on', 'with', 'my', 'i', 'me', 'need', 'want', 'preciso', 'quero', 'faz', 'fazer', 'cria', 'criar', 'find', 'encontrar', 'encontra', 'uma', 'tool', 'ferramenta', 'library', 'biblioteca', 'is', 'this', 'este', 'esta', 'how', 'como', 'tem', 'have', 'use', 'usar', 'good', 'best', 'melhor']);

export function contentTokens(s) {
  return tokens(s).filter(t => !STOP.has(t) && t.length > 1);
}

// Phrase match on token boundaries so "ios" doesn't fire inside "studios".
function hasPhrase(foldedPadded, phrase) {
  const p = ' ' + tokens(phrase).filter(t => !STOP.has(t)).join(' ') + ' ';
  return p.trim() && foldedPadded.includes(p);
}

export function detectCapabilities(text) {
  const padded = ' ' + tokens(text).filter(t => !STOP.has(t)).join(' ') + ' ';
  const hits = [];
  for (const c of CAPABILITIES) {
    const matched = c.keywords.filter(k => hasPhrase(padded, k));
    if (matched.length) {
      const weight = matched.reduce((w, k) => w + tokens(k).length, 0);
      hits.push({ id: c.id, label: c.label, domain: c.domain, matched, weight });
    }
  }
  return hits.sort((a, b) => b.weight - a.weight);
}

// PT/EN expansions used for full-text recall (not for capability inference).
export const SYNONYMS = {
  animacao: ['animation'], animacoes: ['animation'], depurar: ['debug'], erro: ['error', 'bug'], testes: ['testing', 'test'], teste: ['test'],
  seguranca: ['security'], documentacao: ['documentation', 'docs'], acessibilidade: ['accessibility', 'a11y'], a11y: ['accessibility'],
  navegador: ['browser'], vidro: ['glass'], memoria: ['memory'], video: ['video'], audio: ['audio'], firmware: ['firmware'],
  componente: ['component'], componentes: ['components'], fundo: ['background'], texto: ['text'], biblioteca: ['library'],
  r3f: ['react-three-fiber', 'three'], gsap: ['greensock'], re: ['reverse'], cad: ['cad', 'parametric'], ia: ['ai'],
  pdf: ['pdf', 'document'], transcricao: ['transcription', 'speech'], voz: ['voice', 'speech'], fila: ['queue'],
};
