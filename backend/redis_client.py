"""
Redis helpers for real-time game state.

Key schema
----------
game:session:<session_id>   HASH
  player_name   str
  score         int
  distance      int
  speed         float
  status        active | ended
  started_at    ISO timestamp (str)
  ended_at      ISO timestamp (str) | ""
"""

import json
from datetime import datetime, timezone

import redis

from config import REDIS_URL, SESSION_TTL

_pool = redis.ConnectionPool.from_url(REDIS_URL, decode_responses=True)


def get_client() -> redis.Redis:
    return redis.Redis(connection_pool=_pool)


def _key(session_id: str) -> str:
    return f'game:session:{session_id}'


# ── Write ────────────────────────────────────────────────────────────────────

def create_session(session_id: str, player_name: str) -> None:
    r = get_client()
    r.hset(_key(session_id), mapping={
        'player_name': player_name,
        'score':       0,
        'distance':    0,
        'speed':       220,
        'status':      'active',
        'started_at':  datetime.now(timezone.utc).isoformat(),
        'ended_at':    '',
    })
    r.expire(_key(session_id), SESSION_TTL)


def update_score(session_id: str, score: int, distance: int, speed: float = None) -> None:
    r = get_client()
    mapping = {'score': score, 'distance': distance}
    if speed is not None:
        mapping['speed'] = speed
    r.hset(_key(session_id), mapping=mapping)
    r.expire(_key(session_id), SESSION_TTL)   # refresh TTL


def end_session(session_id: str, score: int, distance: int) -> None:
    r = get_client()
    r.hset(_key(session_id), mapping={
        'score':    score,
        'distance': distance,
        'status':   'ended',
        'ended_at': datetime.now(timezone.utc).isoformat(),
    })
    # Keep ended sessions for 10 min so the end-of-game screen can query them
    r.expire(_key(session_id), 600)


# ── Read ─────────────────────────────────────────────────────────────────────

def get_session(session_id: str):
    r = get_client()
    data = r.hgetall(_key(session_id))
    if not data:
        return None
    data['score']    = int(data.get('score', 0))
    data['distance'] = int(data.get('distance', 0))
    data['speed']    = float(data.get('speed', 220))
    return data


def get_active_session_ids() -> list[str]:
    """Scan for all active sessions (used by Celery cleanup task)."""
    r = get_client()
    keys = r.keys('game:session:*')
    active = []
    for k in keys:
        status = r.hget(k, 'status')
        if status == 'active':
            active.append(k.split(':')[-1])
    return active


def delete_session(session_id: str) -> None:
    get_client().delete(_key(session_id))


# ── Analytics helpers ─────────────────────────────────────────────────────────

ANALYTICS_KEY = 'game:analytics'


def cache_analytics(data: dict, ttl: int = 120) -> None:
    r = get_client()
    r.set(ANALYTICS_KEY, json.dumps(data), ex=ttl)


def get_cached_analytics():
    r = get_client()
    raw = r.get(ANALYTICS_KEY)
    return json.loads(raw) if raw else None
