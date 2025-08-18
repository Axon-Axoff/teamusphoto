from django.urls import path
from django.contrib.auth import views as auth_views
from . import views

app_name = 'accounts'

urlpatterns = [
    path('logout/', auth_views.LogoutView.as_view(), name='logout'),
    path('register/', views.register_one, name='register_one'),
    path('register/photoappuser/', views.SignUp.as_view(), name='register'),
    path('members/', views.member_list_view, name='member_list'),
    path('register/updatepwd/', views.update_pwd, name='update_pwd'),
]
