from django.conf import settings
from django.http import HttpResponsePermanentRedirect

CANONICAL_HOST = "www.teamusphoto.us"


class CanonicalHostMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        # Bypass for static and media paths
        path = request.path or ""
        if path.startswith(getattr(settings, "STATIC_URL", "/static/")) \
           or path.startswith(getattr(settings, "MEDIA_URL", "/media/")):
            return self.get_response(request)

        if settings.DEBUG:
          return self.get_response(request)

        host = request.get_host().split(":")[0]
        if host != CANONICAL_HOST:
            return HttpResponsePermanentRedirect(f"https://{CANONICAL_HOST}{request.get_full_path()}")
        return self.get_response(request)

