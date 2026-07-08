import re
import uuid
from datetime import datetime

def get_unique_timestamp():
    """Generates a timestamp suffixed with a unique 6-character UUID segment to avoid collisions."""
    return datetime.now().strftime("%Y%m%d_%H%M%S") + "_" + uuid.uuid4().hex[:6]


def get_safe(d, key, default=""):
    """Returns the default if the key is missing OR if the value is None."""
    if d is None:
        return default
    val = d.get(key, default)
    return default if val is None else val

def parse_date_safe(value, fmt="%Y-%m-%d"):
    """Parses a date string safely, returning a datetime object or raising ValueError."""
    if not value:
        raise ValueError("Missing or empty date value.")
    try:
        return datetime.strptime(str(value).strip(), fmt)
    except (TypeError, ValueError) as e:
        raise ValueError(f"Invalid date format: '{value}'. Expected '{fmt}'.") from e

def replace_placeholders_in_paragraph(paragraph, placeholders):
    """Handles placeholders split across multiple runs by Microsoft Word."""
    if not paragraph.runs:
        return
    
    full_text = "".join(run.text for run in paragraph.runs)
    original = full_text
    
    for key, value in placeholders.items():
        if key in full_text:
            full_text = full_text.replace(key, str(value))
            
    if full_text != original:
        # Put the fully-replaced text into the first run
        paragraph.runs[0].text = full_text
        # Empty out all subsequent runs in the paragraph to avoid duplication
        for run in paragraph.runs[1:]:
            run.text = ""

def has_unreplaced_placeholders(doc):
    """Scans doc paragraphs and tables for any unreplaced {{...}} placeholders."""
    pattern = re.compile(r"\{\{.+?\}\}")
    
    for para in doc.paragraphs:
        if pattern.search(para.text):
            return True
            
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                for para in cell.paragraphs:
                    if pattern.search(para.text):
                        return True
                        
    return False
