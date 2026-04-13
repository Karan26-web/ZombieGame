import os

REDIS_URL            = os.getenv('REDIS_URL',  'redis://localhost:6379/0')
CELERY_BROKER_URL    = REDIS_URL
CELERY_RESULT_BACKEND = REDIS_URL

DATABASE_URL         = os.getenv('DATABASE_URL', 'sqlite:///zombie_game.db')
SECRET_KEY           = os.getenv('SECRET_KEY',   'zombie-hop-dev-secret')

# Game session TTL in Redis (seconds)
SESSION_TTL = 60 * 30   # 30 minutes

# Difficulty tick (seconds) – mirrors frontend constant
DIFFICULTY_INTERVAL = 4.5
