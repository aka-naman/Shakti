Shakti

AeroForm Suite is an integrated application suite designed for offline, air-gapped Local Area Network (LAN) deployments. The suite includes a Form Builder, a Noting Engine, and a Unified Portal to serve as a secure and functional intranet portal.

## Project Structure

* **Agra-sandhani**: The Form Builder system. It consists of a production-compiled frontend (in `client/dist/`) and a Node.js backend server.
* **smart-office-noting**: A Flask-based noting engine that runs on Waitress to generate and manage official noting templates and documents.
* **Portal**: A unified web portal serving as the main entry point to navigate and access the Form Builder and Noting Engine.
* **Scripts**:
  * `HOST_ON_LAN.bat`: Launches all three servers (Form Builder, Noting Engine, Portal) on the local network.
  * `PREPARE_ALL_OFFLINE.bat`: Packages and prepares the applications for offline deployment.

## Prerequisites

To run this project, the host machine must have the following runtimes installed:
* Node.js (version 18 or later)
* Python (version 3.12 or later)
* PostgreSQL (version 15 or later)

## Configuration and Setup

### Database Migration
The suite uses PostgreSQL for database storage.

1. Create a PostgreSQL database named `form2builder`.
2. Update the credentials in `Agra-sandhani/.env` if necessary.
3. Import your schema and database structure using your backup dump files.

### Offline Settings
To function in a strict air-gapped network, the project is configured with the following optimizations:
* Local Fonts: No external Google Fonts CDN requests are made to prevent browser load latency.
* Local CSS/JS: Bootstrap and other framework dependencies are served from the local project files.
* Hostname Binding: Uses loopback address `127.0.0.1` internally and dynamic hostnames externally to adapt to LAN IP changes.

## Running the Application

### 1. Launch on LAN
Double-click `HOST_ON_LAN.bat` in the root folder. The script automatically:
* Retrieves the host machine's local LAN IP.
* Configures and starts the Form Builder API on port 5000.
* Starts the Noting Server on port 5001.
* Starts the Unified Portal on port 8080.

### 2. Configure Firewall Exception
To allow client machines on the local network to access the suite, open PowerShell as Administrator and run:
```powershell
New-NetFirewallRule -DisplayName "AeroForm Suite" -Direction Inbound -LocalPort 8080,5000,5001 -Protocol TCP -Action Allow
```

### 3. Access the Applications
From any machine connected to the same LAN, open a web browser and navigate to:
* **Unified Portal**: http://<server-ip>:8080
* **Form Builder**: http://<server-ip>:5000
* **Noting Engine**: http://<server-ip>:5001
