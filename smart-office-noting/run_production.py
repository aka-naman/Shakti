import os
import sys
import subprocess

# Auto-resolve virtual environment path
script_dir = os.path.dirname(os.path.abspath(__file__))
venv_path = os.path.join(script_dir, 'venv')

if os.path.exists(venv_path):
    # Pin site-packages for this Python environment
    if sys.platform == "win32":
        site_packages = os.path.join(venv_path, 'Lib', 'site-packages')
    else:
        site_packages = os.path.join(venv_path, 'lib', f'python{sys.version_info.major}.{sys.version_info.minor}', 'site-packages')
    
    if os.path.exists(site_packages) and site_packages not in sys.path:
        sys.path.insert(0, site_packages)

from app import app

if __name__ == "__main__":
    try:
        from waitress import serve
    except ImportError:
        print("[WARNING] Production WSGI server 'waitress' not found in current environment.")
        print("[INFO] Attempting to install waitress via pip...")
        try:
            # Install waitress in the resolved environment
            pip_bin = os.path.join(venv_path, 'Scripts', 'pip') if sys.platform == "win32" else os.path.join(venv_path, 'bin', 'pip')
            if not os.path.exists(pip_bin):
                pip_bin = 'pip'
            subprocess.check_call([pip_bin, 'install', 'waitress'])
            from waitress import serve
        except Exception as e:
            print(f"[ERROR] Failed to install waitress: {e}. Falling back to standard development server.")
            app.run(host="0.0.0.0", port=5001, debug=False, threaded=True)
            sys.exit(0)
            
    print("[INFO] Starting production Waitress server on http://0.0.0.0:5001...")
    print("[INFO] Thread Pool size: 16 concurrent workers (prevents GIL document bottlenecks)")
    
    # Run with 16 threads to handle concurrent CPU-heavy docx generation requests
    serve(app, host="0.0.0.0", port=5001, threads=16)
