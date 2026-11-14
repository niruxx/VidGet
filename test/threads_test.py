"""Offline extractor fixtures. Run: python -m unittest discover -s test -p '*_test.py'.

Requires the Python yt-dlp package; production uses the bundled executable.
"""
import importlib.util
import json
from pathlib import Path
import unittest

from yt_dlp import YoutubeDL
from yt_dlp.utils import ExtractorError

PLUGIN = Path(__file__).resolve().parents[1] / 'ytdlp-plugins/vidget/yt_dlp_plugins/extractor/vidget_threads.py'
spec = importlib.util.spec_from_file_location('vidget_threads', PLUGIN)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ThreadsTest(unittest.TestCase):
    def extract(self, posts, shortcode='TARGET'):
        extractor = module.VidgetThreadsIE(YoutubeDL({'quiet': True}))
        page = '<script type="application/json">' + json.dumps({'data': posts}) + '</script>'
        extractor._download_webpage = lambda *args, **kwargs: page
        return extractor._real_extract(f'https://www.threads.com/@someone/post/{shortcode}')

    def video(self, code, versions=None):
        return {'code': code, 'caption': {'text': 'Test video'}, 'user': {'username': 'someone'},
                'video_versions': versions or [{'url': 'https://cdn.example/video.mp4', 'height': 720, 'width': 1280}]}

    def test_matches_supported_links_only(self):
        for host in ('threads.net', 'www.threads.com'):
            for path in ('@someone/post/ABC', 't/ABC', 'share/ABC'):
                self.assertTrue(module.VidgetThreadsIE.suitable(f'https://{host}/{path}'))
        self.assertFalse(module.VidgetThreadsIE.suitable('https://threads.com.evil.test/t/ABC'))
        self.assertFalse(module.VidgetThreadsIE.suitable('https://www.instagram.com/reel/ABC'))

    def test_target_post_not_recommendations(self):
        info = self.extract([self.video('OTHER'), self.video('TARGET')])
        self.assertEqual(info['id'], 'TARGET-1')
        self.assertEqual(info['formats'][0]['height'], 720)
        self.assertEqual(info['uploader'], 'someone')

    def test_missing_target_does_not_download_recommendation(self):
        with self.assertRaisesRegex(ExtractorError, 'logging in'):
            self.extract([self.video('OTHER')])

    def test_text_or_image_post(self):
        with self.assertRaisesRegex(ExtractorError, 'no downloadable video'):
            self.extract([{'code': 'TARGET', 'image_versions2': {'candidates': []}}])

    def test_quote_post_uses_its_explicit_video_attachment(self):
        quoted = self.video('QUOTED')
        quoted['user'] = {'username': 'original-author'}
        outer = {'code': 'TARGET', 'video_versions': [], 'carousel_media': None,
                 'text_post_app_info': {'share_info': {'quoted_attachment_post': quoted}}}
        info = self.extract([self.video('RECOMMENDED'), outer])
        self.assertEqual(info['id'], 'QUOTED-1')
        self.assertEqual(info['uploader'], 'original-author')
        self.assertEqual(len(info['formats']), 1)

    def test_direct_video_takes_precedence_over_quote(self):
        post = self.video('TARGET')
        post['text_post_app_info'] = {'share_info': {'quoted_attachment_post': self.video('QUOTED')}}
        self.assertEqual(self.extract([post])['id'], 'TARGET-1')

    def test_carousel_skips_images_and_deduplicates_formats(self):
        video = self.video('unused')['video_versions'][0]
        info = self.extract([{'code': 'TARGET', 'carousel_media': [
            {'image_versions2': {}}, {'video_versions': [video, video, {'url': 'javascript:bad'}]},
        ]}])
        self.assertEqual(info['id'], 'TARGET-2')
        self.assertEqual(len(info['formats']), 1)

    def test_share_link_resolves_to_threads_only(self):
        extractor = module.VidgetThreadsIE(YoutubeDL({'quiet': True}))
        extractor._download_webpage = lambda *a, **k: '<meta property="og:url" content="https://www.threads.com/@someone/post/TARGET">'
        result = extractor._real_extract('https://www.threads.net/share/ABC')
        self.assertEqual(result['url'], 'https://www.threads.com/@someone/post/TARGET')
        extractor._download_webpage = lambda *a, **k: '<meta property="og:url" content="http://localhost/video">'
        with self.assertRaisesRegex(ExtractorError, 'resolve'):
            extractor._real_extract('https://www.threads.net/share/ABC')
