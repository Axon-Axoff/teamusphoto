from django.forms import ModelForm
from .models import Photo, Comment

class AddPhotoForm(ModelForm):

    class Meta:
        model = Photo
        fields = ('year',)

class CommentForm(ModelForm):

    class Meta():
        model = Comment
        fields = ('text',)
