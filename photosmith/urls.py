"""photosmith URL Configuration

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/4.1/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from accounts.views import MyLoginView
from django.http import JsonResponse, HttpResponseNotFound
from django.views.decorators.csrf import ensure_csrf_cookie
from django.middleware.csrf import get_token


@ensure_csrf_cookie
def csrf_probe(request):
    if not settings.DEBUG:
        return HttpResponseNotFound()
    token = get_token(request)  # forces a token to exist
    return JsonResponse({
        "has_cookie": "csrftoken" in request.COOKIES,
        "cookie_len": len(request.COOKIES.get("csrftoken", "")),
        "token_len": len(token),
        "host": request.get_host(),
        "secure": request.is_secure(),
    })


urlpatterns = [
    path('admin/', admin.site.urls),
    path('', MyLoginView.as_view(), name='login'),
    path('photo/', include('photoapp.urls')),
    path('accounts/', include('accounts.urls')),
] + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)

urlpatterns += [ path("_csrfprobe/", csrf_probe) ]

if settings.DEBUG:
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)
