"""
Celery background tasks for Zombie Hop.

Tasks
-----
increase_difficulty   – (not used by frontend; kept for server-authoritative mode)
cleanup_old_sessions  – remove stale Redis sessions every 5 min
compute_analytics     – aggregate scores + cache result in Redis every 2 min
"""

from celery import Celery
from celery.schedules import crontab
from datetime import datetime, timezone, timedelta

from config import CELERY_BROKER_URL, CELERY_RESULT_BACKEND

celery_app = Celery(
    'zombie_tasks',
    broker=CELERY_BROKER_URL,
    backend=CELERY_RESULT_BACKEND,
)

celery_app.conf.update(
    task_serializer='json',
    result_serializer='json',
    accept_content=['json'],
    timezone='UTC',
    enable_utc=True,
    beat_schedule={
        'cleanup-sessions-every-5-min': {
            'task':     'tasks.cleanup_old_sessions',
            'schedule': 300,   # every 5 minutes
        },
        'compute-analytics-every-2-min': {
            'task':     'tasks.compute_analytics',
            'schedule': 120,   # every 2 minutes
        },
    },
)


# ── Task: clean up stale Redis sessions ──────────────────────────────────────

@celery_app.task(name='tasks.cleanup_old_sessions')
def cleanup_old_sessions():
    """
    Delete Redis sessions that have been 'active' for more than 30 minutes
    (player likely closed the tab without properly ending the game).
    """
    from redis_client import get_client

    r = get_client()
    keys = r.keys('game:session:*')
    cleaned = 0
    now = datetime.now(timezone.utc)

    for k in keys:
        data = r.hgetall(k)
        if data.get('status') != 'active':
            continue
        started = data.get('started_at', '')
        if not started:
            continue
        try:
            started_dt = datetime.fromisoformat(started)
            if (now - started_dt) > timedelta(minutes=30):
                r.delete(k)
                cleaned += 1
        except ValueError:
            pass

    return {'cleaned': cleaned}


# ── Task: compute analytics and cache in Redis ────────────────────────────────

@celery_app.task(name='tasks.compute_analytics')
def compute_analytics():
    """
    Compute aggregate statistics from the database and cache in Redis.
    Result is served by GET /api/analytics without hitting the DB every time.
    """
    # Import inside task to avoid circular imports at module load time
    from app import create_app
    from models import Score, db
    from redis_client import cache_analytics

    app = create_app()
    with app.app_context():
        total_games = Score.query.count()
        if total_games == 0:
            result = {'total_games': 0, 'avg_score': 0, 'max_score': 0, 'top_players': []}
            cache_analytics(result)
            return result

        scores = db.session.query(Score.score).all()
        all_scores = [s[0] for s in scores]
        avg_score = sum(all_scores) / len(all_scores)
        max_score = max(all_scores)

        # Top 5 players by best score
        from sqlalchemy import func
        top = (db.session.query(Score.player_name, func.max(Score.score).label('best'))
               .group_by(Score.player_name)
               .order_by(func.max(Score.score).desc())
               .limit(5)
               .all())

        result = {
            'total_games': total_games,
            'avg_score':   round(avg_score, 1),
            'max_score':   max_score,
            'top_players': [{'name': r[0], 'best': r[1]} for r in top],
            'computed_at': datetime.now(timezone.utc).isoformat(),
        }
        cache_analytics(result, ttl=130)
        return result


# ── Task: process a finished game (called by API on session end) ──────────────

@celery_app.task(name='tasks.process_game_end')
def process_game_end(session_id: str, player_name: str, score: int, distance: int):
    """
    Triggered when a game session ends.
    Persists the score to the database asynchronously.
    """
    from app import create_app
    from models import Player, Score, db

    app = create_app()
    with app.app_context():
        player = Player.query.filter_by(name=player_name).first()
        if not player:
            player = Player(name=player_name)
            db.session.add(player)
            db.session.flush()

        entry = Score(
            player_id=player.id,
            player_name=player_name,
            score=score,
            distance=distance,
            session_id=session_id,
        )
        db.session.add(entry)
        db.session.commit()

    # Invalidate analytics cache so next read is fresh
    from redis_client import cache_analytics
    cache_analytics({})   # clear with empty dict; compute task will repopulate
    return {'saved': True, 'score': score}
