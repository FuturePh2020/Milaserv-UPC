Secret FILES live here on the server only (this directory's other contents are git-ignored and
excluded from the Docker build context). Required: app_secret, backup.key; optional (off-server copy):
offsite_access_key, offsite_secret_key; alert_webhook_url (monitoring webhook; may be EMPTY = log only).
All five files must exist (create the optional ones empty). Each: owner uid 1000, mode 0400. See docs/DEPLOYMENT_AR.md.
