#!/usr/bin/env python3
"""Optional local development server. The delivered game itself remains static."""
from functools import partial
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from pathlib import Path
import argparse
parser=argparse.ArgumentParser(description='Serve PULSE on localhost; no build dependencies.')
parser.add_argument('--port',type=int,default=8000)
args=parser.parse_args()
root=Path(__file__).resolve().parents[1]/'dist'
handler=partial(SimpleHTTPRequestHandler,directory=str(root))
print(f'PULSE: http://localhost:{args.port} — Ctrl+C to stop',flush=True)
ThreadingHTTPServer(('127.0.0.1',args.port),handler).serve_forever()
