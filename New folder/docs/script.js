/* Agra-sandhani Technical Documentation Engine - Vanilla JS Router & Search */

document.addEventListener('DOMContentLoaded', () => {
    // --- State Variables ---
    let currentHash = window.location.hash || '#welcome';
    let activeSearchQuery = '';
    
    // --- Navigation Definition (Order of pages) ---
    const NAV_ORDER = [
        { key: 'welcome', title: 'Introduction & Overview' },
        { key: 'chapter1', title: 'Chapter 1: Entry & Security' },
        { key: 'chapter2', title: 'Chapter 2: Database & Index' },
        { key: 'chapter3', title: 'Chapter 3: Auth & Permissions' },
        { key: 'chapter4', title: 'Chapter 4: Form Logic & Migration' },
        { key: 'chapter5', title: 'Chapter 5: Validation & Streams' },
        { key: 'chapter6', title: 'Chapter 6: Decoupled Services' },
        { key: 'chapter7', title: 'Chapter 7: Autocomplete & LAN' },
        { key: 'theory', title: 'Theoretical Architecture Guide' }
    ];

    // --- DOM Elements ---
    const sidebarNav = document.getElementById('sidebar-nav');
    const contentBody = document.getElementById('content-body');
    const outlineNav = document.getElementById('outline-nav');
    const prevLink = document.getElementById('prev-link');
    const nextLink = document.getElementById('next-link');
    const prevTitle = document.getElementById('prev-title');
    const nextTitle = document.getElementById('next-title');
    const breadcrumbs = document.getElementById('breadcrumbs');
    const themeSelect = document.getElementById('theme-select');
    const searchInput = document.getElementById('search-input');
    const searchClear = document.getElementById('search-clear');
    const menuToggle = document.getElementById('menu-toggle');
    const sidebar = document.getElementById('sidebar');
    const sidebarOverlay = document.getElementById('sidebar-overlay');
    
    // --- Initialize App ---
    initThemes();
    renderSidebarNav();
    handleRouting();
    
    // --- Event Listeners ---
    window.addEventListener('hashchange', () => {
        currentHash = window.location.hash || '#welcome';
        handleRouting();
        closeMobileSidebar();
    });

    themeSelect.addEventListener('change', (e) => {
        setTheme(e.target.value);
    });

    searchInput.addEventListener('input', (e) => {
        const val = e.target.value.trim();
        activeSearchQuery = val;
        if (val.length > 0) {
            searchClear.style.display = 'block';
            executeSearch(val);
        } else {
            searchClear.style.display = 'none';
            handleRouting(); // Restore current page if search is cleared
        }
    });

    searchClear.addEventListener('click', () => {
        searchInput.value = '';
        activeSearchQuery = '';
        searchClear.style.display = 'none';
        searchInput.focus();
        handleRouting();
    });

    menuToggle.addEventListener('click', toggleMobileSidebar);
    sidebarOverlay.addEventListener('click', closeMobileSidebar);

    // Click handler for links inside content (delegation)
    contentBody.addEventListener('click', (e) => {
        const target = e.target.closest('a');
        if (target && target.getAttribute('href') && target.getAttribute('href').startsWith('#')) {
            // Internal navigation
            const targetHash = target.getAttribute('href');
            const targetId = targetHash.substring(1);
            
            // Check if it's a page navigation or an anchor navigation on the current page
            const pageKeys = NAV_ORDER.map(n => n.key);
            const matchingPage = pageKeys.find(k => targetId === k || targetId.startsWith(k + '_'));
            
            if (matchingPage) {
                // Let hash change handle it
            } else {
                // Anchor on the same page
                e.preventDefault();
                const element = document.getElementById(targetId);
                if (element) {
                    element.scrollIntoView({ behavior: 'smooth' });
                }
            }
        }
    });

    // --- Core Routing System ---
    function handleRouting() {
        if (activeSearchQuery.length > 0) {
            executeSearch(activeSearchQuery);
            return;
        }

        const pageKey = currentHash.substring(1).split('-')[0]; // Split if there is an anchor suffix
        const pageIndex = NAV_ORDER.findIndex(n => n.key === pageKey);
        
        if (pageIndex === -1) {
            // Fallback
            window.location.hash = '#welcome';
            return;
        }

        const pageData = DOCS_DATA[pageKey];
        if (!pageData) {
            contentBody.innerHTML = `<div class="content-inner"><h1>Page Not Found</h1><p>The requested page data does not exist.</p></div>`;
            return;
        }

        // Render content
        renderPage(pageKey, pageData);
        updateSidebarActiveState(pageKey);
        updateNavigationFooter(pageIndex);
        updateBreadcrumbs(pageKey, pageData.title);
        
        // Scroll content to top
        contentBody.scrollTop = 0;

        // If there was an anchor suffix (e.g. #chapter1-section2), scroll to it after rendering
        const fullHash = window.location.hash;
        if (fullHash.includes('-')) {
            const anchorId = fullHash.substring(1);
            setTimeout(() => {
                const anchorEl = document.getElementById(anchorId);
                if (anchorEl) {
                    anchorEl.scrollIntoView({ behavior: 'smooth' });
                }
            }, 100);
        }
    }

    // --- Render Navigation in Sidebar ---
    function renderSidebarNav() {
        sidebarNav.innerHTML = '';
        NAV_ORDER.forEach(item => {
            const a = document.createElement('a');
            a.href = `#${item.key}`;
            a.className = 'nav-item';
            a.id = `nav-${item.key}`;
            
            a.innerHTML = `<span>${item.title}</span>`;
            sidebarNav.appendChild(a);
        });
    }

    function updateSidebarActiveState(activeKey) {
        document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
        const activeNav = document.getElementById(`nav-${activeKey}`);
        if (activeNav) {
            activeNav.classList.add('active');
        }
    }

    // --- Breadcrumbs & Navigation Footers ---
    function updateBreadcrumbs(pageKey, pageTitle) {
        breadcrumbs.innerHTML = `
            <a href="#welcome">Docs</a> &raquo; 
            <span>${pageTitle}</span>
        `;
    }

    function updateNavigationFooter(pageIndex) {
        // Prev button
        if (pageIndex > 0) {
            const prevPage = NAV_ORDER[pageIndex - 1];
            prevLink.href = `#${prevPage.key}`;
            prevTitle.textContent = prevPage.title;
            prevLink.style.visibility = 'visible';
        } else {
            prevLink.style.visibility = 'hidden';
        }

        // Next button
        if (pageIndex < NAV_ORDER.length - 1) {
            const nextPage = NAV_ORDER[pageIndex + 1];
            nextLink.href = `#${nextPage.key}`;
            nextTitle.textContent = nextPage.title;
            nextLink.style.visibility = 'visible';
        } else {
            nextLink.style.visibility = 'hidden';
        }
    }

    // --- Mobile Sidebar Controls ---
    function toggleMobileSidebar() {
        sidebar.classList.toggle('open');
        sidebarOverlay.classList.toggle('active');
    }

    function closeMobileSidebar() {
        sidebar.classList.remove('open');
        sidebarOverlay.classList.remove('active');
    }

    // --- Theme Manager ---
    function initThemes() {
        const savedTheme = localStorage.getItem('docs-theme') || 'classic';
        setTheme(savedTheme);
        themeSelect.value = savedTheme;
    }

    function setTheme(themeName) {
        document.documentElement.setAttribute('data-theme', themeName);
        localStorage.setItem('docs-theme', themeName);
    }

    // --- Render Markdown Function ---
    function renderPage(pageKey, pageData) {
        const rawContent = pageData.content;
        const html = parseMarkdown(rawContent, pageKey);
        
        const innerContainer = document.getElementById('content-inner');
        if (innerContainer) {
            innerContainer.innerHTML = html;
        }
        
        // Show footer on regular page
        const footer = document.querySelector('.docs-footer');
        if (footer) footer.style.display = 'flex';
        
        // Build the On-This-Page TOC outline
        buildPageOutline();
        
        // Bind Copy Buttons to Code blocks
        bindCodeCopyButtons();
    }

    // Custom Lightweight Markdown Parser
    function parseMarkdown(md, pageKey) {
        let lines = md.split('\n');
        let html = '';
        let inList = false;
        let listType = null; // 'ul' or 'ol'
        let inCode = false;
        let codeLang = '';
        let codeLines = [];
        let inTable = false;
        let tableHeader = null;
        let tableAlignments = [];
        let tableRows = [];
        let inBlockquote = false;
        let blockquoteLines = [];
        
        let headerCounters = { h1: 0, h2: 0, h3: 0 };

        // Helper function to flush lists
        const flushList = () => {
            if (inList) {
                html += `</${listType}>`;
                inList = false;
                listType = null;
            }
        };

        // Helper function to flush tables
        const flushTable = () => {
            if (inTable) {
                html += '<div style="overflow-x:auto;"><table>';
                if (tableHeader) {
                    html += '<thead><tr>';
                    tableHeader.forEach((cell, idx) => {
                        const align = tableAlignments[idx] || 'left';
                        html += `<th style="text-align:${align}">${formatInlineMarkdown(cell)}</th>`;
                    });
                    html += '</tr></thead>';
                }
                html += '<tbody>';
                tableRows.forEach(row => {
                    html += '<tr>';
                    row.forEach((cell, idx) => {
                        const align = tableAlignments[idx] || 'left';
                        html += `<td style="text-align:${align}">${formatInlineMarkdown(cell)}</td>`;
                    });
                    html += '</tr>';
                });
                html += '</tbody></table></div>';
                
                inTable = false;
                tableHeader = null;
                tableAlignments = [];
                tableRows = [];
            }
        };

        // Helper function to flush blockquotes / callouts
        const flushBlockquote = () => {
            if (inBlockquote) {
                const quoteText = blockquoteLines.join('\n').trim();
                
                // Check if it matches GitHub-style callouts
                const calloutRegex = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*([\s\S]*)$/i;
                const match = quoteText.match(calloutRegex);
                
                if (match) {
                    const type = match[1].toUpperCase();
                    const content = match[2];
                    
                    // Icon selection
                    let icon = '';
                    if (type === 'NOTE') icon = 'ℹ️';
                    else if (type === 'TIP') icon = '';
                    else if (type === 'IMPORTANT') icon = '';
                    else if (type === 'WARNING') icon = '️';
                    else if (type === 'CAUTION') icon = '';
                    
                    html += `
                        <div class="callout callout-${type.toLowerCase()}">
                            <div class="callout-title">
                                <span>${icon}</span>
                                <span>${type}</span>
                            </div>
                            <div class="callout-content">
                                ${parseMarkdown(content, pageKey + '_sub')}
                            </div>
                        </div>
                    `;
                } else {
                    // Regular blockquote
                    html += `<blockquote>${parseMarkdown(quoteText, pageKey + '_sub')}</blockquote>`;
                }
                
                inBlockquote = false;
                blockquoteLines = [];
            }
        };

        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            let trimmed = line.trim();

            // --- 1. Code Block Processing ---
            if (trimmed.startsWith('```')) {
                if (inCode) {
                    // Close code block
                    const joinedCode = codeLines.join('\n');
                    const escapedCode = escapeHtml(joinedCode);
                    
                    // Is it a text-based ASCII diagram or normal code block?
                    const isDiagram = (codeLang === '' || codeLang === 'text' || codeLang === 'ascii') && 
                                       (joinedCode.includes('+-') || joinedCode.includes('|') || joinedCode.includes('──') || joinedCode.includes('┌'));
                    
                    if (isDiagram) {
                        html += `<div class="diagram-box">${escapedCode}</div>`;
                    } else {
                        html += `
                            <pre><button class="code-copy-btn" data-copied="Copied!">Copy</button><code class="language-${codeLang || 'text'}">${escapedCode}</code></pre>
                        `;
                    }
                    
                    inCode = false;
                    codeLines = [];
                    codeLang = '';
                } else {
                    // Open code block
                    flushList();
                    flushTable();
                    flushBlockquote();
                    inCode = true;
                    codeLang = trimmed.substring(3).trim();
                }
                continue;
            }

            if (inCode) {
                codeLines.push(line);
                continue;
            }

            // --- 2. Table Processing ---
            if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
                flushList();
                flushBlockquote();
                inTable = true;
                
                const cells = trimmed.split('|')
                    .slice(1, -1) // remove empty first and last elements
                    .map(c => c.trim());
                
                // Check if this line is a separator (like |:---| or |---|)
                const isSeparator = cells.every(c => /^:?-+:?$/.test(c));
                
                if (isSeparator) {
                    // Determine alignment
                    tableAlignments = cells.map(c => {
                        if (c.startsWith(':') && c.endsWith(':')) return 'center';
                        if (c.endsWith(':')) return 'right';
                        return 'left';
                    });
                } else {
                    if (!tableHeader && tableRows.length === 0) {
                        // First line is header
                        tableHeader = cells;
                    } else {
                        tableRows.push(cells);
                    }
                }
                continue;
            } else {
                flushTable();
            }

            // --- 3. Blockquote / Callout Processing ---
            if (trimmed.startsWith('>')) {
                flushList();
                flushTable();
                inBlockquote = true;
                
                // Strip the leading '>' and add to lines
                const content = line.substring(line.indexOf('>') + 1).trim();
                blockquoteLines.push(content);
                continue;
            } else {
                flushBlockquote();
            }

            // --- 4. Unordered and Ordered Lists ---
            const ulMatch = trimmed.match(/^[\*\-]\s+(.*)$/);
            const olMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
            
            if (ulMatch) {
                const content = ulMatch[1];
                if (!inList || listType !== 'ul') {
                    flushList();
                    inList = true;
                    listType = 'ul';
                    html += '<ul>';
                }
                html += `<li>${formatInlineMarkdown(content)}</li>`;
                continue;
            } else if (olMatch) {
                const content = olMatch[2];
                if (!inList || listType !== 'ol') {
                    flushList();
                    inList = true;
                    listType = 'ol';
                    html += '<ol>';
                }
                html += `<li>${formatInlineMarkdown(content)}</li>`;
                continue;
            } else {
                flushList();
            }

            // --- 5. Headers ---
            if (trimmed.startsWith('#')) {
                const hDepth = trimmed.match(/^#+/)[0].length;
                const hContent = trimmed.replace(/^#+\s*/, '');
                
                if (hDepth <= 6) {
                    const tag = `h${hDepth}`;
                    headerCounters[tag] = (headerCounters[tag] || 0) + 1;
                    
                    // Create a unique id for scroll spy / linking
                    const cleanId = `${pageKey}-${hContent.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
                    
                    // Render headers
                    html += `<${tag} id="${cleanId}">${formatInlineMarkdown(hContent)}</${tag}>`;
                    continue;
                }
            }

            // --- 6. Horizontal Rules ---
            if (trimmed === '---' || trimmed === '***') {
                html += '<hr>';
                continue;
            }

            // --- 7. Plain Paragraphs ---
            if (trimmed.length > 0) {
                // If it is just math formatting, wrap in a centered block
                if (trimmed.startsWith('$$') && trimmed.endsWith('$$')) {
                    const mathExpr = trimmed.substring(2, trimmed.length - 2).trim();
                    html += `<div style="text-align:center; margin: 20px 0; overflow-x:auto; font-family:var(--font-mono); font-size:1.1rem; color:var(--accent);">${mathExpr}</div>`;
                } else {
                    html += `<p>${formatInlineMarkdown(line)}</p>`;
                }
            }
        }

        // Final flushes
        flushList();
        flushTable();
        flushBlockquote();

        return html;
    }

    // Escape HTML tags to display raw in pre/code blocks
    function escapeHtml(text) {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // Format Inline Markdown styles (bold, italics, links, inline code)
    function formatInlineMarkdown(text) {
        // First escape brackets and basic tags if necessary, but keep it functional for Markdown
        let formatted = text;
        
        // 1. Math formulas inline conversion (e.g. $Similarity(S_1, S_2)$)
        // Convert inline $math$ to simple styled text
        formatted = formatted.replace(/\$(.*?)\$/g, '<code style="background:none; border:none; padding:0; color:var(--accent); font-style:italic;">$1</code>');

        // 2. Inline code blocks `code`
        formatted = formatted.replace(/`(.*?)`/g, '<code>$1</code>');
        
        // 3. Bold **text**
        formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        
        // 4. Italics *text* or _text_
        formatted = formatted.replace(/\*(.*?)\*/g, '<em>$1</em>');
        formatted = formatted.replace(/_(.*?)_/g, '<em>$1</em>');
        
        // 5. Links [text](url)
        formatted = formatted.replace(/\[(.*?)\]\((.*?)\)/g, (match, linkText, url) => {
            // Check if it is a local link or standard URL
            if (url.startsWith('file:///')) {
                // Return styled file link
                return `<a href="${url}" target="_blank" class="file-link">${linkText}</a>`;
            }
            return `<a href="${url}">${linkText}</a>`;
        });

        return formatted;
    }

    // --- On-This-Page Table of Contents ScrollSpy ---
    function buildPageOutline() {
        outlineNav.innerHTML = '';
        const headings = contentBody.querySelectorAll('h2, h3');
        
        if (headings.length === 0) {
            outlineNav.innerHTML = `<span style="font-size:0.8rem; color:var(--text-muted);">No sections on this page</span>`;
            return;
        }

        headings.forEach(heading => {
            const id = heading.id;
            const text = heading.textContent.trim();
            const a = document.createElement('a');
            a.href = `#${id}`;
            a.textContent = text;
            a.className = `depth-${heading.tagName.toLowerCase()}`;
            
            a.addEventListener('click', (e) => {
                e.preventDefault();
                heading.scrollIntoView({ behavior: 'smooth' });
                window.history.pushState(null, null, `#${id}`);
                setActiveOutlineLink(a);
            });
            
            outlineNav.appendChild(a);
        });

        // Setup Scroll Spy
        setupScrollSpy(headings);
    }

    function setActiveOutlineLink(activeLink) {
        document.querySelectorAll('#outline-nav a').forEach(el => el.classList.remove('active'));
        if (activeLink) activeLink.classList.add('active');
    }

    function setupScrollSpy(headings) {
        const links = outlineNav.querySelectorAll('a');
        
        contentBody.addEventListener('scroll', () => {
            let currentActive = null;
            const scrollPos = contentBody.scrollTop + 80; // Add offset for trigger bounds
            
            for (let i = 0; i < headings.length; i++) {
                const heading = headings[i];
                if (heading.offsetTop <= scrollPos) {
                    currentActive = heading;
                } else {
                    break; // Since headings are in order, we can stop
                }
            }
            
            if (currentActive) {
                const activeId = currentActive.id;
                links.forEach(link => {
                    if (link.getAttribute('href') === `#${activeId}`) {
                        setActiveOutlineLink(link);
                    }
                });
            } else if (links.length > 0) {
                setActiveOutlineLink(links[0]);
            }
        });
    }

    // --- Code Copy Button Bindings ---
    function bindCodeCopyButtons() {
        document.querySelectorAll('.code-copy-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const code = btn.nextElementSibling.textContent;
                navigator.clipboard.writeText(code).then(() => {
                    const originalText = btn.textContent;
                    btn.textContent = btn.getAttribute('data-copied') || 'Copied!';
                    btn.style.backgroundColor = 'var(--accent)';
                    btn.style.color = 'var(--text-sidebar-active)';
                    
                    setTimeout(() => {
                        btn.textContent = originalText;
                        btn.style.backgroundColor = 'var(--bg-main)';
                        btn.style.color = 'var(--text-muted)';
                    }, 2000);
                });
            });
        });
    }

    // --- Client-Side Global Search ---
    function executeSearch(query) {
        const lowerQuery = query.toLowerCase();
        breadcrumbs.innerHTML = `<span>Search Results</span>`;
        
        let resultsHtml = `
            <h1>Search Results for "${escapeHtml(query)}"</h1>
            <hr>
            <div class="search-results-list">
        `;
        
        let matchCount = 0;
        
        // Loop through each chapter page
        NAV_ORDER.forEach(item => {
            const pageData = DOCS_DATA[item.key];
            if (!pageData) return;
            
            const title = pageData.title;
            const content = pageData.content;
            
            const titleMatch = title.toLowerCase().includes(lowerQuery);
            const contentMatch = content.toLowerCase().includes(lowerQuery);
            
            if (titleMatch || contentMatch) {
                matchCount++;
                
                // Create snippets with matching term highlighted
                let snippet = '';
                if (contentMatch) {
                    const idx = content.toLowerCase().indexOf(lowerQuery);
                    const start = Math.max(0, idx - 80);
                    const end = Math.min(content.length, idx + 120);
                    let rawSnippet = content.substring(start, end);
                    
                    if (start > 0) rawSnippet = '...' + rawSnippet;
                    if (end < content.length) rawSnippet = rawSnippet + '...';
                    
                    // Highlight query word
                    const regex = new RegExp(`(${escapeRegExp(query)})`, 'gi');
                    snippet = escapeHtml(rawSnippet).replace(regex, '<mark class="search-highlight">$1</mark>');
                } else {
                    snippet = `<em>Matches title. View page content...</em>`;
                }
                
                resultsHtml += `
                    <div class="search-result-item" style="margin-bottom:28px;">
                        <h3 style="margin-top:0; margin-bottom:8px;">
                            <a href="#${item.key}" class="search-result-link" style="font-size:1.25rem; font-weight:600; text-decoration:none;">${title}</a>
                        </h3>
                        <p style="font-size:0.9rem; color:var(--text-muted); line-height:1.4;">${snippet}</p>
                    </div>
                `;
            }
        });
        
        if (matchCount === 0) {
            resultsHtml += `<p>No documentation results found matching your search. Try different keywords.</p>`;
        }
        
        resultsHtml += `
            </div>
        `;
        
        const innerContainer = document.getElementById('content-inner');
        if (innerContainer) {
            innerContainer.innerHTML = resultsHtml;
        }
        
        // Hide footer on search results page
        const footer = document.querySelector('.docs-footer');
        if (footer) footer.style.display = 'none';
        
        // Bind click events on search results links to trigger standard routing
        if (innerContainer) {
            innerContainer.querySelectorAll('.search-result-link').forEach(link => {
                link.addEventListener('click', (e) => {
                    // Clear search queries
                    searchInput.value = '';
                    searchClear.style.display = 'none';
                    activeSearchQuery = '';
                    // Hash change will fire, loading the clicked page
                });
            });
        }
        
        // Empty the right TOC pane during search
        outlineNav.innerHTML = `<span style="font-size:0.8rem; color:var(--text-muted);">Outline not available for search</span>`;
    }

    // Helper to escape regex special characters
    function escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
});
