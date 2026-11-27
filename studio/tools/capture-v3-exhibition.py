"""Delegate the previous capture entry point to the supported exhibition workflow."""
from pathlib import Path
from runpy import run_path


if __name__ == '__main__':
    script = Path(__file__).resolve().parents[1] / 'scripts' / 'capture-v4-exhibition.py'
    run_path(str(script), run_name='__main__')
