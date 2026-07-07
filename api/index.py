"""
Vercel serverless entrypoint.

vercel.json rewrites every /api/* request to this function. The FastAPI
app lives in main.py at the repo root, so the root directory must be on
sys.path before the import, regardless of the working directory Vercel
uses when it loads this file.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from main import app  # noqa: E402,F401
