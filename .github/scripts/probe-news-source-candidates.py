#!/usr/bin/env python3
import json
import re
import statistics
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html import unescape
from html.parser import HTMLParser

USER_AGENT = 'MetroNews-NS2A-Candidate-Probe/1.0 (+https://github.com/MaxYu725/News_Metro_App)'
CONTENT_NS = '{http://purl.org/rss/1.0/modules/content/}encoded'
CANDIDATES = [
    {
        'id': 'bastillepost',
        'name': '巴士的報',
        'feeds': [
            'https://www.bastillepost.com/hongkong/feed',
            'https://www.bastillepost.com/hongkong/feed/',
        ],
    },
    {
        'id': 'oriental',
        'name': '東方日報',
        'feeds': ['https://orientaldaily.on.cc/rss/news.xml'],
    },
    {
        'id': 'stheadline',
        'name': '星島頭條',
        'feeds': ['https://www.stheadline.com/rss'],
    },
    {
        'id': 'litenews',
        'name': '香港輕新聞',
        'feeds': ['https://www.litenews.hk/feed/'],
    },
]


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
        if tag in {'p', 'br', 'li', 'h1', 'h2', 'h3', 'h4', 'blockquote'}:
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
            'Accept': 'application/rss+xml, application/xml, text/xml, application/atom+xml, text/html;q=0.9, */*;q=0.5',
            'Accept-Language': 'zh-HK,zh-TW;q=0.9,en;q=0.6',
        },
    )
    start = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            body = response.read()
            return {
                'ok': True,
                'status': response.status,
                'finalUrl': response.geturl(),
                'contentType': response.headers.get('Content-Type', ''),
                'bytes': len(body),
                'elapsedMs': round((time.monotonic() - start) * 1000),
                'body': body,
            }
    except Exception as exc:
        return {
            'ok': False,
            'error': str(exc),
            'elapsedMs': round((time.monotonic() - start) * 1000),
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
        try:
            dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc)
        except Exception:
            return None


def node_text(item, names):
    for name in names:
        node = item.find(name)
        if node is not None and node.text:
            return node.text.strip()
    return ''


def parse_feed(body):
    root = ET.fromstring(body)
    items = root.findall('.//item')
    if not items:
        atom_ns = '{http://www.w3.org/2005/Atom}'
        entries = root.findall(f'.//{atom_ns}entry')
        parsed = []
        for entry in entries:
            title = node_text(entry, [f'{atom_ns}title'])
            link_node = entry.find(f'{atom_ns}link')
            link = link_node.attrib.get('href', '') if link_node is not None else ''
            published = node_text(entry, [f'{atom_ns}published', f'{atom_ns}updated'])
            summary = node_text(entry, [f'{atom_ns}content', f'{atom_ns}summary'])
            extractor = TextExtractor(); extractor.feed(summary)
            parsed.append({
                'title': title, 'link': link, 'pubDate': published,
                'bodyChars': len(extractor.text()), 'imageCount': len(extractor.images),
                'usesContentEncoded': bool(summary.strip()),
            })
        return parsed

    parsed = []
    for item in items:
        title = node_text(item, ['title'])
        link = node_text(item, ['link'])
        pub = node_text(item, ['pubDate', '{http://purl.org/dc/elements/1.1/}date'])
        description = item.findtext('description') or ''
        content = item.findtext(CONTENT_NS) or ''
        html = content if len(content.strip()) >= len(description.strip()) else description
        extractor = TextExtractor(); extractor.feed(html)
        parsed.append({
            'title': title,
            'link': link,
            'pubDate': pub,
            'bodyChars': len(extractor.text()),
            'imageCount': len(extractor.images),
            'usesContentEncoded': bool(content.strip()),
        })
    return parsed


def article_body_chars(html):
    # Many publishers expose full text in JSON-LD; use this as a low-noise signal.
    patterns = [
        r'"articleBody"\s*:\s*"((?:\\.|[^"\\])*)"',
        r'"description"\s*:\s*"((?:\\.|[^"\\])*)"',
    ]
    best = ''
    for pattern in patterns:
        for match in re.findall(pattern, html, flags=re.I | re.S):
            try:
                text = json.loads('"' + match + '"')
            except Exception:
                text = match
            if len(text) > len(best):
                best = text
    return len(best)


def looks_blocked(html):
    lower = html.lower()
    signals = ['cf-chl-', 'captcha', 'access denied', 'attention required', 'enable javascript and cookies to continue']
    return any(token in lower for token in signals)


def probe_candidate(candidate):
    feed_attempts = []
    selected = None
    items = []
    for url in candidate['feeds']:
        result = fetch(url)
        attempt = {k: v for k, v in result.items() if k != 'body'}
        attempt['url'] = url
        if result.get('ok'):
            try:
                parsed = parse_feed(result['body'])
                attempt['itemCount'] = len(parsed)
                if parsed and selected is None:
                    selected = url
                    items = parsed
            except Exception as exc:
                attempt['parseError'] = str(exc)
        feed_attempts.append(attempt)

    dates = [parse_date(row['pubDate']) for row in items]
    dates = [d for d in dates if d]
    latest = max(dates) if dates else None
    now = datetime.now(timezone.utc)
    body_lengths = [row['bodyChars'] for row in items]
    article_probes = []
    for row in [r for r in items if r.get('link')][:5]:
        response = fetch(row['link'])
        probe = {'title': row['title'], 'url': row['link']}
        probe.update({k: v for k, v in response.items() if k != 'body'})
        if response.get('ok'):
            html = response['body'].decode('utf-8', errors='replace')
            probe['looksBlocked'] = looks_blocked(html)
            probe['jsonLdBodyChars'] = article_body_chars(html)
            probe['titlePresent'] = row['title'][:10] in html if row['title'] else False
        article_probes.append(probe)

    accessible_pages = [p for p in article_probes if p.get('ok') and p.get('status') == 200 and not p.get('looksBlocked')]
    return {
        'id': candidate['id'],
        'name': candidate['name'],
        'selectedFeed': selected,
        'feedAttempts': feed_attempts,
        'metrics': {
            'itemCount': len(items),
            'latestPubDateUtc': latest.isoformat() if latest else None,
            'latestAgeHours': round((now - latest).total_seconds() / 3600, 1) if latest else None,
            'medianFeedBodyChars': round(statistics.median(body_lengths)) if body_lengths else 0,
            'meanFeedBodyChars': round(statistics.mean(body_lengths)) if body_lengths else 0,
            'feedBodyGte500Rate': round(sum(x >= 500 for x in body_lengths) / len(body_lengths), 3) if body_lengths else 0,
            'feedImageCoverageRate': round(sum(row['imageCount'] > 0 for row in items) / len(items), 3) if items else 0,
            'contentEncodedCoverageRate': round(sum(row['usesContentEncoded'] for row in items) / len(items), 3) if items else 0,
            'articlePagesSampled': len(article_probes),
            'articlePagesAccessible': len(accessible_pages),
            'articleJsonLdBodyMedian': round(statistics.median([p.get('jsonLdBodyChars', 0) for p in accessible_pages])) if accessible_pages else 0,
        },
        'sampleItems': items[:8],
        'articleProbes': article_probes,
    }


def main():
    report = {
        'checkedAtUtc': datetime.now(timezone.utc).isoformat(),
        'environment': 'GitHub Actions / Azure hosted runner',
        'candidates': [],
    }
    for candidate in CANDIDATES:
        print(f"\n=== {candidate['name']} ===", flush=True)
        result = probe_candidate(candidate)
        report['candidates'].append(result)
        print(json.dumps(result, ensure_ascii=False, indent=2), flush=True)

    with open('news-source-candidate-probe.json', 'w', encoding='utf-8') as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)

    technically_usable = [
        row for row in report['candidates']
        if row['metrics']['itemCount'] >= 5 and row['metrics']['articlePagesAccessible'] >= 3
    ]
    print('\n=== technically usable candidates ===')
    for row in technically_usable:
        print(f"{row['name']}: items={row['metrics']['itemCount']} accessiblePages={row['metrics']['articlePagesAccessible']} medianFeedChars={row['metrics']['medianFeedBodyChars']}")

    return 0 if technically_usable else 1


if __name__ == '__main__':
    sys.exit(main())
