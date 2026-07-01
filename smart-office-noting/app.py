# ============================================================
# app.py — ION Generator Flask Application (Upgraded)
# ============================================================

from flask import Flask, render_template, request, send_file, redirect, url_for, session, jsonify, flash
from werkzeug.utils import secure_filename
from logic.ion_generator import generate_ion
from logic.create_master import create_default_master
from logic.noting_generator import generate_tbrl_noting, generate_lecture_noting, generate_dgmss_noting, generate_fee_noting, generate_cancellation_noting  # NEW: TBRL Noting Generator Import
import os
import json
import shutil
import re
import docx
import requests
import threading
import time
from datetime import datetime

import logging
from logging.handlers import TimedRotatingFileHandler

# ── LOGGING SETUP ──
LOG_DIR = "logs"
if not os.path.exists(LOG_DIR):
    os.makedirs(LOG_DIR)

log_formatter = logging.Formatter(
    '[%(asctime)s] %(levelname)s - IP: %(client_ip)s - %(method)s %(url)s - %(message)s'
)

# Time-based rotation: Daily at midnight, keep for 30 days
log_handler = TimedRotatingFileHandler(
    os.path.join(LOG_DIR, "noting_app.log"),
    when="midnight",
    interval=1,
    backupCount=30,
    encoding="utf-8"
)
log_handler.setFormatter(log_formatter)

logger = logging.getLogger("noting_app")
logger.setLevel(logging.INFO)
logger.addHandler(log_handler)

# Console logger for visibility
console_handler = logging.StreamHandler()
console_handler.setFormatter(log_formatter)
logger.addHandler(console_handler)

app = Flask(__name__)
app.secret_key = "ion_generator_secret_2024"

# Middleware to add context to logs
@app.before_request
def log_request_info():
    extra = {
        'client_ip': request.headers.get('X-Forwarded-For', request.remote_addr),
        'method': request.method,
        'url': request.url
    }
    logger.info("Request received", extra=extra)

@app.errorhandler(Exception)
def handle_exception(e):
    extra = {
        'client_ip': request.headers.get('X-Forwarded-For', request.remote_addr),
        'method': request.method,
        'url': request.url
    }
    logger.error(f"Unhandled Exception: {str(e)}", extra=extra, exc_info=True)
    return jsonify({"error": "Internal server error"}), 500

# ── File Paths ──
DATA_FILE     = "data.json"
HISTORY_FILE  = "history.json"
DEFAULTS_FILE = "defaults.json"
MASTERS_FILE  = "masters.json"
CONFIG_FILE   = "config.json"

DEGREE_OPTIONS = ["B.Tech/B.E.", "M.Tech", "B.Sc", "M.Sc", "PhD"]

MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
]

# ══════════════════════════════════════
# HELPERS
# ══════════════════════════════════════
def load_json(filepath, default):
    if os.path.exists(filepath):
        with open(filepath, "r", encoding="utf-8") as f:
            return json.load(f)
    return default

def get_agra_api_url(endpoint="lookup"):
    """Dynamically resolves the Agra-sandhani API URL."""
    # 1. Check environment variable override
    env_url = os.environ.get("AGRA_API_URL")
    if env_url:
        return env_url.replace("/lookup", f"/{endpoint}")
        
    # 2. Check config
    config = load_json(CONFIG_FILE, {})
    base_url = config.get("integration", {}).get("agra_api_url", "http://127.0.0.1:5000/api/service/lookup")
    return base_url.replace("/lookup", f"/{endpoint}")

def cleanup_task():
    """Background task to delete old generated notices to save disk space."""
    OUTPUT_DIR = "generated_notices"
    while True:
        try:
            config = load_json(CONFIG_FILE, {})
            days = config.get("integration", {}).get("cleanup_days", 30)
            threshold = days * 24 * 60 * 60
            now = time.time()
            
            if os.path.exists(OUTPUT_DIR):
                count = 0
                for f in os.listdir(OUTPUT_DIR):
                    fpath = os.path.join(OUTPUT_DIR, f)
                    if os.path.isfile(fpath):
                        if now - os.path.getmtime(fpath) > threshold:
                            os.remove(fpath)
                            count += 1
                if count > 0:
                    logger.info(f"[CLEANUP] Purged {count} old generated documents.")
        except Exception as e:
            logger.error(f"[CLEANUP] Task failed: {str(e)}")
            
        # Run once every 24 hours
        time.sleep(24 * 60 * 60)

def save_json(filepath, data):
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=4, ensure_ascii=False)

def load_departments():
    return load_json(DATA_FILE, {"departments": []})["departments"]

def save_departments(departments):
    save_json(DATA_FILE, {"departments": departments})

def load_history():
    return load_json(HISTORY_FILE, {"history": []})["history"]

def save_history(entry):
    history = load_history()
    history.insert(0, entry)
    history = history[:20]
    save_json(HISTORY_FILE, {"history": history})

def load_defaults():
    return load_json(DEFAULTS_FILE, {})

def load_masters():
    return load_json(MASTERS_FILE, {"masters": []})["masters"]

def save_masters(masters):
    save_json(MASTERS_FILE, {"masters": masters})

def load_config():
    return load_json(CONFIG_FILE, {"password": "Tbrl0000"})

def check_password(password):
    config = load_config()
    return password == config.get("password", "Tbrl0000")

# ── NEW HELPER: Auto-Extract Variables ──
def extract_variables_from_docx(filepath):
    """Reads a .docx file and extracts all variables inside {{ }}"""
    doc = docx.Document(filepath)
    variables = set()
    pattern = r'\{\{(.+?)\}\}'
    
    for para in doc.paragraphs:
        matches = re.findall(pattern, para.text)
        for match in matches:
            variables.add(match.strip())
            
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                matches = re.findall(pattern, cell.text)
                for match in matches:
                    variables.add(match.strip())
                    
    return list(variables)

# ══════════════════════════════════════
# DASHBOARD
# ══════════════════════════════════════
@app.route("/")
def index():
    return render_template("dashboard.html",
        history=load_history()[:5],
        masters=load_masters()
    )

# ══════════════════════════════════════
# ION NOTICE FORM (Legacy / Original Form)
# ══════════════════════════════════════
@app.route("/ion-notice", methods=["GET"])
def ion_notice():
    saved    = session.pop("form_data", {})
    defaults = load_defaults()
    masters  = load_masters()
    
    # Determine which master is selected (first default fillable master, or first fillable master)
    fillable_masters = [m for m in masters if m.get("form_type") == "fillable"]
    selected_master_id = None
    if saved and saved.get("master_id"):
        selected_master_id = saved["master_id"]
    else:
        # Find first default fillable master
        default_master = next((m for m in fillable_masters if m.get("is_default")), None)
        if default_master:
            selected_master_id = default_master["id"]
        elif fillable_masters:
            selected_master_id = fillable_masters[0]["id"]
            
    selected_master = next((m for m in masters if m["id"] == selected_master_id), None)
    agra_import_form_id = selected_master.get("agra_import_form_id", selected_master.get("agra_form_id")) if selected_master else None
    agra_export_form_id = selected_master.get("agra_export_form_id", selected_master.get("agra_form_id")) if selected_master else None
    import_map = selected_master.get("import_map", selected_master.get("field_map", {})) if selected_master else {}
    export_map = selected_master.get("export_map", selected_master.get("field_map", {})) if selected_master else {}
            
    return render_template(
        "ion_form.html",
        departments=load_departments(),
        degree_options=DEGREE_OPTIONS,
        months=MONTHS,
        saved=saved,
        defaults=defaults,
        masters=masters,
        selected_master_id=selected_master_id,
        agra_import_form_id=agra_import_form_id,
        agra_export_form_id=agra_export_form_id,
        import_map=json.dumps(import_map),
        export_map=json.dumps(export_map)
    )

@app.route("/save-defaults", methods=["POST"])
def save_defaults_route():
    defaults = {
        "signatory_name":        request.form.get("signatory_name", ""),
        "signatory_designation": request.form.get("signatory_designation", ""),
    }
    save_json(DEFAULTS_FILE, defaults)
    session["form_data"] = {
        "master_id":             request.form.get("master_id"),
        "degree":                request.form.get("degree"),
        "start_month":           request.form.get("start_month"),
        "start_year":            request.form.get("start_year"),
        "end_month":             request.form.get("end_month"),
        "end_year":              request.form.get("end_year"),
        "last_date":             request.form.get("last_date"),
        "ion_number":            request.form.get("ion_number"),
        "notice_date":           request.form.get("notice_date"),
        "signatory_name":        request.form.get("signatory_name"),
        "signatory_designation": request.form.get("signatory_designation"),
        "departments":           request.form.getlist("departments"),
    }
    return redirect(url_for("ion_notice"))

@app.route("/preview", methods=["POST"])
def preview():
    departments = request.form.getlist("departments")
    num_cols    = 5
    num_rows    = -(-len(departments) // num_cols)
    padded      = departments + [""] * (num_rows * num_cols - len(departments))
    dept_rows   = [padded[r * num_cols:(r + 1) * num_cols] for r in range(num_rows)]

    data = {
        "master_id":             request.form.get("master_id"),
        "degree":                request.form.get("degree"),
        "start_month":           request.form.get("start_month"),
        "start_year":            request.form.get("start_year"),
        "end_month":             request.form.get("end_month"),
        "end_year":              request.form.get("end_year"),
        "last_date":             request.form.get("last_date"),
        "ion_number":            request.form.get("ion_number"),
        "notice_date":           request.form.get("notice_date"),
        "signatory_name":        request.form.get("signatory_name"),
        "signatory_designation": request.form.get("signatory_designation"),
        "departments":           departments,
        "dept_rows":             dept_rows,
    }
    session["form_data"] = data
    return render_template("ion_preview.html", data=data)

@app.route("/edit", methods=["POST"])
def edit():
    session["form_data"] = {
        "master_id":             request.form.get("master_id"),
        "degree":                request.form.get("degree"),
        "start_month":           request.form.get("start_month"),
        "start_year":            request.form.get("start_year"),
        "end_month":             request.form.get("end_month"),
        "end_year":              request.form.get("end_year"),
        "last_date":             request.form.get("last_date"),
        "ion_number":            request.form.get("ion_number"),
        "notice_date":           request.form.get("notice_date"),
        "signatory_name":        request.form.get("signatory_name"),
        "signatory_designation": request.form.get("signatory_designation"),
        "departments":           request.form.getlist("departments"),
    }
    return redirect(url_for("ion_notice"))

@app.route("/generate", methods=["POST"])
def generate():
    masters   = load_masters()
    master_id = request.form.get("master_id", "master_001")
    master    = next((m for m in masters if m["id"] == master_id), masters[0])

    data = {
        "degree":                request.form.get("degree"),
        "start_month":           request.form.get("start_month"),
        "start_year":            request.form.get("start_year"),
        "end_month":             request.form.get("end_month"),
        "end_year":              request.form.get("end_year"),
        "last_date":             request.form.get("last_date"),
        "ion_number":            request.form.get("ion_number"),
        "notice_date":           request.form.get("notice_date"),
        "signatory_name":        request.form.get("signatory_name"),
        "signatory_designation": request.form.get("signatory_designation"),
        "departments":           request.form.getlist("departments"),
    }

    filepath, filename = generate_ion(master["filename"], data)
    save_history({
        "filename":          filename,
        "degree":            data["degree"],
        "period":            f"{data['start_month']} {data['start_year']} - {data['end_month']} {data['end_year']}",
        "generated_at":      datetime.now().strftime("%d %b %Y, %I:%M %p"),
        "departments_count": len(data["departments"]),
        "master_used":       master["name"],
    })
    return send_file(filepath, as_attachment=True)

@app.route("/download", methods=["POST"])
def download():
    masters   = load_masters()
    master_id = request.form.get("master_id", "master_001")
    master    = next((m for m in masters if m["id"] == master_id), masters[0])

    data = {
        "degree":                request.form.get("degree"),
        "start_month":           request.form.get("start_month"),
        "start_year":            request.form.get("start_year"),
        "end_month":             request.form.get("end_month"),
        "end_year":              request.form.get("end_year"),
        "last_date":             request.form.get("last_date"),
        "ion_number":            request.form.get("ion_number"),
        "notice_date":           request.form.get("notice_date"),
        "signatory_name":        request.form.get("signatory_name"),
        "signatory_designation": request.form.get("signatory_designation"),
        "departments":           request.form.getlist("departments"),
    }

    filepath, filename = generate_ion(master["filename"], data)
    save_history({
        "filename":          filename,
        "degree":            data["degree"],
        "period":            f"{data['start_month']} {data['start_year']} - {data['end_month']} {data['end_year']}",
        "generated_at":      datetime.now().strftime("%d %b %Y, %I:%M %p"),
        "departments_count": len(data["departments"]),
        "master_used":       master["name"],
    })
    return send_file(filepath, as_attachment=True)

@app.route("/history/download/<filename>")
def download_history(filename):
    filepath = os.path.join("generated_notices", filename)
    if os.path.exists(filepath):
        return send_file(filepath, as_attachment=True)
    return "File not found", 404

@app.route("/history/clear", methods=["POST"])
def clear_history():
    save_json(HISTORY_FILE, {"history": []})
    return redirect(url_for("index"))

@app.route("/download-static/<master_id>", methods=["GET"])
def download_static(master_id):
    masters = load_masters()
    master = next((m for m in masters if m["id"] == master_id), None)
    
    if master and master.get("form_type") == "static":
        filepath = os.path.join("masters", master["filename"])
        if os.path.exists(filepath):
            save_history({
                "filename": master["filename"],
                "degree": "Blank Form",
                "period": "N/A",
                "generated_at": datetime.now().strftime("%d %b %Y, %I:%M %p"),
                "departments_count": 0,
                "master_used": master["name"],
            })
            return send_file(filepath, as_attachment=True, download_name=master["filename"])
            
    return "Form not found or is not a static document.", 404

# ══════════════════════════════════════
# DEPARTMENT MANAGER
# ══════════════════════════════════════
@app.route("/departments/add", methods=["POST"])
def add_department():
    name = request.form.get("new_dept", "").strip().upper()
    if name:
        departments = load_departments()
        if name not in departments:
            departments.append(name)
            save_departments(departments)
    return redirect(url_for("ion_notice"))

@app.route("/departments/delete/<name>", methods=["POST"])
def delete_department(name):
    departments = load_departments()
    departments = [d for d in departments if d != name]
    save_departments(departments)
    return redirect(url_for("ion_notice"))

@app.route("/departments/edit", methods=["POST"])
def edit_department():
    old_name = request.form.get("old_name", "").strip()
    new_name = request.form.get("new_name", "").strip().upper()
    if old_name and new_name:
        departments = load_departments()
        departments = [new_name if d == old_name else d for d in departments]
        save_departments(departments)
    return redirect(url_for("ion_notice"))

# ══════════════════════════════════════
# MASTER DOCUMENT MANAGER (Password Protected)
# ══════════════════════════════════════
@app.route("/masters", methods=["GET", "POST"])
def masters_page():
    error = None
    if request.method == "POST":
        password = request.form.get("password", "")
        if check_password(password):
            session["master_unlocked"] = True
            return redirect(url_for("masters_manager"))
        else:
            error = "❌ Incorrect password. Please try again."
    return render_template("master_password.html", error=error)

@app.route("/masters/manager")
def masters_manager():
    if not session.get("master_unlocked"):
        return redirect(url_for("masters_page"))
    return render_template("master_manager.html", masters=load_masters())

@app.route("/masters/lock")
def masters_lock():
    session.pop("master_unlocked", None)
    return redirect(url_for("index"))

@app.route("/masters/create", methods=["POST"])
def create_master():
    if not session.get("master_unlocked"):
        return redirect(url_for("masters_page"))

    source_id   = request.form.get("source_id")
    name        = request.form.get("name", "").strip()
    description = request.form.get("description", "").strip()

    if not name:
        return redirect(url_for("masters_manager"))

    masters     = load_masters()
    source      = next((m for m in masters if m["id"] == source_id), masters[0])

    new_id       = f"master_{str(len(masters)+1).zfill(3)}"
    new_filename = f"{new_id}.docx"

    src_path = os.path.join("masters", source["filename"])
    dst_path = os.path.join("masters", new_filename)
    shutil.copy2(src_path, dst_path)

    masters.append({
        "id":          new_id,
        "name":        name,
        "description": description,
        "filename":    new_filename,
        "created_at":  datetime.now().strftime("%Y-%m-%d"),
        "is_default":  False,
        "form_type":   "static", # Ensures backward compatibility 
        "field_map":   {}
    })
    save_masters(masters)
    return redirect(url_for("masters_manager"))

# ── NEW ROUTE: Upload Brand New Document & Extract Variables ──
@app.route("/masters/upload-new", methods=["POST"])
def upload_new_master():
    if not session.get("master_unlocked"):
        return redirect(url_for("masters_page"))
    
    if 'file' not in request.files:
        flash("No file provided.")
        return redirect(url_for("masters_manager"))
        
    file = request.files['file']
    name = request.form.get("name", "Unnamed Master").strip()
    description = request.form.get("description", "Uploaded via Document Manager").strip()
    
    if file and file.filename.endswith('.docx'):
        masters = load_masters()
        new_id = f"master_{str(len(masters)+1).zfill(3)}"
        safe_filename = secure_filename(f"{new_id}_{file.filename}")
        
        # Save file to masters folder
        os.makedirs("masters", exist_ok=True)
        filepath = os.path.join("masters", safe_filename)
        file.save(filepath)
        
        # Trigger Variable Extraction
        variables = extract_variables_from_docx(filepath)
        
        # 🧠 SMART CATEGORIZATION LOGIC
        if len(variables) > 0:
            form_type = "dynamic"
            flash_msg = f"✨ Dynamic Master added! Extracted {len(variables)} form fields."
        else:
            form_type = "static"
            flash_msg = "🖨️ Static Template added! No variables found, saving as a printable blank document."
        
        # Append to masters.json
        masters.append({
            "id": new_id,
            "name": name,
            "description": description,
            "filename": safe_filename,
            "created_at": datetime.now().strftime("%Y-%m-%d"),
            "is_default": False,
            "form_type": form_type,  # Now correctly assigns dynamic vs static
            "variables": variables,
            "field_map": {}
        })
        save_masters(masters)
        flash(flash_msg)
        
    return redirect(url_for("masters_manager"))

@app.route("/masters/toggle-default/<master_id>", methods=["POST"])
def toggle_default_master(master_id):
    if not session.get("master_unlocked"):
        return redirect(url_for("masters_page"))
    masters = load_masters()
    for m in masters:
        if m["id"] == master_id:
            m["is_default"] = not m.get("is_default", False)
            break
    save_masters(masters)
    return redirect(url_for("masters_manager"))

@app.route("/masters/delete/<master_id>", methods=["POST"])
def delete_master(master_id):
    if not session.get("master_unlocked"):
        return redirect(url_for("masters_page"))
        
    # 🔒 NEW: Secondary password check for deletion
    confirm_password = request.form.get("confirm_password", "")
    if not check_password(confirm_password):
        flash("❌ Incorrect password! Deletion cancelled.")
        return redirect(url_for("masters_manager"))

    masters = load_masters()
    master  = next((m for m in masters if m["id"] == master_id), None)
    
    if master and not master.get("is_default"):
        filepath = os.path.join("masters", master["filename"])
        if os.path.exists(filepath):
            try:
                os.remove(filepath)
            except OSError:
                pass # Ignore if file was already removed manually
                
        masters = [m for m in masters if m["id"] != master_id]
        save_masters(masters)
        flash(f"🗑️ Master template '{master['name']}' was permanently deleted.")
        
    return redirect(url_for("masters_manager"))

@app.route("/masters/download/<master_id>")
def download_master(master_id):
    if not session.get("master_unlocked"):
        return redirect(url_for("masters_page"))
    masters = load_masters()
    master  = next((m for m in masters if m["id"] == master_id), None)
    if master:
        filepath = os.path.join("masters", master["filename"])
        if os.path.exists(filepath):
            return send_file(filepath, as_attachment=True,
                           download_name=f"{master['name']}.docx")
    return "Master not found", 404

@app.route("/masters/upload/<master_id>", methods=["POST"])
def upload_master(master_id):
    if not session.get("master_unlocked"):
        return redirect(url_for("masters_page"))
    masters = load_masters()
    master  = next((m for m in masters if m["id"] == master_id), None)
    if master and "file" in request.files:
        file = request.files["file"]
        if file.filename.endswith(".docx"):
            filepath = os.path.join("masters", master["filename"])
            file.save(filepath)
    return redirect(url_for("masters_manager"))

# ══════════════════════════════════════
# DYNAMIC FORM RENDERING & SUBMISSION
# ══════════════════════════════════════
@app.route('/dynamic-form/<master_id>')
def dynamic_form(master_id):
    masters = load_masters()
    master = next((m for m in masters if m["id"] == master_id), None)
    
    if not master or master.get("form_type") != "dynamic":
        return "Dynamic form not found or invalid type.", 404
    
    agra_form_id = master.get("agra_form_id")
    field_map = master.get("field_map", {})
        
    return render_template('dynamic_form.html', template=master, agra_form_id=agra_form_id, field_map=json.dumps(field_map))

import docx # Make sure this is imported at the top of app.py

@app.route('/submit-dynamic', methods=['POST'])
def submit_dynamic():
    master_id = request.form.get("template_id")
    masters = load_masters()
    master = next((m for m in masters if m["id"] == master_id), None)
    
    if not master:
        return "Master not found", 404
        
    # 1. Grab all the user's answers from the form
    data = {}
    for var in master.get("variables", []):
        data[var] = request.form.get(var, "")
        
    # 2. Open the Master Document
    master_path = os.path.join("masters", master["filename"])
    doc = docx.Document(master_path)
    
    # 3. Universal Run-Level Replace Function
    def replace_text(paragraph, key, value):
        placeholder = f"{{{{{key}}}}}" # Looks for {{variable_name}}
        for run in paragraph.runs:
            if placeholder in run.text:
                run.text = run.text.replace(placeholder, str(value))

    # 4. Search and Replace in standard text
    for para in doc.paragraphs:
        for k, v in data.items():
            replace_text(para, k, v)
            
    # 5. Search and Replace inside tables
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                for para in cell.paragraphs:
                    for k, v in data.items():
                        replace_text(para, k, v)
                        
    # 6. Save the new generated file
    os.makedirs("generated_notices", exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"Dynamic_{master['name'].replace(' ', '_')}_{timestamp}.docx"
    output_path = os.path.join("generated_notices", filename)
    doc.save(output_path)
    
    # 7. Add to history
    save_history({
        "filename": filename,
        "degree": "Dynamic Form",
        "period": "N/A",
        "generated_at": datetime.now().strftime("%d %b %Y, %I:%M %p"),
        "departments_count": len(data),
        "master_used": master["name"],
    })
    
    # 8. Send to user
    return send_file(output_path, as_attachment=True)

# ══════════════════════════════════════
# TBRL NOTING GENERATOR (NEW)
# ══════════════════════════════════════
@app.route("/tbrl-noting", methods=["GET"])
def tbrl_noting():
    defaults = load_defaults()
    groups = ["AFTD", "ADS", "BIDS", "BEHI", "SS", "TELIC", "PPG", "QMG", "ETF", "PC", "WHD", "EXPD", "WHT&E", "ARISE", "PCD", "AIG", "RTRS", "S&D", "R&QA", "WKS", "SEED", "CERBERUS", "DPB", "HSP", "I2G", "HRDD"]
    courses = ["C.E.P.", "Seminar", "Conference", "Workshop", "Training Course", "Program Course", "M.D.P.", "Lecture", "Symposim", "Conclave", "Meeting", "Short Term Course"]
    
    masters = load_masters()
    masters = load_masters()
    master = next((m for m in masters if m["id"] == "master_tbrl_001"), None)
    agra_import_form_id = master.get("agra_import_form_id", master.get("agra_form_id")) if master else None
    agra_export_form_id = master.get("agra_export_form_id", master.get("agra_form_id")) if master else None
    import_map = master.get("import_map", master.get("field_map", {})) if master else {}
    export_map = master.get("export_map", master.get("field_map", {})) if master else {}
    
    return render_template("tbrl_noting_form.html", defaults=defaults, groups=groups, courses=courses, agra_import_form_id=agra_import_form_id, agra_export_form_id=agra_export_form_id, import_map=json.dumps(import_map), export_map=json.dumps(export_map))

@app.route("/generate-noting", methods=["POST"])
def generate_noting():
    # 1. Update Signatory Defaults in Memory
    defaults = load_defaults()
    defaults["sig1_name"] = request.form.get("sig1_name", "")
    defaults["sig1_desig"] = request.form.get("sig1_desig", "")
    defaults["sig2_name"] = request.form.get("sig2_name", "")
    defaults["sig2_desig"] = request.form.get("sig2_desig", "")
    save_json(DEFAULTS_FILE, defaults)

    # 2. Extract Table Configuration & Data
    columns = request.form.getlist("table_columns")
    num_rows = int(request.form.get("num_rows", 1))
    
    nominees = []
    for i in range(num_rows):
        row_data = {}
        for col in columns:
            # Gets input named like 'Name & Design._0'
            row_data[col] = request.form.get(f"{col}_{i}", "")
        nominees.append(row_data)

    # 3. Handle 'Other' Course Type
    course_type = request.form.get("course_type")
    if course_type == "Others":
        course_type = request.form.get("custom_course_type", "Course")

    # 4. Compile all data to send to noting_generator.py
    data = {
        "ref_no": request.form.get("ref_no"),
        "subject_hindi": request.form.get("subject_hindi"),
        "subject_english": request.form.get("subject_english"),
        "reference_text": request.form.get("reference_text"),
        "ref_date": request.form.get("ref_date"),
        "start_date": request.form.get("start_date"),
        "end_date": request.form.get("end_date"),
        "org_institute": request.form.get("org_institute"),
        "course_title": request.form.get("course_title"),
        "course_type": course_type,
        "group_name": request.form.get("group_name"),
        "sig1_name": defaults["sig1_name"],
        "sig1_desig": defaults["sig1_desig"],
        "sig2_name": defaults["sig2_name"],
        "sig2_desig": defaults["sig2_desig"],
        "columns": columns,
        "nominees": nominees,
        "lab_name": request.form.get("lab_name", "TBRL")
    }

    # 5. Generate Document
    filepath, filename = generate_tbrl_noting(data)
    
    # 6. Save to Dashboard History
    save_history({
        "filename": filename,
        "degree": "TBRL Noting",
        "period": f"{data.get('start_date', '')} to {data.get('end_date', '')}",
        "generated_at": datetime.now().strftime("%d %b %Y, %I:%M %p"),
        "departments_count": len(nominees),
        "master_used": "TBRL Noting Master"
    })
    
    return send_file(filepath, as_attachment=True)


# ══════════════════════════════════════
# LECTURE NOTING GENERATOR
# ══════════════════════════════════════
@app.route("/lecture-noting", methods=["GET"])
def lecture_noting():
    defaults = load_defaults()
    groups = ["AFTD", "ADS", "BIDS", "BEHI", "SS", "TELIC", "PPG", "QMG", "ETF", "PC", "WHD", "EXPD", "WHT&E", "ARISE", "PCD", "AIG", "RTRS", "S&D", "R&QA", "WKS", "SEED", "CERBERUS", "DPB", "HSP", "I2G", "HRDD"]
    courses = ["C.E.P.", "Seminar", "Conference", "Workshop", "Training Course", "Program Course", "M.D.P.", "Lecture", "Symposim", "Conclave", "Meeting", "Short Term Course", "STC", "TTC"]
    
    masters = load_masters()
    master = next((m for m in masters if m["id"] == "master_tbrl_002"), None)
    agra_import_form_id = master.get("agra_import_form_id", master.get("agra_form_id")) if master else None
    agra_export_form_id = master.get("agra_export_form_id", master.get("agra_form_id")) if master else None
    import_map = master.get("import_map", master.get("field_map", {})) if master else {}
    export_map = master.get("export_map", master.get("field_map", {})) if master else {}
    
    return render_template("lecture_noting_form.html", defaults=defaults, groups=groups, courses=courses, agra_import_form_id=agra_import_form_id, agra_export_form_id=agra_export_form_id, import_map=json.dumps(import_map), export_map=json.dumps(export_map))


@app.route("/generate-lecture-noting", methods=["POST"])
def generate_lecture_noting_route():
    # 1. Update Signatory Defaults in Memory
    defaults = load_defaults()
    defaults["sig1_name"] = request.form.get("sig1_name", "")
    defaults["sig1_desig"] = request.form.get("sig1_desig", "")
    defaults["sig2_name"] = request.form.get("sig2_name", "")
    defaults["sig2_desig"] = request.form.get("sig2_desig", "")
    save_json(DEFAULTS_FILE, defaults)

    # 2. Extract Table Configuration & Data
    columns = request.form.getlist("table_columns")
    num_rows = int(request.form.get("num_rows", 1))
    
    nominees = []
    for i in range(num_rows):
        row_data = {}
        for col in columns:
            row_data[col] = request.form.get(f"{col}_{i}", "")
        nominees.append(row_data)

    course_type = request.form.get("course_type")
    
    # Compile all data
    data = {
        "ref_no": request.form.get("ref_no"),
        "subject_hindi": request.form.get("subject_hindi"),
        "subject_english": request.form.get("subject_english"),
        "reference_text": request.form.get("reference_text"),
        "ref_date": request.form.get("ref_date"),
        "start_date": request.form.get("start_date"),
        "end_date": request.form.get("end_date"),
        "org_institute": request.form.get("org_institute"),
        "course_title": request.form.get("course_title"),
        "lecture_title": request.form.get("lecture_title"),
        "course_type": course_type,
        "group_name": request.form.get("group_name"),
        "sig1_name": defaults["sig1_name"],
        "sig1_desig": defaults["sig1_desig"],
        "sig2_name": defaults["sig2_name"],
        "sig2_desig": defaults["sig2_desig"],
        "columns": columns,
        "nominees": nominees,
        "lab_name": request.form.get("lab_name", "TBRL")
    }

    # Generate Document
    filepath, filename = generate_lecture_noting(data)
    
    # Save to Dashboard History
    save_history({
        "filename": filename,
        "degree": "Lecture Noting",
        "period": f"{data.get('start_date', '')} to {data.get('end_date', '')}",
        "generated_at": datetime.now().strftime("%d %b %Y, %I:%M %p"),
        "departments_count": len(nominees),
        "master_used": "Lecture Noting Master"
    })
    
    return send_file(filepath, as_attachment=True)


# ══════════════════════════════════════
# DGMSS NOTING GENERATOR
# ══════════════════════════════════════
@app.route("/dgmss-noting", methods=["GET"])
def dgmss_noting():
    defaults = load_defaults()
    groups = ["AFTD", "ADS", "BIDS", "BEHI", "SS", "TELIC", "PPG", "QMG", "ETF", "PC", "WHD", "EXPD", "WHT&E", "ARISE", "PCD", "AIG", "RTRS", "S&D", "R&QA", "WKS", "SEED", "CERBERUS", "DPB", "HSP", "I2G", "HRDD", "BTS"]
    courses = ["C.E.P.", "Seminar", "Conference", "Workshop", "Training Course", "Program Course", "M.D.P.", "Lecture", "Symposim", "Conclave", "Meeting", "Short Term Course", "STC", "TTC", "शॉर्ट ट्र्म फॉरेन ट्रेनिंग कार्यक्रम"]
    
    masters = load_masters()
    master = next((m for m in masters if m["id"] == "master_tbrl_003"), None)
    agra_import_form_id = master.get("agra_import_form_id", master.get("agra_form_id")) if master else None
    agra_export_form_id = master.get("agra_export_form_id", master.get("agra_form_id")) if master else None
    import_map = master.get("import_map", master.get("field_map", {})) if master else {}
    export_map = master.get("export_map", master.get("field_map", {})) if master else {}
    
    return render_template("dgmss_noting_form.html", defaults=defaults, groups=groups, courses=courses, agra_import_form_id=agra_import_form_id, agra_export_form_id=agra_export_form_id, import_map=json.dumps(import_map), export_map=json.dumps(export_map))


@app.route("/generate-dgmss-noting", methods=["POST"])
def generate_dgmss_noting_route():
    # 1. Update Signatory Defaults in Memory
    defaults = load_defaults()
    defaults["sig1_name"] = request.form.get("sig1_name", "")
    defaults["sig1_desig"] = request.form.get("sig1_desig", "")
    defaults["sig2_name"] = request.form.get("sig2_name", "")
    defaults["sig2_desig"] = request.form.get("sig2_desig", "")
    save_json(DEFAULTS_FILE, defaults)

    # 2. Extract Table Configuration & Data
    columns = request.form.getlist("table_columns")
    num_rows = int(request.form.get("num_rows", 1))
    
    nominees = []
    for i in range(num_rows):
        row_data = {}
        for col in columns:
            row_data[col] = request.form.get(f"{col}_{i}", "")
        nominees.append(row_data)

    course_type = request.form.get("course_type")
    
    # Compile all data
    data = {
        "ref_no": request.form.get("ref_no"),
        "subject_hindi": request.form.get("subject_hindi"),
        "subject_english": request.form.get("subject_english"),
        "reference_text": request.form.get("reference_text"),
        "ref_date": request.form.get("ref_date"),
        "start_date": request.form.get("start_date"),
        "end_date": request.form.get("end_date"),
        "org_institute": request.form.get("org_institute"),
        "course_title": request.form.get("course_title"),
        "course_type": course_type,
        "group_name": request.form.get("group_name"),
        "sig1_name": defaults["sig1_name"],
        "sig1_desig": defaults["sig1_desig"],
        "sig2_name": defaults["sig2_name"],
        "sig2_desig": defaults["sig2_desig"],
        "columns": columns,
        "nominees": nominees,
        "lab_name": request.form.get("lab_name", "TBRL")
    }

    # Generate Document
    filepath, filename = generate_dgmss_noting(data)
    
    # Save to Dashboard History
    save_history({
        "filename": filename,
        "degree": "DGMSS Noting",
        "period": f"{data.get('start_date', '')} to {data.get('end_date', '')}",
        "generated_at": datetime.now().strftime("%d %b %Y, %I:%M %p"),
        "departments_count": len(nominees),
        "master_used": "DGMSS Noting Master"
    })
    
    return send_file(filepath, as_attachment=True)


# FEE RELATED NOTING GENERATOR
# ══════════════════════════════════════
@app.route("/fee-noting", methods=["GET"])
def fee_noting():
    defaults = load_defaults()
    groups = ["AFTD", "ADS", "BIDS", "BEHI", "SS", "TELIC", "PPG", "QMG", "ETF", "PC", "WHD", "EXPD", "WHT&E", "ARISE", "PCD", "AIG", "RTRS", "S&D", "R&QA", "WKS", "SEED", "CERBERUS", "DPB", "HSP", "I2G", "HRDD", "BTS"]
    courses = ["C.E.P.", "Seminar", "Conference", "Workshop", "Training Course", "Program Course", "M.D.P.", "Lecture", "Symposim", "Conclave", "Meeting", "Short Term Course", "STC", "TTC", "सीनियर एक्स्क्यूटिव कार्यक्रम"]
    
    masters = load_masters()
    master = next((m for m in masters if m["id"] == "master_tbrl_004"), None)
    agra_import_form_id = master.get("agra_import_form_id", master.get("agra_form_id")) if master else None
    agra_export_form_id = master.get("agra_export_form_id", master.get("agra_form_id")) if master else None
    import_map = master.get("import_map", master.get("field_map", {})) if master else {}
    export_map = master.get("export_map", master.get("field_map", {})) if master else {}
    
    return render_template("fee_noting_form.html", defaults=defaults, groups=groups, courses=courses, agra_import_form_id=agra_import_form_id, agra_export_form_id=agra_export_form_id, import_map=json.dumps(import_map), export_map=json.dumps(export_map))


@app.route("/generate-fee-noting", methods=["POST"])
def generate_fee_noting_route():
    # 1. Update Signatory Defaults in Memory
    defaults = load_defaults()
    defaults["sig1_name"] = request.form.get("sig1_name", "")
    defaults["sig1_desig"] = request.form.get("sig1_desig", "")
    defaults["sig2_name"] = request.form.get("sig2_name", "")
    defaults["sig2_desig"] = request.form.get("sig2_desig", "")
    save_json(DEFAULTS_FILE, defaults)

    # 2. Extract Table Configuration & Data
    columns = request.form.getlist("table_columns")
    num_rows = int(request.form.get("num_rows", 1))
    
    nominees = []
    for i in range(num_rows):
        row_data = {}
        for col in columns:
            row_data[col] = request.form.get(f"{col}_{i}", "")
        nominees.append(row_data)

    course_type = request.form.get("course_type")
    
    # Compile all data
    data = {
        "ref_no": request.form.get("ref_no"),
        "subject_hindi": request.form.get("subject_hindi"),
        "subject_english": request.form.get("subject_english"),
        "reference_text": request.form.get("reference_text"),
        "ref_date": request.form.get("ref_date"),
        "ref_mail_date": request.form.get("ref_mail_date"),
        "start_date": request.form.get("start_date"),
        "end_date": request.form.get("end_date"),
        "org_institute": request.form.get("org_institute"),
        "course_title": request.form.get("course_title"),
        "course_type": course_type,
        "group_name": request.form.get("group_name"),
        "sig1_name": defaults["sig1_name"],
        "sig1_desig": defaults["sig1_desig"],
        "sig2_name": defaults["sig2_name"],
        "sig2_desig": defaults["sig2_desig"],
        "columns": columns,
        "nominees": nominees,
        "lab_name": request.form.get("lab_name", "टीबीआरएल")
    }

    # Generate Document
    filepath, filename = generate_fee_noting(data)
    
    # Save to Dashboard History
    save_history({
        "filename": filename,
        "degree": "Fee Related Noting",
        "period": f"{data.get('start_date', '')} to {data.get('end_date', '')}",
        "generated_at": datetime.now().strftime("%d %b %Y, %I:%M %p"),
        "departments_count": len(nominees),
        "master_used": "Fee Related Noting Master"
    })
    
    return send_file(filepath, as_attachment=True)


# NOMINATION CANCELLATION NOTING GENERATOR
# ══════════════════════════════════════
@app.route("/cancellation-noting", methods=["GET"])
def cancellation_noting():
    defaults = load_defaults()
    groups = ["AFTD", "ADS", "BIDS", "BEHI", "SS", "TELIC", "PPG", "QMG", "ETF", "PC", "WHD", "EXPD", "WHT&E", "ARISE", "PCD", "AIG", "RTRS", "S&D", "R&QA", "WKS", "SEED", "CERBERUS", "DPB", "HSP", "I2G", "HRDD", "BTS"]
    courses = ["C.E.P.", "Seminar", "Conference", "Workshop", "Training Course", "Program Course", "M.D.P.", "Lecture", "Symposim", "Conclave", "Meeting", "Short Term Course", "STC", "TTC", "सीनियर एक्स्क्यूटिव कार्यक्रम", "कॉन्फेरेंस"]
    
    masters = load_masters()
    master = next((m for m in masters if m["id"] == "master_tbrl_005"), None)
    agra_import_form_id = master.get("agra_import_form_id", master.get("agra_form_id")) if master else None
    agra_export_form_id = master.get("agra_export_form_id", master.get("agra_form_id")) if master else None
    import_map = master.get("import_map", master.get("field_map", {})) if master else {}
    export_map = master.get("export_map", master.get("field_map", {})) if master else {}
    
    return render_template("cancellation_noting_form.html", defaults=defaults, groups=groups, courses=courses, agra_import_form_id=agra_import_form_id, agra_export_form_id=agra_export_form_id, import_map=json.dumps(import_map), export_map=json.dumps(export_map))


@app.route("/generate-cancellation-noting", methods=["POST"])
def generate_cancellation_noting_route():
    # 1. Update Signatory Defaults in Memory
    defaults = load_defaults()
    defaults["sig1_name"] = request.form.get("sig1_name", "")
    defaults["sig1_desig"] = request.form.get("sig1_desig", "")
    defaults["sig2_name"] = request.form.get("sig2_name", "")
    defaults["sig2_desig"] = request.form.get("sig2_desig", "")
    save_json(DEFAULTS_FILE, defaults)

    # 2. Extract Table Configuration & Data
    columns = request.form.getlist("table_columns")
    num_rows = int(request.form.get("num_rows", 1))
    
    nominees = []
    for i in range(num_rows):
        row_data = {}
        for col in columns:
            row_data[col] = request.form.get(f"{col}_{i}", "")
        nominees.append(row_data)

    course_type = request.form.get("course_type")
    
    # Compile all data
    data = {
        "ref_no": request.form.get("ref_no"),
        "subject_hindi": request.form.get("subject_hindi"),
        "subject_english": request.form.get("subject_english"),
        "reference_text": request.form.get("reference_text"),
        "ref_date": request.form.get("ref_date"),
        "ref_mail_date": request.form.get("ref_mail_date"),
        "ion_ref_source": request.form.get("ion_ref_source"),
        "ion_ref_date": request.form.get("ion_ref_date"),
        "cancel_nominee_name": request.form.get("cancel_nominee_name"),
        "cancel_group_name": request.form.get("cancel_group_name"),
        "cancel_reason": request.form.get("cancel_reason"),
        "course_type_short": request.form.get("course_type_short"),
        "start_date": request.form.get("start_date"),
        "end_date": request.form.get("end_date"),
        "org_institute": request.form.get("org_institute"),
        "course_title": request.form.get("course_title"),
        "course_type": course_type,
        "group_name": request.form.get("group_name"),
        "sig1_name": defaults["sig1_name"],
        "sig1_desig": defaults["sig1_desig"],
        "sig2_name": defaults["sig2_name"],
        "sig2_desig": defaults["sig2_desig"],
        "columns": columns,
        "nominees": nominees,
        "lab_name": request.form.get("lab_name", "टीबीआरएल")
    }

    # Generate Document
    filepath, filename = generate_cancellation_noting(data)
    
    # Save to Dashboard History
    save_history({
        "filename": filename,
        "degree": "Nomination Cancellation",
        "period": f"{data.get('start_date', '')} to {data.get('end_date', '')}",
        "generated_at": datetime.now().strftime("%d %b %Y, %I:%M %p"),
        "departments_count": len(nominees),
        "master_used": "Nomination Cancellation Master"
    })
    
    return send_file(filepath, as_attachment=True)


# ── API History ──
@app.route("/api/history")
def api_history():
    from flask import jsonify
    return jsonify({"history": load_history()})

# ── Restructured Module Routes (Training & Internship) ──
@app.route("/training")
def training_menu():
    """Renders the Training Module submenu with pillars."""
    category = request.args.get("sub_module", "noting")
    return render_template("training_menu.html", active_category=category)

@app.route("/internship")
def internship_menu():
    """Renders the Internship Module submenu."""
    return render_template("internship_menu.html")

@app.route("/api/templates")
def api_templates():
    """Returns templates filtered by module and sub_module."""
    module = request.args.get("module")
    sub_module = request.args.get("sub_module")
    masters = load_masters()
    
    filtered = masters
    if module:
        filtered = [m for m in filtered if m.get("module") == module]
    if sub_module:
        filtered = [m for m in filtered if m.get("sub_module") == sub_module]
        
    return jsonify(filtered)

# ══════════════════════════════════════
# INTEGRATION: PIS LOOKUP PROXY
# ══════════════════════════════════════
@app.route("/api/search_pis")
def search_pis():
    query = request.args.get("query")
    form_id = request.args.get("formId")
    if not query:
        return jsonify({"results": []})
        
    url = get_agra_api_url("search")
    
    params = {"query": query}
    if form_id:
        params["formId"] = form_id
    
    try:
        response = requests.get(url, params=params, timeout=5)
        return jsonify(response.json())
    except Exception as e:
        return jsonify({"results": [], "error": str(e)})

@app.route("/api/fetch_pis")
def fetch_pis():
    pis = request.args.get("pis")
    if not pis:
        return jsonify({"error": "PIS number is required"}), 400
        
    config = load_json(CONFIG_FILE, {})
    integration = config.get("integration", {})
    
    if not integration.get("enabled"):
        return jsonify({"error": "Integration is disabled"}), 403
        
    url = get_agra_api_url("lookup")
    # Priority: 1. Request arg, 2. Config default
    form_id = request.args.get("formId") or integration.get("master_form_id")
    
    try:
        # We proxy the request to the Node.js API
        response = requests.get(url, params={"pis": pis, "formId": form_id}, timeout=5)
        if response.status_code == 200:
            return jsonify(response.json())
        elif response.status_code == 404:
            return jsonify({"error": "PIS number not found in Agra-sandhani"}), 404
        else:
            return jsonify({"error": "External API error"}), response.status_code
    except requests.exceptions.RequestException as e:
        return jsonify({"error": f"Connection to Agra-sandhani failed: {str(e)}"}), 500

@app.route("/api/agra_forms")
def api_agra_forms():
    url = get_agra_api_url("forms")
    try:
        response = requests.get(url, timeout=5)
        return jsonify(response.json())
    except Exception as e:
        return jsonify({"forms": [], "error": str(e)})

@app.route("/api/agra_form_fields/<int:form_id>")
def api_agra_form_fields(form_id):
    url = get_agra_api_url(f"forms/{form_id}/fields")
    try:
        response = requests.get(url, timeout=5)
        return jsonify(response.json())
    except Exception as e:
        return jsonify({"fields": [], "error": str(e)})

@app.route("/api/prefill_proxy", methods=["POST"])
def prefill_proxy():
    url = get_agra_api_url("prefill-session")
    try:
        response = requests.post(url, json=request.json, timeout=5)
        return jsonify(response.json()), response.status_code
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/masters/update_mapping", methods=["POST"])
def update_master_mapping():
    if not session.get("master_unlocked"):
        return jsonify({"error": "Unauthorized"}), 403
    
    master_id = request.json.get("master_id")
    agra_form_id = request.json.get("agra_form_id")
    agra_import_form_id = request.json.get("agra_import_form_id")
    agra_export_form_id = request.json.get("agra_export_form_id")
    field_map = request.json.get("field_map")
    import_map = request.json.get("import_map")
    export_map = request.json.get("export_map")
    nominee_columns = request.json.get("nominee_columns")
    
    if not master_id:
        return jsonify({"error": "Master ID is required"}), 400
        
    masters = load_masters()
    found = False
    for m in masters:
        if m["id"] == master_id:
            if agra_form_id is not None:
                m["agra_form_id"] = int(agra_form_id) if agra_form_id else None
            if agra_import_form_id is not None:
                m["agra_import_form_id"] = int(agra_import_form_id) if agra_import_form_id else None
                m["agra_form_id"] = m["agra_import_form_id"]
            if agra_export_form_id is not None:
                m["agra_export_form_id"] = int(agra_export_form_id) if agra_export_form_id else None
            if field_map is not None:
                m["field_map"] = field_map
            if import_map is not None:
                m["import_map"] = import_map
            if export_map is not None:
                m["export_map"] = export_map
            if nominee_columns is not None:
                m["nominee_columns"] = nominee_columns
            found = True
            break
            
    if found:
        save_masters(masters)
        return jsonify({"success": True})
    return jsonify({"error": "Master not found"}), 404

@app.route("/favicon.ico")
def favicon():
    return "", 204

if __name__ == "__main__":
    # Start background cleanup task
    threading.Thread(target=cleanup_task, daemon=True).start()

    # Explicitly enabling threaded=True to ensure multiple users can 
    # generate documents simultaneously without blocking the server.
    app.run(host="0.0.0.0", port=5001, debug=False, threaded=True)