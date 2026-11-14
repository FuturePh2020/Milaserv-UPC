#!/bin/sh
# ALKHAYR B2B — hosted smoke test (fix B). Run from a machine OUTSIDE the server against the real public host.
# Read-only except for refused requests: creates no account, order or session. Certificate verification is ALWAYS on
# (system trust store). CA_FILE / RESOLVE_IP exist only for the local rehearsal with a private test CA — a pass
# obtained with CA_FILE is LOCAL evidence, not public-TLS evidence.
#
#   sh hosted-smoke.sh portal.example.com [app-ip-to-probe]
#
# Exit 0 = every check passed; 1 = at least one failed. NOT covered here (do them by hand, see RELEASE_CHECKLIST §B):
# reboot persistence, browser cookie/CSRF/MFA journeys, off-server backup, restore drill, alert delivery.
set -u
set -f   # no filename expansion: the curl options below contain a literal *
HOST=${1:?usage: hosted-smoke.sh <public-host> [app-ip]}
APP_IP=${2:-}
U="https://$HOST"
C="curl -sS --max-time 20"
[ -n "${CA_FILE:-}" ] && C="$C --cacert $CA_FILE" && echo "NOTE: CA_FILE set — LOCAL rehearsal only, not public-trust evidence"
[ -n "${RESOLVE_IP:-}" ] && C="$C --noproxy * --resolve $HOST:443:$RESOLVE_IP --resolve $HOST:80:$RESOLVE_IP"
FAIL=0
ok() { echo "PASS  $1"; }
bad() { echo "FAIL  $1 — $2"; FAIL=1; }
t() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected $3, got $2"; fi; }

t "TLS handshake verified, /healthz 200" "$($C -o /dev/null -w '%{ssl_verify_result}/%{http_code}' "$U/healthz" 2>/dev/null)" "0/200"
R=$($C "$U/readyz" 2>/dev/null); case "$R" in *'"status":"ready"'*) ok "/readyz ready ($R)";; *) bad "/readyz" "$R";; esac
case "$R" in *version*|*path*|*sqlite*) bad "/readyz reveals details" "$R";; *) ok "/readyz reveals no details";; esac
RC=$($C -o /dev/null -w '%{http_code} %{redirect_url}' "http://$HOST/" 2>/dev/null)
case "$RC" in "301 https://$HOST/"|"308 https://$HOST/") ok "HTTP redirects to HTTPS ($RC)";; *) bad "HTTP→HTTPS" "$RC";; esac
HM=$($C -o /dev/null -w '%{http_code}' -H 'Host: evil.example' "$U/" 2>/dev/null)
case "$HM" in 421|404|400) ok "foreign Host header refused ($HM)";; *) bad "foreign Host header" "$HM";; esac
H=$($C -D - -o /dev/null "$U/" 2>/dev/null | tr -d '\r')
echo "$H" | grep -qi '^strict-transport-security: max-age=31536000$' && ok "HSTS one year, no includeSubDomains/preload" || bad "HSTS" "$(echo "$H" | grep -i '^strict-transport' || echo missing)"
t "exactly one Content-Security-Policy header" "$(echo "$H" | grep -ci '^content-security-policy:')" "1"
echo "$H" | grep -qiE '^(server|x-powered-by):' && bad "identifying headers" "$(echo "$H" | grep -iE '^(server|x-powered-by):')" || ok "no Server / X-Powered-By header"
t "API without a session → 401" "$($C -o /dev/null -w '%{http_code}' "$U/api/v1/auth/me" 2>/dev/null)" "401"
CC=$($C -D - -o /dev/null "$U/api/v1/auth/csrf" 2>/dev/null | tr -d '\r')
echo "$CC" | grep -qi '^cache-control:.*no-store' && ok "API responses are no-store" || bad "API cache-control" "$(echo "$CC" | grep -i '^cache-control' || echo missing)"
SC=$(echo "$CC" | grep -i '^set-cookie: __Host-alkhayr_presession=')
case "$SC" in *Secure*) case "$SC" in *HttpOnly*SameSite=Strict*|*SameSite=Strict*HttpOnly*) case "$SC" in *[Dd]omain=*) bad "pre-session cookie" "has Domain";; *) ok "__Host- cookie: Secure, HttpOnly, SameSite=Strict, no Domain";; esac;; *) bad "pre-session cookie attributes" "$SC";; esac;; *) bad "pre-session cookie" "${SC:-missing}";; esac
t "mutation without CSRF token/Origin refused" "$($C -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' "$U/api/v1/auth/login" 2>/dev/null)" "403"
t "foreign Origin refused" "$($C -o /dev/null -w '%{http_code}' -X POST -H 'Origin: https://evil.example' -H 'Content-Type: application/json' -d '{}' "$U/api/v1/auth/login" 2>/dev/null)" "403"
BIG=$(mktemp); head -c 3500000 /dev/zero | tr '\0' 'a' > "$BIG"
# Same-origin requests, so the body limit itself is what refuses them (a missing Origin would be refused earlier with 403).
t "declared 3.5 MB body → 413" "$($C -o /dev/null -w '%{http_code}' -X POST -H "Origin: $U" -H 'Content-Type: application/json' --data-binary @"$BIG" "$U/api/v1/auth/login" 2>/dev/null)" "413"
t "chunked 3.5 MB body → 413" "$($C -o /dev/null -w '%{http_code}' -X POST -H "Origin: $U" -H 'Transfer-Encoding: chunked' -H 'Content-Type: application/json' --data-binary @"$BIG" "$U/api/v1/auth/login" 2>/dev/null)" "413"
rm -f "$BIG"
t "application port 3000 not reachable on the public host" "$(curl -s --max-time 5 -o /dev/null -w '%{http_code}' "http://$HOST:3000/healthz" 2>/dev/null)" "000"
[ -n "$APP_IP" ] && t "application address $APP_IP:3000 not reachable" "$(curl -s --noproxy '*' --max-time 5 -o /dev/null -w '%{http_code}' -H "Host: $HOST" "http://$APP_IP:3000/healthz" 2>/dev/null)" "000"
if command -v openssl >/dev/null 2>&1 && [ -z "${RESOLVE_IP:-}" ]; then
  END=$(echo | openssl s_client -connect "$HOST:443" -servername "$HOST" 2>/dev/null | openssl x509 -noout -enddate -issuer 2>/dev/null | tr '\n' ' ')
  echo "INFO  certificate: $END"
fi
[ $FAIL -eq 0 ] && echo "RESULT: all checks passed" || echo "RESULT: FAILURES above"
exit $FAIL
