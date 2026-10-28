"""Start unmodified AstrBot and translate the supervisor stop request to SIGINT."""
import _thread
import runpy
import sys
import threading


def watch_control():
    for line in sys.stdin:
        if line.strip() == "stop":
            _thread.interrupt_main()
            return


threading.Thread(target=watch_control, daemon=True).start()
target = sys.argv[1]
sys.path.insert(0, str(__import__("pathlib").Path(target).parent))
sys.argv = sys.argv[1:]
runpy.run_path(target, run_name="__main__")
