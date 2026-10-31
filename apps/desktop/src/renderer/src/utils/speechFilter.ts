/**
 * AURA Voice Engine Speech Sanitizer
 *
 * Guarantees that the local Text-to-Speech engine never speaks aloud:
 * - Internal reasoning or chain-of-thought (<think>...</think>)
 * - Fenced code blocks (```...```)
 * - JSON tool-call objects ({...})
 * - Raw URLs and markdown formatting symbols
 */
export function cleanTextForSpeech(text: string): string {
  if (!text) return '';

  let cleaned = text;

  // 1. Remove thinking / reasoning tags (<think>...</think> or <reasoning>...</reasoning>)
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '');
  cleaned = cleaned.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '');

  // 2. Remove fenced code blocks (```lang ... ```)
  cleaned = cleaned.replace(/```[\s\S]*?```/g, '');

  // 3. Convert markdown links [text](url) -> text
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  // 4. Remove raw URLs
  cleaned = cleaned.replace(/https?:\/\/\S+/gi, '');

  // 5. Remove JSON objects and arrays (including nested JSON structures)
  for (let i = 0; i < 6; i++) {
    cleaned = cleaned.replace(/\{[^{}]*\}/g, '');
  }

  // 6. Convert inline code `word` -> word
  cleaned = cleaned.replace(/`([^`]+)`/g, '$1');
  cleaned = cleaned.replace(/`+/g, '');

  // 7. Remove markdown headers, list markers, and blockquotes
  cleaned = cleaned.replace(/^[ \t]*[#*+->]+[ \t]*/gm, '');

  // 8. Remove markdown formatting markers (*, _, ~, #)
  cleaned = cleaned.replace(/[*_~#]/g, '');

  // 9. Remove decorative brackets or symbols
  cleaned = cleaned.replace(/[|\^\\<>]/g, '');

  // 10. Normalize whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  return cleaned;
}
