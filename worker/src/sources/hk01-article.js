import {
  appendArticleMedia,
  articleTextFromHtml,
} from '../article-content.js';

function tokenText(value) {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(tokenText).join('');
  if (!value || typeof value !== 'object') return '';

  for (const key of ['content', 'text', 'value', 'children']) {
    if (value[key] !== undefined) return tokenText(value[key]);
  }
  return '';
}

function tokenParagraphs(htmlTokens) {
  if (!Array.isArray(htmlTokens)) return [];
  return htmlTokens
    .map(row => tokenText(row).replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function cleanBlockText(value) {
  if (Array.isArray(value)) {
    return value
      .map(item => cleanBlockText(item))
      .filter(Boolean)
      .join('\n\n');
  }
  if (typeof value !== 'string') return '';
  return articleTextFromHtml(value);
}

function blockParagraphs(block) {
  const type = String(block?.blockType || block?.type || '').toLowerCase();
  if (type === 'summary') return cleanBlockText(block.summary).split(/\n\s*\n/).filter(Boolean);
  if (!['text', 'html', 'p', 'paragraph', 'heading', 'quote', 'blockquote'].includes(type)) return [];

  const tokenRows = tokenParagraphs(block.htmlTokens);
  if (tokenRows.length > 0) return tokenRows;

  const text = cleanBlockText(block.html || block.content || block.text || block.value || '');
  return text ? text.split(/\n\s*\n/).filter(Boolean) : [];
}

function imageUrl(image) {
  return image?.cdnUrl || image?.url || image?.src || image?.imageUrl || '';
}

function appendImage(media, image) {
  return appendArticleMedia(
    media,
    imageUrl(image),
    image?.caption || image?.description || image?.alt || '',
  );
}

function articleRoot(payload) {
  return payload?.article
    || payload?.data?.article
    || payload?.data?.articleData
    || payload?.data
    || null;
}

export function parseHk01ArticlePayload(payload) {
  const article = articleRoot(payload);
  if (!article || typeof article !== 'object') return { content: '', media: [] };

  const paragraphs = [];
  let media = [];
  const hero = article.originalImage || article.mainImage;
  if (hero) media = appendImage(media, hero);

  const leadText = cleanBlockText(article.teaser || article.description || '');
  for (const paragraph of leadText.split(/\n\s*\n/).filter(Boolean)) {
    const clean = paragraph.trim();
    if (clean && paragraphs.at(-1) !== clean) paragraphs.push(clean);
  }

  const blocks = Array.isArray(article.blocks) ? article.blocks : [];
  for (const block of blocks) {
    const type = String(block?.blockType || block?.type || '').toLowerCase();

    if (type === 'image') {
      media = appendImage(media, block.image || block);
      continue;
    }

    if (type === 'gallery') {
      for (const image of Array.isArray(block.images) ? block.images : []) {
        media = appendImage(media, image);
      }
      continue;
    }

    for (const paragraph of blockParagraphs(block)) {
      const clean = paragraph.trim();
      if (clean && paragraphs.at(-1) !== clean) paragraphs.push(clean);
    }
  }

  return { content: paragraphs.join('\n\n'), media };
}
