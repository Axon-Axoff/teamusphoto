from django.contrib import admin
from import_export.admin import ImportExportModelAdmin
from import_export import resources
from .models import Photo, Year, GenericTag, PeopleTag, Comment, Favorite

class PhotoResource(resources.ModelResource):

    class Meta:
        model = Photo

class PhotoIEAdmin(ImportExportModelAdmin):
    resource_class = PhotoResource

class YearResource(resources.ModelResource):

    class Meta:
        model = Year

class YearIEAdmin(ImportExportModelAdmin):
    resource_class = YearResource

class GenericTagResource(resources.ModelResource):

    class Meta:
        model = GenericTag

class GenericTagIEAdmin(ImportExportModelAdmin):
    resource_class = GenericTagResource

class PeopleTagResource(resources.ModelResource):

    class Meta:
        model = PeopleTag

class PeopleTagIEAdmin(ImportExportModelAdmin):
    resource_class = PeopleTagResource

admin.site.register(Photo, PhotoIEAdmin)
admin.site.register(Year, YearIEAdmin)
admin.site.register(GenericTag, GenericTagIEAdmin)
admin.site.register(PeopleTag, PeopleTagIEAdmin)
admin.site.register(Comment)
admin.site.register(Favorite)
