"""
SQLAlchemy models for Zombie Hop.

Tables
------
players  – registered player names (lightweight, no auth)
scores   – every completed run score
"""

from datetime import datetime
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()


class Player(db.Model):
    __tablename__ = 'players'

    id         = db.Column(db.Integer, primary_key=True)
    name       = db.Column(db.String(50), unique=True, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    scores = db.relationship('Score', backref='player', lazy=True)

    def to_dict(self):
        return {'id': self.id, 'name': self.name}


class Score(db.Model):
    __tablename__ = 'scores'

    id          = db.Column(db.Integer, primary_key=True)
    player_id   = db.Column(db.Integer, db.ForeignKey('players.id'), nullable=False)
    player_name = db.Column(db.String(50), nullable=False)   # denormalised for fast queries
    score       = db.Column(db.Integer, nullable=False, default=0)
    distance    = db.Column(db.Integer, nullable=False, default=0)   # metres
    duration    = db.Column(db.Float,   nullable=True)                # seconds
    session_id  = db.Column(db.String(36), nullable=True)
    created_at  = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id':          self.id,
            'player_id':   self.player_id,
            'player_name': self.player_name,
            'score':       self.score,
            'distance':    self.distance,
            'duration':    self.duration,
            'created_at':  self.created_at.isoformat(),
        }
