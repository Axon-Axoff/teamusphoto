from django.db import models
from django.contrib.auth import get_user_model
# from django_resized import ResizedImageField
from django.utils.translation import gettext_lazy as _
from taggit.managers import TaggableManager
from taggit.models import TagBase, GenericTaggedItemBase
from PIL import Image, ExifTags
from io import BytesIO
from django.core.files import File

class Year(models.Model):
    year = models.CharField(max_length=5, unique=True)

    class Meta:
         ordering = ['year']

    def __str__(self):
        return self.year


class GenericTag(TagBase):

    class Meta:
        verbose_name = _("Tag")
        verbose_name_plural = _("Tags")


class PeopleTag(TagBase):

    class Meta:
        verbose_name = _("Person")
        verbose_name_plural = _("People")


class TaggedGeneric(GenericTaggedItemBase):
    tag = models.ForeignKey(
        GenericTag,
        on_delete=models.CASCADE,
        related_name="%(app_label)s_%(class)s_items",
    )


class TaggedPeople(GenericTaggedItemBase):
    tag = models.ForeignKey(
        PeopleTag,
        on_delete=models.CASCADE,
        related_name="%(app_label)s_%(class)s_items",
    )


class Photo(models.Model):
    title = models.CharField(max_length=64)
    description = models.CharField(max_length=255)
    created = models.DateTimeField(auto_now_add=True)
    image = models.ImageField(upload_to='photos/%Y%m')
    thumbnail = models.ImageField(blank=True, upload_to='thumbnails/%Y%m')
    submitter = models.ForeignKey(get_user_model(), on_delete=models.CASCADE, related_name='submitter')
    edited_by = models.ForeignKey(get_user_model(), null=True, on_delete=models.CASCADE, related_name='edited_by')
    year = models.ForeignKey(Year, on_delete=models.CASCADE)
    people = TaggableManager(through=TaggedPeople, verbose_name='People')
    tags = TaggableManager(through=TaggedGeneric, verbose_name='Tags')

    def save(self, *args, **kwargs):
        try:
            # If the instance already exists, check if the thumbnail has changed
            this = Photo.objects.get(id=self.id)
            if this.thumbnail != self.thumbnail:
                this.thumbnail.delete(save=False)  # Delete the old thumbnail
        except Photo.DoesNotExist:
            pass  # Instance doesn't exist, create a new thumbnail

        if self.image:  # Only generate thumbnail if there's an image
            img = Image.open(self.image)

            # Handle EXIF orientation
            if hasattr(img, '_getexif'):
                exif = img._getexif()
                if exif:
                    orientation = None
                    for tag, label in ExifTags.TAGS.items():
                        if label == 'Orientation':
                            orientation = tag
                            break
                    if orientation in exif:
                        if exif[orientation] == 3:
                            img = img.rotate(180, expand=True)
                        elif exif[orientation] == 6:
                            img = img.rotate(270, expand=True)
                        elif exif[orientation] == 8:
                            img = img.rotate(90, expand=True)

            img.thumbnail((360, 360), Image.LANCZOS)  # LANCZOS for better quality
            output = BytesIO()

            # Determine the format for saving the thumbnail
            image_format = self.image.name.split('.')[-1].lower()
            if image_format in ('jpg', 'jpeg'):
                file_extension = 'jpg'
                format_type = 'JPEG'
            elif image_format == 'png':
                file_extension = 'png'
                format_type = 'PNG'
            elif image_format == 'webp':
                file_extension = 'webp'
                format_type = 'WEBP'
            else:
                file_extension = 'jpg'
                format_type = 'JPEG'  # Default file type

            # Save the thumbnail to the buffer in the determined format
            img.save(output, format=format_type, quality=95)
            output.seek(0)

            # Create a Django File object from the buffer
            thumbnail_file_name = f"{self.image.name.split('.')[0]}_thumbnail.{file_extension}"  # Add "_thumbnail" to the name
            self.thumbnail = File(output, thumbnail_file_name)

        super().save(*args, **kwargs)

    def __str__(self):
        return self.title


class Comment(models.Model):
    photo = models.ForeignKey(Photo, related_name='comments', on_delete=models.CASCADE)
    submitter = models.ForeignKey(get_user_model(), on_delete=models.CASCADE)
    text = models.TextField()
    created = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.photo.title

    class Meta:
        # Oldest → newest:
        ordering = ['created', 'id']


class Favorite(models.Model):
    user = models.ForeignKey(get_user_model(), on_delete=models.CASCADE)
    favorite = models.ForeignKey(Photo, related_name='favorite', on_delete=models.CASCADE)

    def __str__(self):
        return self.favorite.title
