#!/bin/bash
printf '\033[33m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'
printf '    🟡  CELERY WORKER\n'
printf '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\033[0m\n'
cd "$(dirname "$0")/backend"
/opt/anaconda3/bin/celery -A tasks.celery_app worker --loglevel=info --concurrency=2
