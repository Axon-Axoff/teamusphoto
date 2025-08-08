from django.shortcuts import render
from django.shortcuts import get_object_or_404
from django.contrib.auth.decorators import login_required
from django.core.exceptions import PermissionDenied
from django.views.generic import ListView, DetailView, CreateView, UpdateView, DeleteView, FormView
from django.contrib.auth import get_user_model
from django.contrib.auth.mixins import LoginRequiredMixin, UserPassesTestMixin
from django.core.paginator import Paginator
from django.db.models import Q
from django.urls import reverse_lazy
from django.shortcuts import redirect
from .models import Photo, GenericTag, PeopleTag, Year, Comment, Favorite
from .forms import AddPhotoForm, CommentForm

@login_required
def photo_list_view(request):
    if request.GET.get('sort_by') == 'createdasc':
        sort = 'created'
    elif request.GET.get('sort_by') == 'yearasc':
        sort = 'year'
    elif request.GET.get('sort_by') == 'yeardesc':
        sort = '-year'
    else:
        sort = '-created'
    photos = photo_list = Photo.objects.all().order_by(sort)
    tags = GenericTag.objects.all().order_by('name')
    tag_list = {}
    for tag in tags:
        tag_list[tag] = len(photo_list.filter(Q(tags__name__exact=tag)))
    people = PeopleTag.objects.all().order_by('name')
    people_list = {}
    for person in people:
        people_list[person] = len(photo_list.filter(Q(people__name__exact=person)))
    years = Year.objects.all().order_by('year')
    year_list = {}
    for year in years:
        num = len(photo_list.filter(Q(year__year__exact=year)))
        if num > 0:
            year_list[year] = num
    search = ''
    search_m = ''
    message = 'Team Us Photos'
    if request.GET.get('favorites'):
        split = request.GET.get('favorites').split()
        if len(split) > 2:
            split[1] = split[1] + ' ' + split[2]
        lookups = Q(favorite__user__first_name__exact=split[0]) & Q(favorite__user__last_name__exact=split[1])
        search = request.GET.get('favorites')
        search_m = 'favorites'
    if request.GET.get('member'):
        split = request.GET.get('member').split()
        if len(split) > 2:
            split[1] = split[1] + ' ' + split[2]
        lookups = Q(submitter__first_name__exact=split[0]) & Q(submitter__last_name__exact=split[1])
        search = request.GET.get('member')
        search_m = 'member'
    elif request.GET.get('tag'):
        lookups = Q(tags__name__exact=request.GET.get('tag'))
        search = request.GET.get('tag')
        search_m = 'tag'
    elif request.GET.get('year'):
        lookups = Q(year__year__exact=request.GET.get('year'))
        search = request.GET.get('year')
        search_m = 'year'
    elif request.GET.get('person'):
        lookups = Q(people__name__exact=request.GET.get('person'))
        search = request.GET.get('person')
        search_m = 'person'
    elif request.GET.get('search'):
        splits = request.GET.get('search').split(',',2)
        splits = [s.strip() for s in splits]
        num = len(splits)
        lookups = Q(title__icontains=splits[0]) | Q(tags__name__icontains=splits[0]) | Q(people__name__icontains=splits[0]) | Q(year__year__icontains=splits[0])
        if num == 2:
            lookups = (Q(title__icontains=splits[0]) | Q(tags__name__icontains=splits[0]) | Q(people__name__icontains=splits[0]) | Q(year__year__icontains=splits[0])) & (Q(title__icontains=splits[1]) | Q(tags__name__icontains=splits[1]) | Q(people__name__icontains=splits[1]) | Q(year__year__icontains=splits[1]))
        elif num == 3:
            lookups = (Q(title__icontains=splits[0]) | Q(tags__name__icontains=splits[0]) | Q(people__name__icontains=splits[0]) | Q(year__year__icontains=splits[0])) & (Q(title__icontains=splits[1]) | Q(tags__name__icontains=splits[1]) | Q(people__name__icontains=splits[1]) | Q(year__year__icontains=splits[1])) & (Q(title__icontains=splits[2]) | Q(tags__name__icontains=splits[2]) | Q(people__name__icontains=splits[2]) | Q(year__year__icontains=splits[2]))
        search = request.GET.get('search')
        search_m = 'search'
    if search != '' and search is not None:
        photos = photo_list.filter(lookups).distinct()
        if request.GET.get('member'):
            message = 'Photos Uploaded by ' + request.GET.get('member')
        elif request.GET.get('favorites'):
            message = search + "'s Favorite Photos"
        else:
            message = search + ' Photos'
    paginator = Paginator(photos, 24)
    if request.GET.get('page') != '':
        page_number = request.GET.get('page')
    else:
        page_number = 1
    photos = paginator.get_page(page_number)
    photos.adjusted_elided_pages = paginator.get_elided_page_range(page_number)
    context = {
        'message':message,
        'photos':photos,
        'photo_list':photo_list,
        'tag_list':tag_list,
        'people_list':people_list,
        'year_list':year_list,
        'search':search,
        'search_m':search_m,
        'sort':request.GET.get('sort_by'),
    }
    return render(request, 'photoapp/list.html', context)

@login_required
def photo_detail_view(request, pk):
    photo = Photo.objects.get(id=pk)
    fav = Favorite.objects.filter(user=request.user, favorite=photo)
    favorites = Favorite.objects.filter(favorite=photo)
    context = {
        'photo':photo,
        'fav':fav,
        'favorites':favorites,
    }
    if request.POST.get('add') == 'add':
        user = request.user
        favorite = Favorite(user=user, favorite=photo)
        favorite.save()
        return redirect('photo:detail', pk=photo.id)
    elif request.POST.get('remove') == 'remove':
        fav = Favorite.objects.get(user=request.user, favorite=photo)
        fav.delete()
        return redirect('photo:detail', pk=photo.id)
    elif request.POST.get('comment') == 'comment':
        submitter = request.user
        text = request.POST.get('text')
        comment = Comment(photo=photo, submitter=submitter, text=text,)
        comment.save()
        return redirect('photo:detail', pk=photo.id)
    return render(request, 'photoapp/detail.html', context)

class PhotoCreateView(LoginRequiredMixin, CreateView):
    model = Photo
    fields = ['image', 'title', 'description', 'year', 'people', 'tags']
    template_name = 'photoapp/create.html'
    success_url = '/photo/?page=1'
    extra_context = {'tags':GenericTag.objects.all().order_by('name'),'people':PeopleTag.objects.all().order_by('name'),}

    def form_valid(self, form):
        form.instance.thumbnail = self.request.FILES['image']
        form.instance.submitter = self.request.user
        return super().form_valid(form)

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
        return super().form_valid(form)

class PhotoDeleteView(UserIsSubmitter, DeleteView):
    template_name = 'photoapp/delete.html'
    model = Photo
    success_url = '/photo/?page=1'

@login_required
def delete_comment(request, pk):
    comment = get_object_or_404(Comment, pk=pk)
    photo_pk = comment.photo.pk
    comment.delete()
    return redirect('photo:detail', pk=photo_pk)

@login_required
def about_view(request):
    return render(request, 'photoapp/about.html')
