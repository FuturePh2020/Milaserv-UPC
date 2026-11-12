"""Drive an interactive command through a pseudo-terminal (test helper only).

Usage: python3 -I pty_driver.py '<json>'
JSON: {"argv": [...], "env": {...}, "cwd": "...", "timeout": 30,
       "steps": [{"expect": "<regex>", "send": "<text>" | "{TOTP}" | "{CTRL_C}" | null}]}
"{TOTP}" sends the current TOTP code computed from the "Secret:" the command printed.
Prints JSON {"exit": <code>, "transcript": "<everything the terminal displayed>"}.
"""
import base64
import hashlib
import hmac
import json
import os
import pty
import re
import select
import struct
import sys
import time

cfg = json.loads(sys.argv[1])
pid, fd = pty.fork()
if pid == 0:
    os.chdir(cfg["cwd"])
    os.execve(cfg["argv"][0], cfg["argv"], cfg["env"])

transcript = b""
deadline = time.time() + cfg.get("timeout", 30)


def pump(wait):
    global transcript
    r, _, _ = select.select([fd], [], [], wait)
    if not r:
        return True
    try:
        data = os.read(fd, 4096)
    except OSError:
        return False
    if not data:
        return False
    transcript += data
    return True


position = 0


def expect(pattern):
    """Wait for `pattern` in output not yet consumed by an earlier expect."""
    global position
    rx = re.compile(pattern.encode())
    while True:
        m = rx.search(transcript, position)
        if m:
            position = m.end()
            return
        if time.time() > deadline:
            raise TimeoutError("timed out waiting for %r" % pattern)
        if not pump(0.2):
            m = rx.search(transcript, position)
            if m:
                position = m.end()
                return
            raise EOFError("process ended before %r" % pattern)


def totp_now():
    m = re.search(rb"Secret:\s*([A-Z2-7 ]+)\r?\n", transcript)
    secret = base64.b32decode(m.group(1).replace(b" ", b"") + b"=" * (-len(m.group(1).replace(b" ", b"")) % 8))
    counter = int(time.time() // 30)
    mac = hmac.new(secret, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = mac[-1] & 0x0F
    value = struct.unpack(">I", mac[offset:offset + 4])[0] & 0x7FFFFFFF
    return "%06d" % (value % 1000000)


error = None
try:
    for step in cfg["steps"]:
        expect(step["expect"])
        send = step.get("send")
        if send is None:
            continue
        if send == "{TOTP}":
            send = totp_now() + "\r"
        elif send == "{CTRL_C}":
            send = "\x03"
        else:
            send = send + "\r"
        os.write(fd, send.encode("utf-8"))
    while pump(0.2):
        if time.time() > deadline:
            break
except Exception as exc:  # report, then make sure the child is gone
    error = str(exc)

try:
    _, status = os.waitpid(pid, 0)
    code = os.waitstatus_to_exitcode(status)
except ChildProcessError:
    code = None
print(json.dumps({"exit": code, "error": error, "transcript": transcript.decode("utf-8", "replace")}))
