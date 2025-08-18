from django.apps import AppConfig


class PhotoappConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'photoapp'

    def ready(self):
        from . import signals


