from django.contrib.auth.views import LoginView
from django.utils.decorators import method_decorator
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import ensure_csrf_cookie
from django.shortcuts import render, redirect
from django.contrib.auth.decorators import login_required
from django.views.generic import CreateView
from django.contrib.auth import get_user_model
from django.db.models import Q
from . import forms
from .models import TempPassword
from photoapp.models import Photo
from django.template.defaulttags import register
import secrets
import string
from django.contrib.auth.hashers import make_password, check_password
from datetime import timedelta
from django.contrib import messages
from django.utils import timezone
from django.views.decorators.http import require_http_methods
from django.db.models import F

User = get_user_model()

_ALPHABET = string.ascii_letters + string.digits


@method_decorator([never_cache, ensure_csrf_cookie], name="dispatch")
class MyLoginView(LoginView):
    template_name = "login.html"


class SignUp(CreateView):
    form_class = forms.SignUpForm
    success_url = '/'
    template_name = 'accounts/register.html'


@register.filter
def get_value(dictionary, key):
    return dictionary.get(key)


@login_required
def member_list_view(request):
    members = get_user_model().objects.order_by('first_name')
    member_photos = {}
    favorites = {}
    people = {}
    for member in members:
        x = member.id
        fav_lookups = Q(favorite__user__id__exact=member.id)
        lookups = Q(submitter_id__exact=member.id)
        people_lookups =Q(people__name__exact=f'{member.first_name} {member.last_name}')
        count = Photo.objects.filter(lookups)
        fav_count = Photo.objects.filter(fav_lookups)
        people_count = Photo.objects.filter(people_lookups)
        member_photos[x] = len(count)
        favorites[x] = len(fav_count)
        people[x] = len(people_count)

    context = {'members':members, 'member_photos':member_photos, 'favorites':favorites, 'people':people,}

    return render(request, 'accounts/member_list.html', context)


def register_one(request):
    password = request.POST.get('password')
    passwords = TempPassword.objects.all()
    for pwd in passwords:
        if pwd.password == password:
            return redirect('/accounts/register/photoappuser/')
    return render(request, 'accounts/registerone.html')


def generate_temp_password(length: int = 10) -> str:
    return ''.join(secrets.choice(_ALPHABET) for _ in range(length))


def set_temp_password_for_user(user, temp_plaintext: str | None = None) -> str:
    """
    Sets a new temporary password for the user:
      - hashes it into user.tmp_pwd
      - sets created_at to now
      - resets attempts to 0
    Returns the plaintext so the caller (admin) can communicate it to the user.
    """
    temp_plaintext = temp_plaintext or generate_temp_password()
    user.tmp_pwd = make_password(temp_plaintext)
    user.tmp_pwd_created_at = timezone.now()
    user.tmp_pwd_attempts = 0
    user.save(update_fields=["tmp_pwd", "tmp_pwd_created_at", "tmp_pwd_attempts"])
    return temp_plaintext


@require_http_methods(["GET", "POST"])
def update_pwd(request):
    """
    Reset flow:
      - user enters email, temp password, new password (twice)
      - temp password must exist, be <=72h old, and not exceed 3 failed attempts
      - on 3rd failure, temp creds are cleared
    """
    if request.method == "POST":
        email = (request.POST.get("email") or "").strip().lower()
        temp_password = (request.POST.get("temp_password") or "").strip()
        new_password = request.POST.get("new_password") or ""
        confirm_password = request.POST.get("confirm_password") or ""

        errors = []
        if not email or not temp_password or not new_password or not confirm_password:
            errors.append("All fields are required.")
        if new_password != confirm_password:
            errors.append("New passwords do not match.")
        if len(new_password) < 8:
            errors.append("New password must be at least 8 characters long.")

        if errors:
            return render(request, "accounts/update_pwd.html", {"errors": errors, "email": email})

        GENERIC_ERR = "Invalid email or temporary password."

        try:
            member = User.objects.get(email__iexact=email)
        except User.DoesNotExist:
            return render(request, "accounts/update_pwd.html", {"errors": [GENERIC_ERR], "email": email})

        if not member.tmp_pwd or not member.tmp_pwd_created_at:
            return render(request, "accounts/update_pwd.html", {"errors": [GENERIC_ERR], "email": email})

        if timezone.now() - member.tmp_pwd_created_at > timedelta(hours=72):
            member.tmp_pwd = ""
            member.tmp_pwd_created_at = None
            member.tmp_pwd_attempts = 0
            member.save(update_fields=["tmp_pwd", "tmp_pwd_created_at", "tmp_pwd_attempts"])
            return render(request, "accounts/update_pwd.html", {
                "errors": ["Your temporary password has expired. Please request a new one."],
                "email": email,
            })

        if member.tmp_pwd_attempts >= 3:
            member.tmp_pwd = ""
            member.tmp_pwd_created_at = None
            member.tmp_pwd_attempts = 0
            member.save(update_fields=["tmp_pwd", "tmp_pwd_created_at", "tmp_pwd_attempts"])
            return render(request, "accounts/update_pwd.html", {
                "errors": ["Too many attempts. A new temporary password is required."],
                "email": email,
            })

        if not check_password(temp_password, member.tmp_pwd):
            User.objects.filter(pk=member.pk).update(tmp_pwd_attempts=F("tmp_pwd_attempts") + 1)
            member.refresh_from_db(fields=["tmp_pwd_attempts"])
            if member.tmp_pwd_attempts >= 3:
                member.tmp_pwd = ""
                member.tmp_pwd_created_at = None
                member.tmp_pwd_attempts = 0
                member.save(update_fields=["tmp_pwd", "tmp_pwd_created_at", "tmp_pwd_attempts"])
                return render(request, "accounts/update_pwd.html", {
                    "errors": ["Too many attempts. A new temporary password is required."],
                    "email": email,
                })
            return render(request, "accounts/update_pwd.html", {"errors": [GENERIC_ERR], "email": email})

        member.set_password(new_password)
        member.tmp_pwd = ""
        member.tmp_pwd_created_at = None
        member.tmp_pwd_attempts = 0
        member.save(update_fields=["password", "tmp_pwd", "tmp_pwd_created_at", "tmp_pwd_attempts"])

        messages.success(request, "Your password has been updated. Please sign in.")
        return redirect("login")

    return render(request, "accounts/update_pwd.html")
