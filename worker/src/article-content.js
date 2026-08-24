function decodeNumericEntity(match, hexValue, decimalValue) {
  const codePoint = Number.parseInt(hexValue || decimalValue, hexValue ? 16 : 10);
  if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return match;
  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return match;
  }
}

export function decodeArticleHtmlEntities(value) {
  return String(value || '')
    .replace(/&#x([0-9a-f]+);/gi, (match, hexValue) => decodeNumericEntity(match, hexValue, ''))
    .replace(/&#(\d+);/g, (match, decimalValue) => decodeNumericEntity(match, '', decimalValue))
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ');
}

function attributeValue(tag, name) {
  const match = String(tag || '').match(new RegExp(`\\b${name}=["']([^"']+)["']`, 'i'));
  return match ? decodeArticleHtmlEntities(match[1]).trim() : '';
}

function isUsableImageUrl(value) {
  const url = String(value || '').trim();
  return !!url
    && !url.startsWith('data:image')
    && !url.toLowerCase().includes('blank')
    && !url.includes('1x1');
}

function plainInlineText(value) {
  return decodeArticleHtmlEntities(value)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>?/g, '')
    .replace(/[\t\r ]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .trim();
}

function imageSource(tag) {
  return attributeValue(tag, 'data-lazy-src')
    || attributeValue(tag, 'data-src')
    || attributeValue(tag, 'src');
}

function captionFromFigure(figureHtml) {
  const match = String(figureHtml || '').match(/<(?:figurecaption|figcaption)\b[^>]*>([\s\S]*?)<\/(?:figurecaption|figcaption)>/i);
  return match ? plainInlineText(match[1]) : '';
}

function addMediaItem(items, seen, url, caption = '') {
  const cleanUrl = String(url || '').trim();
  if (!isUsableImageUrl(cleanUrl)) return;

  const cleanCaption = plainInlineText(caption);
  const existingIndex = seen.get(cleanUrl);
  if (existingIndex !== undefined) {
    if (!items[existingIndex].caption && cleanCaption) items[existingIndex].caption = cleanCaption;
    return;
  }

  seen.set(cleanUrl, items.length);
  items.push({ url: cleanUrl, caption: cleanCaption });
}

export function extractArticleMedia(html) {
  const decodedHtml = decodeArticleHtmlEntities(html);
  const items = [];
  const seen = new Map();
  const figureCaptions = new Map();
  const figureRegex = /<figure\b[^>]*>[\s\S]*?<\/figure>/gi;
  let figureMatch;

  while ((figureMatch = figureRegex.exec(decodedHtml)) !== null) {
    const figureHtml = figureMatch[0];
    const caption = captionFromFigure(figureHtml);
    const imgRegex = /<img\b[^>]*>/gi;
    let imgMatch;
    while ((imgMatch = imgRegex.exec(figureHtml)) !== null) {
      const src = imageSource(imgMatch[0]);
      if (src && caption) figureCaptions.set(src, caption);
    }
  }

  const imgRegex = /<img\b[^>]*>/gi;
  let imgMatch;
  while ((imgMatch = imgRegex.exec(decodedHtml)) !== null) {
    const tag = imgMatch[0];
    const src = imageSource(tag);
    const caption = figureCaptions.get(src) || attributeValue(tag, 'alt');
    addMediaItem(items, seen, src, caption);
  }

  return items;
}

export function prependArticleMedia(media, url, caption = '') {
  const items = [];
  const seen = new Map();
  addMediaItem(items, seen, url, caption);
  for (const item of Array.isArray(media) ? media : []) {
    if (typeof item === 'string') addMediaItem(items, seen, item, '');
    else addMediaItem(items, seen, item?.url || item?.src, item?.caption || item?.alt || '');
  }
  return items;
}

export function appendArticleMedia(media, url, caption = '') {
  const items = [];
  const seen = new Map();
  for (const item of Array.isArray(media) ? media : []) {
    if (typeof item === 'string') addMediaItem(items, seen, item, '');
    else addMediaItem(items, seen, item?.url || item?.src, item?.caption || item?.alt || '');
  }
  addMediaItem(items, seen, url, caption);
  return items;
}

export function articleTextFromHtml(html) {
  return decodeArticleHtmlEntities(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<figure\b[^>]*>[\s\S]*?<\/figure>/gi, '\n\n')
    .replace(/<img\b[^>]*>/gi, '')
    .replace(/<\/(p|div|h[1-6]|blockquote|backquote|li|ul|ol|section|article)>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>?/g, '')
    .replace(/[\t\r ]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
}

export function stripArticleMediaHtml(html) {
  return decodeArticleHtmlEntities(html)
    .replace(/<figure\b[^>]*>[\s\S]*?<\/figure>/gi, '\n\n')
    .replace(/<img\b[^>]*>/gi, '');
}
