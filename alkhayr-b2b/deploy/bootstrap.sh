#!/bin/sh
# ALKHAYR B2B — one-command TRIAL/STAGING setup on a fresh Ubuntu (22.04/24.04) or Debian 12 server, x86_64.
# Run as root from the project folder:
#
#   sudo sh deploy/bootstrap.sh you@example.com            # free trial host name <public-ip>.sslip.io
#   sudo sh deploy/bootstrap.sh you@example.com portal.example.com   # your own domain (DNS A record → this server)
#
# What it does (idempotent; safe to run again; never deletes data, never overwrites existing secrets or .env):
#   1. installs Docker + Compose from the distribution packages; adds 2 GB swap on small servers (< 2 GB RAM)
#   2. builds the application image from this source
#   3. creates NEW secrets on this server (app secret, backup key; empty placeholders for off-server storage / alerts)
#   4. writes deploy/.env, initializes the database ONCE, starts app + proxy (Traefik) + backup + monitor
#   5. waits for the public HTTPS certificate and prints the next steps
#
# What it does NOT do: create the first administrator (interactive: you scan the authenticator code yourself),
# configure off-server backups or alerts (need your accounts), or open the portal to traders. TRIAL DATA ONLY.
#
# Local rehearsal only (no public certificate): TLS_MODE=file TLS_CERT_DIR=/path SKIP_INSTALL=1 PROJECT=name
set -eu
set -f   # no filename expansion (curl options below contain a literal *)
ACME_EMAIL=${1:-}
PUBLIC_HOST=${2:-}
TLS_MODE=${TLS_MODE:-acme}
PROJECT=${PROJECT:-alkhayr}
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(dirname "$HERE")
VERSION=$(sed -n 's/^  "version": "\(.*\)",$/\1/p' "$ROOT/package.json")
say() { printf '\n==> %s\n' "$*"; }
die() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "run as root (sudo sh deploy/bootstrap.sh …)"
[ -n "$VERSION" ] || die "cannot read the version from package.json"
case "$(uname -m)" in x86_64) ;; *) echo "WARNING: only x86_64 was tested; this machine is $(uname -m)";; esac
if [ "$TLS_MODE" = acme ]; then
  case "$ACME_EMAIL" in *@*.*) ;; *) die "give a contact e-mail for the certificate: sudo sh deploy/bootstrap.sh you@example.com";; esac
fi

if [ -z "${SKIP_INSTALL:-}" ]; then
  say "Installing Docker and tools"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq docker.io curl openssl ca-certificates >/dev/null
  apt-get install -y -qq docker-compose-v2 >/dev/null 2>&1 || apt-get install -y -qq docker-compose-plugin >/dev/null 2>&1 || true
  docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is not available from this distribution's packages; install it, then run again"
  systemctl enable --now docker >/dev/null 2>&1 || true
  MEM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
  if [ "$MEM_MB" -lt 1900 ] && [ ! -e /swapfile ] && [ "$(swapon --noheadings | wc -l)" = 0 ]; then
    say "Small server (${MEM_MB} MB RAM): adding a 2 GB swap file"
    (fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none) && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab
  fi
fi
docker info >/dev/null 2>&1 || die "Docker is not running"

if [ -z "$PUBLIC_HOST" ]; then
  IP=$(curl -fsS --max-time 10 https://api.ipify.org 2>/dev/null || curl -fsS --max-time 10 https://ifconfig.me 2>/dev/null || true)
  echo "$IP" | grep -Eq '^[0-9]+(\.[0-9]+){3}$' || die "cannot detect the public IPv4 address; pass the host name as the second argument"
  PUBLIC_HOST=$(echo "$IP" | tr . -).sslip.io
  echo "Using the free trial host name $PUBLIC_HOST (points to $IP automatically)"
fi

say "Building the application image alkhayr-b2b:$VERSION (a few minutes on a small server)"
docker build -q -t "alkhayr-b2b:$VERSION" "$ROOT" >/dev/null

cd "$HERE"
say "Secrets (created on this server only; existing files are kept)"
install -d -m 0700 -o 1000 -g 1000 secrets
umask 077
[ -s secrets/app_secret ] || openssl rand -base64 32 | tr '+/' '-_' | tr -d '=' > secrets/app_secret
for f in offsite_access_key offsite_secret_key alert_webhook_url; do [ -e "secrets/$f" ] || : > "secrets/$f"; done
for f in app_secret offsite_access_key offsite_secret_key alert_webhook_url; do chown 1000:1000 "secrets/$f" && chmod 0400 "secrets/$f"; done

if [ ! -e .env ]; then
  sed -e "s/^ALKHAYR_VERSION=.*/ALKHAYR_VERSION=$VERSION/" -e "s/^PUBLIC_HOST=.*/PUBLIC_HOST=$PUBLIC_HOST/" \
      -e "s/^TLS_MODE=.*/TLS_MODE=$TLS_MODE/" -e "s/^ACME_EMAIL=.*/ACME_EMAIL=$ACME_EMAIL/" \
      -e "s/^ALERT_LABEL=.*/ALERT_LABEL=trial/" -e "s/^MONITOR_TLS_HOST=.*/MONITOR_TLS_HOST=$PUBLIC_HOST:443/" env.example > .env
  [ -n "${TLS_CERT_DIR:-}" ] && echo "TLS_CERT_DIR=$TLS_CERT_DIR" >> .env
  echo "Wrote deploy/.env for $PUBLIC_HOST"
else
  sed -i "s/^ALKHAYR_VERSION=.*/ALKHAYR_VERSION=$VERSION/" .env
  PUBLIC_HOST=$(sed -n 's/^PUBLIC_HOST=//p' .env)
  echo "Keeping the existing deploy/.env (host $PUBLIC_HOST); version set to $VERSION"
fi
DC="docker compose -p $PROJECT --env-file .env -f compose.yaml -f compose.traefik.yaml"
$DC config --quiet

if [ ! -s secrets/backup.key ]; then
  $DC run --rm -v "$HERE/secrets:/k" cli backup:keygen --out /k/backup.key | grep -E 'Key id' || die "backup key generation failed"
  chown 1000:1000 secrets/backup.key && chmod 0400 secrets/backup.key
fi

say "Database"
if $DC run --rm cli db:status 2>/dev/null | grep -q '"initialized": true'; then
  echo "Already initialized — left untouched (run db:migrate --confirm-backup by hand when a release needs it)."
else
  $DC run --rm cli db:init | head -1
fi

say "Starting services (proxy: Traefik)"
$DC up -d app proxy-traefik backup monitor

say "Waiting for https://$PUBLIC_HOST (certificate issuance can take a minute)"
CURL="curl -fsS --max-time 10"
[ "$TLS_MODE" = file ] && [ -n "${TLS_TEST_CA:-}" ] && CURL="$CURL --noproxy * --cacert $TLS_TEST_CA --resolve $PUBLIC_HOST:443:127.0.0.1"
OK=0
for i in $(seq 1 60); do
  if $CURL "https://$PUBLIC_HOST/readyz" 2>/dev/null | grep -q '"status":"ready"'; then OK=1; break; fi
  sleep 5
done
$DC ps --format 'table {{.Service}}\t{{.Status}}'
if [ $OK = 1 ]; then
  say "READY: https://$PUBLIC_HOST  (certificate verified by curl)"
else
  echo
  echo "NOT READY YET. Check: ports 80 and 443 open in the provider firewall, the host name resolves to this server,"
  echo "and the proxy log:  cd $HERE && $DC logs --tail 50 proxy-traefik"
fi
cat <<EOF

Next steps (in this order):
  1. First administrator (interactive; scan the code with an authenticator app). The server must be stopped for it:
       cd $HERE
       $DC stop app
       $DC run --rm -it cli setup-admin
       $DC start app
  2. Tell the person running the tests the address:  https://$PUBLIC_HOST
  3. Keep OFFLINE copies, in two different places, of:  $HERE/secrets/app_secret  and  $HERE/secrets/backup.key
  4. Off-server backups and alerts are NOT configured (files secrets/offsite_* and secrets/alert_webhook_url are empty).
  This is a TRIAL environment: test data only, no real traders.
EOF
[ $OK = 1 ]
