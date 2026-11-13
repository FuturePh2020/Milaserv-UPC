Secret FILES live here on the server only (this directory's other contents are git-ignored and
excluded from the Docker build context). Required: app_secret, backup.key; optional (off-server copy):
offsite_access_key, offsite_secret_key. Each: owner uid 1000, mode 0400. See docs/DEPLOYMENT_AR.md.
