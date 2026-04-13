#!/bin/bash
printf '\033[34m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'
printf '    🔵  CELERY BEAT  (scheduler)\n'
printf '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\033[0m\n'
cd "$(dirname "$0")/backend"
/opt/anaconda3/bin/celery -A tasks.celery_app beat --loglevel=info
