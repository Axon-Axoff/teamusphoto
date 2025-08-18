from django.urls import path
from .views import (
    photo_list_view,
    photo_detail_view,
    PhotoCreateView,
    PhotoUpdateView,
    PhotoDeleteView,
    delete_comment,
    about_view,
    edit_comment,
    recent_activity,
)

app_name = 'photo'

urlpatterns = [
    path('', photo_list_view, name='list'),
    path('<int:pk>/', photo_detail_view, name='detail'),
    path('create/', PhotoCreateView.as_view(), name='create'),
    path('<int:pk>/update/', PhotoUpdateView.as_view(), name='update'),
    path('<int:pk>/delete/', PhotoDeleteView.as_view(), name='delete'),
    path('<int:pk>/delete_comment/', delete_comment, name='delete_comment'),
    path('about/', about_view, name='about'),
    path('comment/<int:pk>/edit/', edit_comment, name='edit_comment'),
    path('activity/', recent_activity, name='activity'),
]
