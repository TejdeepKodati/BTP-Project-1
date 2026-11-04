import os
import sys
import time
import subprocess
import re
import webbrowser

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLOUDFLARED_EXE = os.path.join(PROJECT_DIR, "scripts", "cloudflared.exe")
DOCKER_DESKTOP_EXE = r"C:\Program Files\Docker\Docker\Docker Desktop.exe"

def is_docker_running():
    try:
        res = subprocess.run(
            ["docker", "info"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
        )
        return res.returncode == 0
    except Exception:
        return False

def ensure_docker():
    if is_docker_running():
        return True

    print("[1/4] Docker Desktop is not currently running.")
    if os.path.exists(DOCKER_DESKTOP_EXE):
        print("      Launching Docker Desktop automatically, please wait...")
        subprocess.Popen([DOCKER_DESKTOP_EXE])
        for i in range(30):
            time.sleep(2)
            if is_docker_running():
                print("      Docker Engine is now ready!")
                return True
            print(f"      Waiting for Docker engine to initialize... ({i*2 + 2}s)")
    else:
        print("[!] Please open Docker Desktop manually, then re-run this script.")
        input("Press Enter once Docker Desktop is running...")
        return is_docker_running()
    return is_docker_running()

def ensure_containers():
    print("[2/4] Ensuring CycleSafe Docker containers are running...")
    res = subprocess.run(
        ["docker", "compose", "up", "-d"],
        cwd=PROJECT_DIR,
        capture_output=True,
        text=True
    )
    if res.returncode != 0:
        print(f"[!] Warning during docker compose: {res.stderr}")
    else:
        print("      Containers are active (Frontend, Backend, SUMO, Postgres, Redis).")

def copy_to_clipboard(text):
    try:
        subprocess.run(
            ["powershell", "-NoProfile", "-Command", f"Set-Clipboard -Value '{text}'"],
            check=True,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
        )
        return True
    except Exception:
        return False

def main():
    os.system("color 0A" if os.name == "nt" else "")
    print("=" * 72)
    print("       CycleSafe - Urban Bicycle Safety Simulation Platform")
    print("                   Deploy & Share Online")
    print("=" * 72)
    print()

    if not os.path.exists(CLOUDFLARED_EXE):
        print(f"[!] Error: cloudflared.exe not found at {CLOUDFLARED_EXE}")
        input("Press Enter to exit...")
        sys.exit(1)

    if not ensure_docker():
        print("[!] Could not connect to Docker. Exiting.")
        input("Press Enter to exit...")
        sys.exit(1)

    ensure_containers()

    print("[3/4] Establishing secure Cloudflare tunnel to local port 8081...")
    proc = subprocess.Popen(
        [CLOUDFLARED_EXE, "tunnel", "--url", "http://localhost:8081"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1
    )

    tunnel_url = None
    url_pattern = re.compile(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com")

    for line in iter(proc.stdout.readline, ''):
        match = url_pattern.search(line)
        if match:
            tunnel_url = match.group(0)
            break
        if proc.poll() is not None:
            print("[!] Cloudflare tunnel terminated unexpectedly.")
            break

    if not tunnel_url:
        print("[!] Failed to obtain public tunnel URL.")
        input("Press Enter to exit...")
        sys.exit(1)

    copy_to_clipboard(tunnel_url)

    print()
    print("=" * 72)
    print("             CYCLESAFE IS NOW LIVE ON THE INTERNET!             ")
    print("=" * 72)
    print()
    print(f"  Public Web URL:   {tunnel_url}")
    print("  Status:           ACTIVE & ACCESSIBLE WORLDWIDE")
    print()
    print("  * The URL has been automatically COPIED to your clipboard!")
    print("  * You can paste (Ctrl+V) and send it to your professor / panel.")
    print("  * Opening the link in your browser now...")
    print()
    print("  Local URL:        http://localhost:8081")
    print()
    print("-" * 72)
    print("  [!] KEEP THIS WINDOW OPEN while you want the public link to stay live.")
    print("      To stop sharing, press Ctrl+C or close this window.")
    print("=" * 72)
    print()

    try:
        webbrowser.open(tunnel_url)
    except Exception:
        pass

    try:
        while True:
            line = proc.stdout.readline()
            if not line and proc.poll() is not None:
                break
            time.sleep(0.5)
    except KeyboardInterrupt:
        print("\nStopping Cloudflare tunnel...")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except Exception:
            proc.kill()
        print("Tunnel closed. CycleSafe is no longer publicly shared.")
        time.sleep(1)

if __name__ == "__main__":
    main()
