"""
Zombie Hop – Flask REST API
===========================

Endpoints
---------
POST  /api/sessions                   Start a new game session
GET   /api/sessions/<id>              Get live session state (from Redis)
POST  /api/sessions/<id>/score        Update score mid-game
POST  /api/sessions/<id>/end          End game and persist score
GET   /api/leaderboard                Top 10 all-time scores
GET   /api/leaderboard/<player>       All scores for one player
GET   /api/analytics                  Aggregated stats (cached 2 min)
"""

import os
import uuid
from datetime import datetime, timezone
from functools import wraps

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from sqlalchemy import func

FRONTEND_DIR = os.path.join(os.path.dirname(__file__), '..', 'frontend')

import redis_client as rc
from config import DATABASE_URL, SECRET_KEY
from models import Player, Score, db


# ── App factory ──────────────────────────────────────────────────────────────

def create_app():
    app = Flask(__name__)
    app.config['SECRET_KEY'] = SECRET_KEY
    app.config['SQLALCHEMY_DATABASE_URI'] = DATABASE_URL
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

    CORS(app, resources={r'/api/*': {'origins': '*'}})
    db.init_app(app)

    with app.app_context():
        db.create_all()

    return app


app = create_app()


# ── Helpers ──────────────────────────────────────────────────────────────────

def json_error(msg: str, status: int = 400):
    return jsonify({'error': msg}), status


def require_json(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if not request.is_json:
            return json_error('Content-Type must be application/json')
        return f(*args, **kwargs)
    return wrapper


# ── Routes ───────────────────────────────────────────────────────────────────

@app.post('/api/sessions')
@require_json
def start_session():
    """
    Body: { "player_name": "Alice" }
    Returns: { "session_id": "<uuid>", "player_name": "Alice" }
    """
    data = request.get_json()
    player_name = (data.get('player_name') or 'Anonymous').strip()[:50]
    if not player_name:
        return json_error('player_name is required')

    session_id = str(uuid.uuid4())
    rc.create_session(session_id, player_name)

    return jsonify({'session_id': session_id, 'player_name': player_name}), 201


@app.get('/api/sessions/<session_id>')
def get_session(session_id: str):
    """Live game state from Redis."""
    state = rc.get_session(session_id)
    if not state:
        return json_error('Session not found', 404)
    return jsonify(state)


@app.post('/api/sessions/<session_id>/score')
@require_json
def update_score(session_id: str):
    """
    Body: { "score": 1234, "distance": 5678 }
    Updates the live Redis state. Lightweight – called every few seconds.
    """
    state = rc.get_session(session_id)
    if not state:
        return json_error('Session not found', 404)
    if state['status'] == 'ended':
        return json_error('Session already ended', 409)

    data = request.get_json()
    score    = int(data.get('score', 0))
    distance = int(data.get('distance', 0))
    speed    = float(data.get('speed', state['speed']))

    rc.update_score(session_id, score, distance, speed)
    return jsonify({'ok': True, 'score': score})


@app.post('/api/sessions/<session_id>/end')
@require_json
def end_session(session_id: str):
    """
    Body: { "score": 1234, "distance": 5678 }
    Marks session ended in Redis, then dispatches a Celery task to persist
    the score to the DB asynchronously (so the HTTP response is fast).
    """
    state = rc.get_session(session_id)
    if not state:
        return json_error('Session not found', 404)

    data     = request.get_json()
    score    = int(data.get('score', 0))
    distance = int(data.get('distance', 0))

    rc.end_session(session_id, score, distance)

    # Persist to DB via Celery (non-blocking)
    try:
        from tasks import process_game_end
        process_game_end.delay(session_id, state['player_name'], score, distance)
    except Exception:
        # Celery unavailable – persist synchronously as fallback
        _persist_score_sync(state['player_name'], score, distance, session_id)

    return jsonify({'ok': True, 'score': score, 'distance': distance})


def _persist_score_sync(player_name: str, score: int, distance: int, session_id: str):
    """Fallback: write score directly to DB (used when Celery is offline)."""
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


@app.get('/api/leaderboard')
def leaderboard():
    """
    Returns top 10 scores globally.
    Query param: ?limit=10 (max 50)
    """
    limit = min(int(request.args.get('limit', 10)), 50)
    rows = (Score.query
            .order_by(Score.score.desc())
            .limit(limit)
            .all())
    return jsonify({'scores': [r.to_dict() for r in rows]})


@app.get('/api/leaderboard/<player_name>')
def player_scores(player_name: str):
    """All scores for a specific player, newest first."""
    rows = (Score.query
            .filter_by(player_name=player_name)
            .order_by(Score.score.desc())
            .limit(20)
            .all())
    best = max((r.score for r in rows), default=0)
    return jsonify({
        'player': player_name,
        'best':   best,
        'runs':   [r.to_dict() for r in rows],
    })


@app.get('/api/analytics')
def analytics():
    """
    Returns cached analytics (recomputed every 2 min by Celery).
    Falls back to direct DB query if cache is empty.
    """
    cached = rc.get_cached_analytics()
    if cached and cached.get('total_games', 0) > 0:
        return jsonify(cached)

    # Direct DB fallback
    total = Score.query.count()
    if total == 0:
        return jsonify({'total_games': 0, 'avg_score': 0, 'max_score': 0, 'top_players': []})

    stats = db.session.query(
        func.count(Score.id),
        func.avg(Score.score),
        func.max(Score.score),
    ).first()

    top = (db.session.query(Score.player_name, func.max(Score.score).label('best'))
           .group_by(Score.player_name)
           .order_by(func.max(Score.score).desc())
           .limit(5)
           .all())

    result = {
        'total_games': stats[0],
        'avg_score':   round(float(stats[1] or 0), 1),
        'max_score':   stats[2] or 0,
        'top_players': [{'name': r[0], 'best': r[1]} for r in top],
    }
    return jsonify(result)


@app.get('/api/health')
def health():
    return jsonify({'status': 'ok', 'time': datetime.now(timezone.utc).isoformat()})


# ── Frontend static file serving ─────────────────────────────────────────────

@app.route('/')
def serve_index():
    return send_from_directory(FRONTEND_DIR, 'index.html')

@app.route('/assets/<path:filename>')
def serve_assets(filename):
    return send_from_directory(os.path.join(FRONTEND_DIR, 'assets'), filename)

@app.route('/js/<path:filename>')
def serve_js(filename):
    return send_from_directory(os.path.join(FRONTEND_DIR, 'js'), filename)


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001, debug=True)
