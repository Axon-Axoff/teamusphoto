# photoapp/cache_utils.py
from django.core.cache import cache

GRID_VER_KEY = 'grid_ver_v1'  # bump suffix if you ever want to invalidate everything

def get_grid_ver() -> int:
    v = cache.get(GRID_VER_KEY)
    if v is None:
        v = 1
        cache.set(GRID_VER_KEY, v, None)  # no expiry; fragments have their own TTL
    return v

def bump_grid_ver() -> int:
    # Works with Redis/Memcached incr; falls back for LocMem
    try:
        return cache.incr(GRID_VER_KEY)
    except Exception:
        v = get_grid_ver() + 1
        cache.set(GRID_VER_KEY, v, None)
        return v
