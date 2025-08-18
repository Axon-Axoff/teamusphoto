from django.contrib import admin, messages
from django.contrib.auth.models import Group
from django.contrib.auth.admin import UserAdmin
from django.contrib.auth.forms import UserChangeForm
from import_export.admin import ImportExportModelAdmin
from import_export import resources
from .models import TempPassword
from django.contrib.auth import get_user_model
from .utils.temp_passwords import set_temp_password_for_user

User = get_user_model()


class UserResource(resources.ModelResource):

    class Meta:
        model = User


class UserIEAdmin(ImportExportModelAdmin):
    resource_class = UserResource


class TempPasswordResource(resources.ModelResource):

    class Meta:
        model = TempPassword


class TempPasswordIEAdmin(ImportExportModelAdmin):
    resource_class = TempPasswordResource


class MyUserChangeForm(UserChangeForm):
    class Meta(UserChangeForm.Meta):
        model = User


class MyUserAdmin(UserAdmin):
    form = MyUserChangeForm
    ordering = ('email',)
    list_display = ('email', 'first_name', 'last_name', 'is_active', 'is_editor', 'is_staff',
                    'tmp_pwd_created_at', 'tmp_pwd_attempts',)

    fieldsets = (
        ('User Information', {'fields': ('email', 'first_name', 'last_name',)}),
        ('Permissions', {'fields': ('is_active', 'is_editor', 'is_staff', 'is_admin',)}),
        ('Password Update', {'fields': ('tmp_pwd_created_at', 'tmp_pwd_attempts',)}),
        ('Date Joined', {'fields': ('date_joined',)}),
    )
    readonly_fields = ("tmp_pwd_created_at", "tmp_pwd_attempts")
    search_fields = ("username", "email")
    actions = ["generate_temp_password"]

    @admin.action(description="Generate temp password (valid 72h)")
    def generate_temp_password(self, request, queryset):
        count = 0
        for user in queryset:
            # Generate a fresh temp password; returns plaintext ONCE
            temp_plain = set_temp_password_for_user(user)
            # Show it to the admin so it can be communicated (SMS/email/etc.)
            messages.info(request, f"{user.email}: temporary password is '{temp_plain}' (expires in 72 hours).")
            count += 1
        if count:
            messages.success(request, f"Generated temporary password for {count} user(s).")


admin.site.unregister(Group)
# admin.site.register(User, UserIEAdmin)
admin.site.register(User, MyUserAdmin)
admin.site.register(TempPassword, TempPasswordIEAdmin)
