from django import forms
from django.forms import ModelForm
from .models import Photo, Comment


class AddPhotoForm(forms.ModelForm):
    class Meta:
        model = Photo
        fields = ("year",)
        widgets = {
            "year": forms.Select(attrs={"class": "form-control"}),
        }


class CommentForm(ModelForm):

    class Meta():
        model = Comment
        fields = ('text',)
