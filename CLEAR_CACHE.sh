#!/bin/bash
# Script to clear HACS cache for PočasíMeteo Card

echo "Stopping Home Assistant..."
ha core stop

echo "Clearing HACS cache for PočasíMeteo Card..."
rm -rf /config/www/community/pocasimeteo-card/

echo "Clearing Lovelace cache..."
rm -rf /config/.storage/lovelace*

echo "Restarting Home Assistant..."
ha core restart

echo "Done! Wait for HA to restart, then hard refresh browser (Ctrl+Shift+F5)"
