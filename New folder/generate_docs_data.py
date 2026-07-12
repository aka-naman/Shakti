import os
import json

def escape_js_template(text):
    # Escape backslashes first, then backticks and dollar signs to avoid template string collision
    text = text.replace('\\', '\\\\')
    text = text.replace('`', '\\`')
    text = text.replace('$', '\\$')
    return text

def main():
    workspace_dir = os.path.dirname(os.path.abspath(__file__))
    docs_dir = os.path.join(workspace_dir, 'docs')
    os.makedirs(docs_dir, exist_ok=True)
    
    files_map = {
        "welcome": "report.md",
        "chapter1": "report_chapter_1.md",
        "chapter2": "report_chapter_2.md",
        "chapter3": "report_chapter_3.md",
        "chapter4": "report_chapter_4.md",
        "chapter5": "report_chapter_5.md",
        "chapter6": "report_chapter_6.md",
        "chapter7": "report_chapter_7.md",
        "theory": "theory_guide.md"
    }
    
    js_content = "/* Automatically generated documentation data file */\n\nconst DOCS_DATA = {\n"
    
    for key, filename in files_map.items():
        file_path = os.path.join(workspace_dir, filename)
        if not os.path.exists(file_path):
            print(f"Warning: {filename} not found at {file_path}")
            continue
            
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
            
        # Parse out a suitable title from the first header
        title = filename
        for line in content.split('\n'):
            if line.startswith('# '):
                title = line.replace('# ', '').strip()
                # Remove emojis if any from the title for cleaner navigation (optional, let's keep them!)
                break
            elif line.startswith('## '):
                title = line.replace('## ', '').strip()
                break
                
        escaped_content = escape_js_template(content)
        js_content += f'  "{key}": {{\n'
        js_content += f'    "title": {json.dumps(title)},\n'
        js_content += f'    "content": `{escaped_content}`\n'
        js_content += '  },\n'
        
    js_content = js_content.rstrip(',\n') + '\n};\n'
    
    output_path = os.path.join(docs_dir, 'content.js')
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(js_content)
        
    print(f"Successfully generated {output_path}")

if __name__ == '__main__':
    main()
