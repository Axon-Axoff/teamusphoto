from django.contrib import admin
from django.contrib.auth.models import Group
from django.contrib.auth.admin import UserAdmin
from django.contrib.auth.forms import UserChangeForm
from import_export.admin import ImportExportModelAdmin
from import_export import resources
from .models import User, TempPassword

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
    list_display = ('email', 'first_name', 'last_name', 'is_active', 'is_editor', 'is_staff')

    fieldsets = (
        ('User Information', {'fields': ('email', 'first_name', 'last_name',)}),
        ('Permissions', {'fields': ('is_active', 'is_editor', 'is_staff', 'is_admin',)}),
        ('Date Joined', {'fields': ('date_joined',)}),
    )

admin.site.unregister(Group)
admin.site.register(User, UserIEAdmin)
admin.site.register(TempPassword, TempPasswordIEAdmin)
