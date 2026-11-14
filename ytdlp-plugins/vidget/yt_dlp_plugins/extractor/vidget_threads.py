"""Public Threads videos, loaded by Vidget's bundled yt-dlp."""
import json
import re

from yt_dlp.extractor.common import InfoExtractor
from yt_dlp.utils import ExtractorError, int_or_none, url_or_none


class VidgetThreadsIE(InfoExtractor):
    IE_NAME = 'vidget:threads'
    _VALID_URL = r'https?://(?:www\.)?threads\.(?:com|net)/(?:@[^/?#]+/post/|t/|share/)(?P<id>[\w-]+)'

    @staticmethod
    def _find_post(data, shortcode):
        pending = [data]
        while pending:
            item = pending.pop()
            if isinstance(item, dict):
                if item.get('code') == shortcode and any(
                        key in item for key in ('video_versions', 'carousel_media', 'image_versions2')):
                    return item
                pending.extend(item.values())
            elif isinstance(item, list):
                pending.extend(reversed(item))

    def _real_extract(self, url):
        shortcode = self._match_id(url)
        webpage = self._download_webpage(url, shortcode, headers={
            'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        })
        if '/share/' in url:
            canonical = self._og_search_property('url', webpage, default='')
            if not self.suitable(canonical) or '/share/' in canonical:
                raise ExtractorError('Unable to resolve this Threads share link', expected=True)
            return self.url_result(canonical, ie=VidgetThreadsIE.ie_key())

        post = None
        for script in re.findall(r'(?is)<script\b[^>]*>(.*?)</script\s*>', webpage):
            try:
                data = json.loads(script)
            except (ValueError, TypeError):
                continue
            post = self._find_post(data, shortcode)
            if post:
                break
        if not post:
            raise ExtractorError(
                'This Threads post is unavailable or requires logging in', expected=True)

        user = post.get('user') or {}
        caption = post.get('caption') or {}
        title = caption.get('text') or f'Threads video {shortcode}'
        entries = []
        for index, media in enumerate(post.get('carousel_media') or [post], 1):
            formats = []
            seen = set()
            for version in media.get('video_versions') or []:
                media_url = url_or_none(version.get('url'))
                if not media_url or media_url in seen:
                    continue
                seen.add(media_url)
                formats.append({
                    'url': media_url,
                    'format_id': f'http-{len(formats)}',
                    'ext': 'mp4',
                    'width': int_or_none(version.get('width')),
                    'height': int_or_none(version.get('height')),
                })
            if not formats:
                continue
            images = (media.get('image_versions2') or {}).get('candidates') or []
            entries.append({
                'id': f'{shortcode}-{index}',
                'title': title,
                'uploader': user.get('username'),
                'timestamp': int_or_none(post.get('taken_at')),
                'duration': media.get('video_duration'),
                'thumbnail': next((image['url'] for image in images if url_or_none(image.get('url'))), None),
                'formats': formats,
                'webpage_url': url,
                'http_headers': {'Referer': 'https://www.threads.com/'},
            })
        if not entries:
            raise ExtractorError('This Threads post contains no downloadable video', expected=True)
        # Each carousel item needs its own stable link for Vidget's queue. Threads
        # has no such link; return the first video rather than overwrite outputs.
        return entries[0]
