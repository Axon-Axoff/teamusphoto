from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver
from .models import Comment, Favorite
from .cache_utils import bump_grid_ver

@receiver(post_save, sender=Comment)
def _comment_saved(sender, instance, **kwargs):
    bump_grid_ver()

@receiver(post_delete, sender=Comment)
def _comment_deleted(sender, instance, **kwargs):
    bump_grid_ver()

@receiver(post_save, sender=Favorite)
def _favorite_saved(sender, instance, **kwargs):
    bump_grid_ver()

@receiver(post_delete, sender=Favorite)
def _favorite_deleted(sender, instance, **kwargs):
    bump_grid_ver()
