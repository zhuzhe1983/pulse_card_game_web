#!/usr/bin/env python3
"""Compatibility entry point: the active build is now Clash only."""
import runpy
from pathlib import Path
runpy.run_path(str(Path(__file__).with_name('build_clash.py')), run_name='__main__')
