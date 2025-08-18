from django.shortcuts import get_object_or_404, render, redirect
from django.contrib.auth.decorators import login_required
from django.core.exceptions import PermissionDenied
from django.views.generic import CreateView, UpdateView, DeleteView
from django.contrib.auth.mixins import LoginRequiredMixin, UserPassesTestMixin
from django.core.paginator import Paginator
from django.db.models import Q, Count
from .models import Photo, GenericTag, PeopleTag, Comment, Favorite
from django.template.loader import render_to_string
from django.conf import settings
from django.core.cache import cache
from django.views.decorators.http import require_POST
from .cache_utils import get_grid_ver
from django.http import JsonResponse, HttpResponseForbidden, HttpResponseNotAllowed

CACHE_KEY_FACETS = "facet_counts_v1"


def cached_counts():
    data = cache.get(CACHE_KEY_FACETS)
    if data is None:
        tag_counts = (Photo.objects
                      .values('tags__name')
                      .annotate(num=Count('id'))
                      .order_by('tags__name'))
        people_counts = (Photo.objects
                         .values('people__name')
                         .annotate(num=Count('id'))
                         .order_by('people__name'))
        year_counts = (Photo.objects
                       .values('year__year')
                       .annotate(num=Count('id'))
                       .order_by('-year__year'))

        data = {
            'tag':    {r['tags__name']: r['num'] for r in tag_counts   if r['tags__name']},
            'people': {r['people__name']: r['num'] for r in people_counts if r['people__name']},
            'year':   {r['year__year']: r['num'] for r in year_counts  if r['year__year']},
        }
        cache.set(CACHE_KEY_FACETS, data, 600)   # 10 minutes
    return data


def total_photos_cached(ttl=300):
    key = "photo_total_count_v1"
    n = cache.get(key)
    if n is None:
        n = Photo.objects.count()
        cache.set(key, n, ttl)             # cache for 5 minutes
    return n


def invalidate_facet_cache():
    cache.delete(CACHE_KEY_FACETS)


@login_required
def photo_list_view(request):
    # --- sort
    sort_by = request.GET.get('sort_by')
    sort = {
        'createdasc': 'created',
        'yeardesc': '-year__year',
        'yearasc': 'year__year',
    }.get(sort_by, '-created')

    base = (
        Photo.objects
        .select_related('year', 'submitter')
        .only('id', 'title', 'thumbnail', 'created', 'year__year',
              'submitter__first_name', 'submitter__last_name')
        .annotate(
            comments_count=Count('comments', distinct=True),
            favorites_count=Count('favorite', distinct=True),
        )
        .order_by(sort)
    )

    q = Q()
    search = ''
    search_m = None

    if request.GET.get('favorites'):
        first, *rest = request.GET['favorites'].split()
        last = ' '.join(rest) if rest else ''
        q &= Q(favorite__user__first_name=first) & Q(favorite__user__last_name=last)
        search = request.GET['favorites']; search_m = 'favorites'

    elif request.GET.get('member'):
        first, *rest = request.GET['member'].split()
        last = ' '.join(rest) if rest else ''
        q &= Q(submitter__first_name=first) & Q(submitter__last_name=last)
        search = request.GET['member']; search_m = 'member'

    elif request.GET.get('tag'):
        q &= Q(tags__name=request.GET['tag'])
        search = request.GET['tag']; search_m = 'tag'

    elif request.GET.get('year'):
        q &= Q(year__year=request.GET['year'])
        search = request.GET['year']; search_m = 'year'

    elif request.GET.get('person'):
        q &= Q(people__name=request.GET['person'])
        search = request.GET['person']; search_m = 'person'

    elif request.GET.get('search'):
        terms = [t.strip() for t in request.GET['search'].split(',') if t.strip()]
        for term in terms:
            q &= (Q(title__icontains=term) |
                  Q(tags__name__icontains=term) |
                  Q(people__name__icontains=term) |
                  Q(year__year__icontains=term))
        search = request.GET['search']; search_m = 'search'

    photos_qs = base.filter(q).distinct()

    # --- pagination
    paginator = Paginator(photos_qs, 24)
    page_number = request.GET.get('page') or 1
    photos = paginator.get_page(page_number)
    photos.adjusted_elided_pages = paginator.get_elided_page_range(page_number)
    page_links = list(paginator.get_elided_page_range(number=photos.number))

    # --- message
    if search:
        if search_m == 'member':
            message = f'Photos Uploaded by {search}'
        elif search_m == 'favorites':
            message = f"{search}'s Favorite Photos"
        else:
            message = f'Photos of {search}'
    else:
        message = 'Team Us Photos'

    facets = cached_counts()

    context = {
        'message': message,
        'photos': photos,
        'total_photos': paginator.count,
        'total_photos_all': total_photos_cached(),
        'page_links': page_links,
        'search': search,
        'search_m': search_m,
        'sort': sort_by,
        'tag_list': facets['tag'],
        'people_list': facets['people'],
        'year_list': facets['year'],
        'grid_ver': get_grid_ver(),
    }
    return render(request, 'photoapp/list.html', context)


@login_required
def photo_detail_view(request, pk):
    photo = get_object_or_404(Photo, id=pk)
    is_favorite = Favorite.objects.filter(user=request.user, favorite=photo).exists()

    if request.method == 'POST':
        if request.POST.get('add') == 'add':
            Favorite.objects.get_or_create(user=request.user, favorite=photo)
            is_favorite = True
        elif request.POST.get('remove') == 'remove':
            Favorite.objects.filter(user=request.user, favorite=photo).delete()
            is_favorite = False
        elif request.POST.get('comment') == 'comment':
            Comment.objects.create(
                photo=photo,
                submitter=request.user,
                text=request.POST.get('text', '').strip()
            )

    # Recompute AFTER any change
    favorites_qs = Favorite.objects.select_related('user').filter(favorite=photo)
    favorites_count = favorites_qs.count()
    comments_qs = photo.comments.all()
    comments_count = comments_qs.count()

    if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
        html = render_to_string('photoapp/detail_modal.html', {
            'photo': photo,
            'is_favorite': is_favorite,
            'favorites': favorites_qs,          # ok here
            'favorites_count': favorites_count,
            'comments': comments_qs,            # ok here
            'MEDIA_URL': settings.MEDIA_URL,
            'user': request.user,
        }, request=request)

        return JsonResponse({
            'html': html,
            'photo_id': photo.id,
            'is_favorite': is_favorite,
            'favorites_count': favorites_count,
            'comments_count': comments_count,
        })

    # Non-AJAX fallback render
    return render(request, 'photoapp/detail.html', {
        'photo': photo,
        'is_favorite': is_favorite,
        'favorites': favorites_qs,
        'favorites_count': favorites_count,
        'comments': comments_qs,
    })


class PhotoCreateView(LoginRequiredMixin, CreateView):
    model = Photo
    fields = ['image', 'title', 'description', 'year', 'people', 'tags']
    template_name = 'photoapp/create.html'
    success_url = '/photo/?page=1'
    extra_context = {'tags':GenericTag.objects.all().order_by('name'),'people':PeopleTag.objects.all().order_by('name'),}

    def form_valid(self, form):
        form.instance.thumbnail = self.request.FILES['image']
        form.instance.submitter = self.request.user
        res = super().form_valid(form)
        invalidate_facet_cache()
        return res


class UserIsSubmitter(UserPassesTestMixin):

    def get_photo(self):
        return get_object_or_404(Photo, pk=self.kwargs.get('pk'))

    def test_func(self):
        if self.request.user.is_authenticated:
            return self.request.user == self.get_photo().submitter
        else:
            raise PermissionDenied('Sorry you are not allowed here')


class PhotoUpdateView(LoginRequiredMixin, UpdateView):
    template_name = 'photoapp/update.html'
    model = Photo
    fields = ['title', 'description', 'year', 'people', 'tags']
    success_url = '/photo/?page=1'
    extra_context = {'tags':GenericTag.objects.all().order_by('name'),'people':PeopleTag.objects.all().order_by('name'),}

    def form_valid(self, form):
        form.instance.edited_by = self.request.user
        res = super().form_valid(form)
        invalidate_facet_cache()
        return res


class PhotoDeleteView(UserIsSubmitter, DeleteView):
    template_name = 'photoapp/delete.html'
    model = Photo
    success_url = '/photo/?page=1'
    invalidate_facet_cache()


@require_POST
@login_required
def delete_comment(request, pk):
    comment = get_object_or_404(Comment, pk=pk)
    photo = comment.photo

    comment.delete()

    favorites_qs = Favorite.objects.select_related('user').filter(favorite=photo)
    favorites_count = favorites_qs.count()
    comments_qs = photo.comments.all()
    comments_count = comments_qs.count()
    is_favorite = Favorite.objects.filter(user=request.user, favorite=photo).exists()

    if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
        html = render_to_string('photoapp/detail_modal.html', {
            'photo': photo,
            'is_favorite': is_favorite,
            'favorites': favorites_qs,
            'favorites_count': favorites_count,
            'comments': comments_qs,
            'MEDIA_URL': settings.MEDIA_URL,
            'user': request.user,
        }, request=request)

        return JsonResponse({
            'html': html,
            'photo_id': photo.id,
            'is_favorite': is_favorite,
            'favorites_count': favorites_count,
            'comments_count': comments_count,
        })

    # Non-AJAX: go to regular detail page
    return redirect('photo:detail', pk=photo.pk)


@login_required
def edit_comment(request, pk):
    c = get_object_or_404(Comment, pk=pk)

    if request.method != 'POST':
        return HttpResponseNotAllowed(['POST'])

    new_text = (request.POST.get('text') or '').strip()
    if new_text:
        c.text = new_text
        c.save()

    photo = c.photo
    is_favorite = Favorite.objects.filter(user=request.user, favorite=photo).exists()
    favorites_count = Favorite.objects.filter(favorite=photo).count()
    comments_qs = photo.comments.all()
    comments_count = comments_qs.count()

    if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
        html = render_to_string('photoapp/detail_modal.html', {
            'photo': photo,
            'is_favorite': is_favorite,
            'favorites': Favorite.objects.select_related('user').filter(favorite=photo),
            'favorites_count': favorites_count,
            'comments': comments_qs,
            'MEDIA_URL': settings.MEDIA_URL,
            'user': request.user,
        }, request=request)
        return JsonResponse({
            'html': html,
            'photo_id': photo.id,
            'is_favorite': is_favorite,
            'favorites_count': favorites_count,
            'comments_count': comments_count,
        })

    return redirect('photo:detail', pk=photo.id)


@login_required
def recent_activity(request):
    recent_comments = (Comment.objects
                       .select_related('photo', 'submitter')
                       .order_by('-created')[:20])

    recent_favorites = (Favorite.objects
                        .select_related('favorite', 'user')
                        .order_by('-id')[:20])

    context = {
        'recent_comments': recent_comments,
        'recent_favorites': recent_favorites,
    }

    if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
        html = render_to_string('photoapp/activity_modal.html', context, request=request)
        return JsonResponse({'html': html})

    return render(request, 'photoapp/activity_modal.html', context)



@login_required
def about_view(request):
    return render(request, 'photoapp/about.html')
