#!/usr/bin/env python3
import json
import re
import statistics
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET
from collections import Counter
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html import unescape
from html.parser import HTMLParser

FEED_URL = 'https://www.inmediahk.net/frontpage/js/rss.xml'
METRO_API = 'https://news-proxy.maxyu725us.workers.dev/api/news/latest?page={page}'
USER_AGENT = 'MetroNews-NS2A-Probe/1.0 (+https://github.com/MaxYu725/News_Metro_App)'
CONTENT_NS = '{http://purl.org/rss/1.0/modules/content/}encoded'


class TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.images = []
        self.skip_depth = 0

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag in {'script', 'style'}:
            self.skip_depth += 1
        if tag == 'img':
            attrs = dict(attrs)
            src = attrs.get('src') or attrs.get('data-src') or ''
            if src:
                self.images.append(src)
        if tag in {'p', 'br', 'li', 'h1', 'h2', 'h3', 'h4', 'blockquote'} and self.parts:
            self.parts.append('\n')

    def handle_endtag(self, tag):
        tag = tag.lower()
        if tag in {'script', 'style'} and self.skip_depth:
            self.skip_depth -= 1
        if tag in {'p', 'li', 'h1', 'h2', 'h3', 'h4', 'blockquote'}:
            self.parts.append('\n')

    def handle_data(self, data):
        if not self.skip_depth:
            self.parts.append(data)

    def text(self):
        text = unescape(''.join(self.parts))
        text = re.sub(r'[\t\r ]+', ' ', text)
        text = re.sub(r'\n\s*\n+', '\n', text)
        return text.strip()


def fetch(url, timeout=25):
    req = urllib.request.Request(
        url,
        headers={
            'User-Agent': USER_AGENT,
            'Accept': 'application/rss+xml, application/xml, text/xml, application/json, text/html;q=0.9, */*;q=0.5',
            'Accept-Language': 'zh-HK,zh-TW;q=0.9,en;q=0.6',
        },
    )
    started = time.monotonic()
    with urllib.request.urlopen(req, timeout=timeout) as response:
        body = response.read()
        return {
            'status': response.status,
            'url': response.geturl(),
            'content_type': response.headers.get('Content-Type', ''),
            'bytes': len(body),
            'elapsed_ms': round((time.monotonic() - started) * 1000),
            'body': body,
        }


def parse_date(value):
    if not value:
        return None
    try:
        dt = parsedate_to_datetime(value)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None


def analyze_feed(xml_bytes):
    root = ET.fromstring(xml_bytes)
    items = root.findall('.//item')
    analyzed = []
    for item in items:
        title = (item.findtext('title') or '').strip()
        link = (item.findtext('link') or '').strip()
        pub_date = (item.findtext('pubDate') or '').strip()
        description = item.findtext('description') or ''
        content = item.findtext(CONTENT_NS) or ''
        html = content if len(content.strip()) >= len(description.strip()) else description
        extractor = TextExtractor()
        extractor.feed(html)
        body_text = extractor.text()
        categories = sorted({(node.text or '').strip() for node in item.findall('category') if (node.text or '').strip()})
        analyzed.append({
            'title': title,
            'link': link,
            'pubDate': pub_date,
            'pubDateUtc': parse_date(pub_date).isoformat() if parse_date(pub_date) else None,
            'bodyChars': len(body_text),
            'bodyPreview': body_text[:180],
            'imageCount': len(extractor.images),
            'firstImage': extractor.images[0] if extractor.images else None,
            'categories': categories,
            'usesContentEncoded': bool(content.strip()),
        })
    return analyzed


def title_ngrams(title):
    normalized = re.sub(r'[\W_\s]+', '', title, flags=re.UNICODE)
    if len(normalized) < 2:
        return {normalized} if normalized else set()
    return {normalized[i:i+2] for i in range(len(normalized) - 1)}


def similarity(a, b):
    aa, bb = title_ngrams(a), title_ngrams(b)
    if not aa or not bb:
        return 0.0
    return len(aa & bb) / len(aa | bb)


def load_hk01_latest(max_pages=5):
    rows = []
    errors = []
    for page in range(max_pages):
        try:
            result = fetch(METRO_API.format(page=page), timeout=20)
            payload = json.loads(result['body'].decode('utf-8'))
            batch = payload.get('data') or []
            rows.extend(batch)
            if not payload.get('hasMore') or not batch:
                break
        except Exception as exc:
            errors.append(f'page {page}: {exc}')
            break
    return rows, errors


def probe_article_pages(items, limit=6):
    probes = []
    for row in items[:limit]:
        entry = {'title': row['title'], 'url': row['link']}
        try:
            result = fetch(row['link'], timeout=25)
            html = result['body'].decode('utf-8', errors='replace')
            entry.update({
                'status': result['status'],
                'finalUrl': result['url'],
                'bytes': result['bytes'],
                'elapsedMs': result['elapsed_ms'],
                'contentType': result['content_type'],
                'looksBlocked': any(token in html.lower() for token in ['cf-chl-', 'captcha', 'access denied', 'attention required']),
                'titlePresent': row['title'][:12] in html if row['title'] else False,
            })
        except Exception as exc:
            entry.update({'error': str(exc), 'looksBlocked': True})
        probes.append(entry)
    return probes


def percentile(values, fraction):
    if not values:
        return 0
    ordered = sorted(values)
    idx = round((len(ordered) - 1) * fraction)
    return ordered[idx]


def main():
    attempts = []
    snapshots = []
    for index in range(3):
        try:
            result = fetch(FEED_URL)
            items = analyze_feed(result['body'])
            attempts.append({
                'attempt': index + 1,
                'status': result['status'],
                'bytes': result['bytes'],
                'elapsedMs': result['elapsed_ms'],
                'contentType': result['content_type'],
                'itemCount': len(items),
            })
            snapshots.append(items)
        except Exception as exc:
            attempts.append({'attempt': index + 1, 'error': str(exc)})
        if index < 2:
            time.sleep(2)

    successful = [x for x in snapshots if x]
    if not successful:
        print(json.dumps({'feedAttempts': attempts}, ensure_ascii=False, indent=2))
        return 2

    items = successful[-1]
    body_lengths = [row['bodyChars'] for row in items]
    image_rows = [row for row in items if row['imageCount'] > 0]
    content_encoded_rows = [row for row in items if row['usesContentEncoded']]
    category_counts = Counter(cat for row in items for cat in row['categories'])
    parsed_dates = [parse_date(row['pubDate']) for row in items]
    parsed_dates = [dt for dt in parsed_dates if dt]
    latest = max(parsed_dates) if parsed_dates else None
    now = datetime.now(timezone.utc)

    hk01_rows, hk01_errors = load_hk01_latest()
    overlap = []
    for row in items[:30]:
        best = None
        best_score = 0.0
        for candidate in hk01_rows:
            score = similarity(row['title'], candidate.get('title', ''))
            if score > best_score:
                best_score = score
                best = candidate
        if best and best_score >= 0.22:
            overlap.append({
                'inmediaTitle': row['title'],
                'hk01Title': best.get('title'),
                'score': round(best_score, 3),
                'hk01PubDate': best.get('pubDate'),
            })
    overlap.sort(key=lambda x: x['score'], reverse=True)

    page_probes = probe_article_pages(items)
    page_ok = [p for p in page_probes if p.get('status') == 200 and not p.get('looksBlocked')]

    metrics = {
        'itemCount': len(items),
        'latestPubDateUtc': latest.isoformat() if latest else None,
        'latestAgeHours': round((now - latest).total_seconds() / 3600, 2) if latest else None,
        'bodyChars': {
            'min': min(body_lengths) if body_lengths else 0,
            'p25': percentile(body_lengths, 0.25),
            'median': round(statistics.median(body_lengths)) if body_lengths else 0,
            'p75': percentile(body_lengths, 0.75),
            'max': max(body_lengths) if body_lengths else 0,
            'mean': round(statistics.mean(body_lengths)) if body_lengths else 0,
            'gte500Rate': round(sum(v >= 500 for v in body_lengths) / len(body_lengths), 3) if body_lengths else 0,
            'gte1000Rate': round(sum(v >= 1000 for v in body_lengths) / len(body_lengths), 3) if body_lengths else 0,
        },
        'imageCoverageRate': round(len(image_rows) / len(items), 3) if items else 0,
        'contentEncodedCoverageRate': round(len(content_encoded_rows) / len(items), 3) if items else 0,
        'categoryCounts': dict(category_counts.most_common()),
        'articlePageReachability': {
            'sampled': len(page_probes),
            'ok': len(page_ok),
            'blockedOrFailed': len(page_probes) - len(page_ok),
        },
        'hk01Comparison': {
            'rowsRead': len(hk01_rows),
            'errors': hk01_errors,
            'candidateOverlapCountAt022': len(overlap),
            'topMatches': overlap[:12],
        },
    }

    recommendation_checks = {
        'feedStable3of3': len(successful) == 3,
        'enoughItems': len(items) >= 10,
        'freshWithin72h': metrics['latestAgeHours'] is not None and metrics['latestAgeHours'] <= 72,
        'medianBodyAtLeast500': metrics['bodyChars']['median'] >= 500,
        'halfArticlesAtLeast500': metrics['bodyChars']['gte500Rate'] >= 0.5,
        'imageCoverageAtLeast50pct': metrics['imageCoverageRate'] >= 0.5,
        'sampleArticlePagesReachable': len(page_probes) > 0 and len(page_ok) == len(page_probes),
    }

    report = {
        'source': '香港獨立媒體 InMediaHK',
        'feed': FEED_URL,
        'checkedAtUtc': now.isoformat(),
        'feedAttempts': attempts,
        'metrics': metrics,
        'checks': recommendation_checks,
        'allRecommendationChecksPass': all(recommendation_checks.values()),
        'sampleItems': items[:10],
        'articlePageProbes': page_probes,
    }

    with open('inmedia-probe-report.json', 'w', encoding='utf-8') as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)

    print('=== NS2A InMedia upstream probe ===')
    print(json.dumps(report, ensure_ascii=False, indent=2))

    # Fail only on technical unusability. Editorial suitability is reported as evidence.
    technical_ok = len(successful) >= 2 and len(items) >= 5 and len(page_ok) >= max(1, len(page_probes) - 1)
    return 0 if technical_ok else 1


if __name__ == '__main__':
    sys.exit(main())
